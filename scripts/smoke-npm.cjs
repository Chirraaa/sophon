const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { load } = require('./security/load.cjs')
const crypto = require('node:crypto')
const children = []
let quit
let releases = 0
const npm = load('src/main/tools/npm.ts', {
  child_process: {
    execFile: (_file, args, _options, callback) =>
      callback(null, { stdout: `C:\\node\\${args[0]}` }),
    spawn: () => {
      const child = new EventEmitter()
      Object.assign(child, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 123,
        exitCode: null,
        kill: () => {
          child.exitCode = 0
          child.emit('close', 0)
        }
      })
      children.push(child)
      setImmediate(() => child.emit('spawn'))
      return child
    }
  },
  util: {
    stripVTControlCharacters: require('node:util').stripVTControlCharacters,
    promisify:
      (fn) =>
      (...args) =>
        new Promise((resolve, reject) =>
          fn(...args, (err, result) => (err ? reject(err) : resolve(result)))
        )
  },
  path: require('node:path').win32,
  'fs/promises': { access: async () => {}, stat: async () => ({ isDirectory: () => true }) },
  './files': { workspacePath: async () => 'C:\\project' },
  '../security/run-manager': {
    assertRun: (run) => {
      if (run.signal.aborted) throw Error('Aborted')
    }
  },
  '../security/worker-job': {
    containCommand: () => () => {
      releases++
    }
  },
  '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto }),
  electron: {
    app: {
      on: (_event, fn) => {
        quit = fn
      }
    }
  },
  net: {
    connect: () => {
      const socket = new EventEmitter()
      socket.setTimeout = () => {}
      socket.destroy = () => {}
      setImmediate(() => socket.emit('connect'))
      return socket
    }
  }
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 15))
async function main() {
  const controller = new AbortController()
  const output = []
  const pending = npm.runNpm({ args: ['run', 'dev'] }, { signal: controller.signal }, (text) =>
    output.push(text)
  )
  await tick()
  children[0].stdout.write('Local: http://localhost:3000\nReady in 100ms\n')
  const result = JSON.parse(await pending)
  assert.equal(result.running, true)
  assert.equal(result.url, 'http://localhost:3000/')
  assert.equal(result.stopped, false)
  assert(output[0].includes('Ready'))
  controller.abort()
  assert.equal(releases, 0, 'Normal turn completion preserves the server')
  const stopped = JSON.parse(
    await npm.runNpm(
      { args: ['run', 'dev'], action: 'stop' },
      { signal: new AbortController().signal }
    )
  )
  assert.equal(stopped.verified, true)
  assert.equal(stopped.running, false)
  assert.equal(children.length, 1, 'Stopping a managed server launches no command')
  assert.match(
    await npm.runNpm(
      { args: ['run', 'dev'], action: 'stop' },
      { signal: new AbortController().signal }
    ),
    /No matching Sophon-managed server/
  )
  assert.equal(children.length, 1, 'Missing server does not target unrelated processes')
  quit()
  assert.equal(releases, 1, 'Managed server process tree is released once')

  const logs = []
  const check = npm.runNpm(
    { args: ['run', 'test'] },
    { signal: new AbortController().signal },
    (text) => logs.push(text)
  )
  await tick()
  children[1].stdout.write('Checking module one\n')
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert(logs[0].includes('Checking module one'), 'Output arrives before command completion')
  children[1].exitCode = 1
  children[1].emit('close', 1)
  const failed = JSON.parse(await check)
  assert.equal(failed.exitCode, 1)
  assert.equal(failed.stopped, false)
  const restart = npm.runNpm({ args: ['run', 'dev'] }, { signal: new AbortController().signal })
  await tick()
  children[2].stdout.write('Local: http://localhost:3000\nReady\n')
  await restart
  quit()
  assert.equal(releases, 3, 'App exit releases the remaining server process tree')
  console.log(
    'PASS npm: persistent preview, streamed output, failed check exit code and app-exit cleanup'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
