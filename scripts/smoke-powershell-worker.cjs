const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const path = require('node:path')
const { load } = require('./security/load.cjs')

let child
let invocation
let releases = 0
let spawns = 0
const { powershellWorker, persistentPowershellWorker } = load(
  'src/main/tools/powershell-worker.ts',
  {
    child_process: {
      spawn: (...args) => {
        invocation = args
        spawns++
        const current = Object.assign(new EventEmitter(), {
          pid: 123,
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          killed: false,
          unref: () => {},
          kill: () => {
            current.killed = true
            queueMicrotask(() => current.emit('close', null))
          }
        })
        child = current
        return current
      }
    },
    path,
    crypto: require('node:crypto'),
    '../security/worker-job': { constrainParser: () => () => releases++ }
  }
)
const options = {
  label: 'Automation',
  timeout: 1000,
  unavailable: 'Windows accessibility inspection was unavailable.',
  invalid: 'Invalid accessibility response.'
}

async function main() {
  const program = 'Read JSON from stdin'
  const request = { text: "'; unexpected-command" }
  const start = (signal = new AbortController().signal, config = options) => {
    const pending = powershellWorker(program, request, signal, config)
    child.emit('spawn')
    return pending
  }
  const success = start()
  const [executable, args, config] = invocation
  assert.equal(path.basename(executable), 'powershell.exe')
  assert.equal(args.at(-2), '-EncodedCommand')
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), program)
  assert.equal(child.stdin.read().toString(), JSON.stringify(request))
  assert.equal(config.windowsHide, true)
  assert.deepEqual(Object.keys(config.env).sort(), ['SystemRoot', 'TEMP', 'TMP', 'WINDIR'])
  child.stdout.write('\uFEFF{"ok":true}')
  child.emit('close', 0)
  assert.deepEqual(await success, { ok: true })
  assert.equal(releases, 1)

  const invalid = start()
  child.stdout.write('invalid JSON')
  child.emit('close', 0)
  await assert.rejects(invalid, { message: options.invalid })
  const unavailable = start()
  child.emit('close', 1)
  await assert.rejects(unavailable, { message: options.unavailable })
  const oversized = start()
  child.stdout.write('x'.repeat(96001))
  await assert.rejects(oversized, /Automation output exceeded its limit/)
  const controller = new AbortController()
  const aborted = start(controller.signal)
  controller.abort()
  await assert.rejects(aborted, /Automation stopped; an in-flight control action/)
  assert.throws(() => powershellWorker(program, request, controller.signal, options), /abort/i)
  const timedOut = start(new AbortController().signal, { ...options, timeout: 1 })
  await assert.rejects(timedOut, /Automation timed out/)
  assert.equal(releases, 6)
  console.log(
    'PASS fixed PowerShell program, stdin isolation, job release, bounded output, cancellation and timeout'
  )

  // Persistent worker: one process, one JSON line per request, replies matched by id.
  const persistent = persistentPowershellWorker(program, {
    ...options,
    idleMs: 60000,
    maxRequests: 3
  })
  const lines = []
  const send = async (signal = new AbortController().signal) => {
    const pending = persistent.request(request, signal)
    await new Promise((resolve) => setImmediate(resolve))
    if (!child.listenerCount('spawn') || child.spawned) return pending
    child.spawned = true
    child.emit('spawn')
    await new Promise((resolve) => setImmediate(resolve))
    return pending
  }
  const nextLine = async () => {
    await new Promise((resolve) => setImmediate(resolve))
    const line = JSON.parse(String(child.stdin.read()).trim())
    lines.push(line)
    return line
  }
  const reply = (body, id) => child.stdout.write(JSON.stringify({ ...body, id }) + '\n')
  spawns = 0
  releases = 0
  let pending = send()
  let line = await nextLine()
  assert.equal(line.text, request.text, 'Request body passes through unchanged')
  assert.match(line.id, /^[\da-f-]{36}$/)
  reply({ status: 'observed' }, line.id)
  assert.deepEqual(await pending, { status: 'observed' }, 'Reply id is stripped')
  const first = child
  pending = send()
  line = await nextLine()
  // Two replies in one chunk, the first split across writes, are still parsed by line.
  child.stdout.write('{"status":"ver')
  child.stdout.write(`ified","id":"${line.id}"}\n`)
  assert.deepEqual(await pending, { status: 'verified' })
  assert.equal(child, first, 'Later requests reuse the same process')
  assert.equal(spawns, 1)
  pending = send()
  line = await nextLine()
  reply({ status: 'observed' }, line.id)
  await pending
  await new Promise((resolve) => setImmediate(resolve))
  assert(first.killed, 'Recycled after maxRequests')
  assert.equal(releases, 1, 'Recycling releases the resource job')

  pending = send()
  await nextLine()
  assert.equal(spawns, 2, 'A recycled worker starts fresh on demand')
  reply({ status: 'observed' }, 'someone-else')
  await assert.rejects(pending, { message: options.invalid })
  assert(child.killed, 'A mismatched reply kills the worker')

  pending = send()
  await nextLine()
  child.stdout.write('x'.repeat(96001))
  await assert.rejects(pending, /Automation output exceeded its limit/)

  const stop = new AbortController()
  pending = send(stop.signal)
  await nextLine()
  stop.abort()
  await assert.rejects(pending, /Automation stopped; an in-flight control action/)
  assert(child.killed, 'Cancellation kills the in-flight worker')
  await assert.rejects(persistent.request(request, stop.signal), /abort/i)

  const slow = persistentPowershellWorker(program, {
    ...options,
    timeout: 5,
    idleMs: 60000,
    maxRequests: 20
  })
  const timed = slow.request(request, new AbortController().signal)
  await new Promise((resolve) => setImmediate(resolve))
  child.emit('spawn')
  await assert.rejects(timed, /Automation timed out/)

  pending = send()
  await nextLine()
  child.emit('close', 1)
  await assert.rejects(pending, { message: options.unavailable }, 'A crashed worker rejects')
  persistent.stop()
  console.log(
    'PASS persistent PowerShell worker: process reuse, line framing, id matching, recycling, bounded output, cancellation, timeout, crash and job release'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
