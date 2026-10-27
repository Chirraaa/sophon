const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const path = require('node:path')
const { load } = require('./security/load.cjs')

let child
let invocation
let releases = 0
const { powershellWorker } = load('src/main/tools/powershell-worker.ts', {
  child_process: {
    spawn: (...args) => {
      invocation = args
      child = Object.assign(new EventEmitter(), {
        pid: 123,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => queueMicrotask(() => child.emit('close', null))
      })
      return child
    }
  },
  path,
  '../security/worker-job': { constrainParser: () => () => releases++ }
})
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
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
