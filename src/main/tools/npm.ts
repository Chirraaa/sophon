import { execFile, spawn } from 'child_process'
import { promisify, stripVTControlCharacters } from 'util'
import { dirname, join, isAbsolute } from 'path'
import { access, stat } from 'fs/promises'
import { workspacePath } from './files'
import { assertRun, type RunContext } from '../security/run-manager'
import { containCommand } from '../security/worker-job'
import { untrustedData } from '../llm/untrusted-data'
import { app } from 'electron'
import { connect } from 'net'

const servers = new Map<string, { stop: () => void; closed: Promise<void> }>()
app.on('before-quit', () => {
  for (const server of servers.values()) server.stop()
  servers.clear()
})

export async function runNpm(
  args: { path?: string; args: string[]; action?: 'run' | 'stop' },
  run: RunContext,
  onOutput?: (output: string) => void
): Promise<string> {
  const cwd = await workspacePath(args.path ?? '.')
  const dev =
    (args.args[0] === 'run' && ['dev', 'start', 'serve', 'preview'].includes(args.args[1])) ||
    args.args[0] === 'start'
  const serverKey = cwd.toLowerCase() + JSON.stringify(args.args)
  assertRun(run)
  if (args.action === 'stop') {
    const server = servers.get(serverKey)
    if (!server) return 'Tool error: No matching Sophon-managed server is running in this project.'
    server.stop()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        server.closed,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Server exit was not confirmed.')), 5000)
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
    assertRun(run)
    return JSON.stringify({ stopped: true, running: false, verified: true, action: 'stop' })
  }
  if (dev) servers.get(serverKey)?.stop()
  if (!(await stat(cwd)).isDirectory()) throw new Error('Choose a project folder.')
  const locate = promisify(execFile)
  const find = async (name: string): Promise<string> => {
    const result = await locate('where.exe', [name], { windowsHide: true, timeout: 5000 })
    const found = result.stdout
      .trim()
      .split(/\r?\n/)
      .find((entry) => isAbsolute(entry))
    if (!found) throw new Error('Install Node.js and npm and restart Sophon.')
    return found
  }
  const node = await find('node.exe')
  const npm = join(dirname(await find('npm.cmd')), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await access(npm)
  assertRun(run)
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(node, [npm, ...args.args], {
      cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let release: (() => void) | undefined
    let output = ''
    let tail = ''
    let omitted = false
    let stopped = false
    let background = false
    let probing = false
    let streamTimer: ReturnType<typeof setTimeout> | undefined
    let confirmClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      confirmClosed = resolve
    })
    const result = (): string =>
      JSON.stringify({
        exitCode: null,
        stopped: false,
        running: true,
        url: previewUrl,
        output: JSON.parse(untrustedData('command-output', 'npm output', tail)),
        note: 'Dev server is running. To stop it, call run_npm with action "stop" and the same path and args. It also stops on app exit or restarting this command. Share the preview URL with the user. This is not a passed project check.'
      })
    let previewUrl = ''
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      tail = (tail + text).slice(-8000)
      if (output.length + text.length > 16000) omitted = true
      output = (output + text).slice(0, 16000)
      if (!background)
        streamTimer ??= setTimeout(() => {
          streamTimer = undefined
          onOutput?.(tail)
        }, 100)
      const match = stripVTControlCharacters(tail).match(
        /http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{1,5}(?:\/[^\s]*)?/
      )
      if (
        dev &&
        !background &&
        !probing &&
        release &&
        match &&
        /ready|listening|started|local:/i.test(tail)
      ) {
        probing = true
        const url = new URL(match[0].replace('0.0.0.0', '127.0.0.1'))
        const socket = connect({ host: '127.0.0.1', port: Number(url.port) })
        socket.setTimeout(1000)
        socket.once('connect', () => {
          socket.destroy()
          if (stopped || run.signal.aborted || child.exitCode !== null) return
          background = true
          previewUrl = url.href
          clearTimeout(timer)
          clearTimeout(streamTimer)
          run.signal.removeEventListener('abort', stop)
          servers.set(serverKey, { stop, closed })
          onOutput?.(tail)
          resolve(result())
        })
        socket.once('error', () => {
          probing = false
          socket.destroy()
        })
        socket.once('timeout', () => {
          probing = false
          socket.destroy()
        })
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const stop = (): void => {
      stopped = true
      release?.()
      release = undefined
      child.kill()
    }
    const timer = setTimeout(stop, 120000)
    run.signal.addEventListener('abort', stop, { once: true })
    child.once('spawn', () => {
      try {
        release = containCommand(child.pid!)
        if (run.signal.aborted) stop()
      } catch (error) {
        stop()
        reject(error)
      }
    })
    const cleanup = (): void => {
      clearTimeout(timer)
      clearTimeout(streamTimer)
      if (background && servers.get(serverKey)?.stop === stop) servers.delete(serverKey)
      run.signal.removeEventListener('abort', stop)
      release?.()
      release = undefined
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code) => {
      cleanup()
      confirmClosed()
      resolve(
        JSON.stringify({
          exitCode: code,
          stopped,
          output: JSON.parse(
            untrustedData(
              'command-output',
              'npm output',
              omitted
                ? output.slice(0, 8000) + '\n[truncated output; final diagnostics follow]\n' + tail
                : output
            )
          )
        })
      )
    })
  })
}
