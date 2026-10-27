import { spawn } from 'child_process'
import { join } from 'path'
import { constrainParser } from '../security/worker-job'
type WorkerOptions = {
  label: string
  timeout: number
  unavailable: string
  invalid: string
}

export function powershellWorker(
  program: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
  options: WorkerOptions
): Promise<unknown> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-MTA',
        '-EncodedCommand',
        Buffer.from(program, 'utf16le').toString('base64')
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP
        }
      }
    )
    let release: (() => void) | undefined
    let failure: Error | undefined
    let output = ''
    let bytes = 0
    const kill = (error: Error): void => {
      failure ??= error
      child.kill()
      release?.()
      release = undefined
    }
    const abort = (): void =>
      kill(
        new Error(
          `${options.label} stopped; an in-flight control action may already have occurred.`
        )
      )
    const timer = setTimeout(
      () => kill(new Error(`${options.label} timed out. Inspect before retrying an action.`)),
      options.timeout
    )
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (part: string) => {
      bytes += Buffer.byteLength(part)
      if (bytes > 96000) kill(new Error(`${options.label} output exceeded its limit.`))
      else output += part
    })
    child.stderr.on('data', (part: Buffer) => {
      bytes += part.length
      if (bytes > 96000) kill(new Error(`${options.label} error output exceeded its limit.`))
    })
    child.stdin.on('error', (error) => {
      failure ??= error
    })
    child.on('error', (error) => {
      failure ??= error
    })
    child.on('spawn', () => {
      try {
        release = constrainParser(child.pid!)
        signal.throwIfAborted()
        child.stdin.end(JSON.stringify(request))
      } catch (error) {
        kill(error as Error)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      release?.()
      if (failure) return reject(failure)
      if (code !== 0) return reject(new Error(options.unavailable))
      try {
        resolve(JSON.parse(output.replace(/^\uFEFF/, '')))
      } catch {
        reject(new Error(options.invalid))
      }
    })
    if (signal.aborted) abort()
  })
}
