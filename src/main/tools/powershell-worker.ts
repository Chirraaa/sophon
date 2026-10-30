import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import type { Socket } from 'net'
import { join } from 'path'
import { constrainParser } from '../security/worker-job'
type WorkerOptions = {
  label: string
  timeout: number
  unavailable: string
  invalid: string
}
const OUTPUT_LIMIT = 96000

function launch(program: string): ChildProcessWithoutNullStreams {
  return spawn(
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
}

// One long-lived PowerShell process answering one JSON line per request, so
// callers pay process start and assembly loading once instead of every call.
// Requests run strictly one at a time. A timeout, cancellation, oversized or
// mismatched reply kills the process exactly as a one-shot worker would; the
// next request starts a fresh one. The process is also recycled after
// `maxRequests` (its resource job caps lifetime CPU) and after `idleMs` idle.
export function persistentPowershellWorker(
  program: string,
  options: WorkerOptions & { idleMs: number; maxRequests: number }
): {
  request: (request: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
  stop: () => void
} {
  type Pending = { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  let child: ChildProcessWithoutNullStreams | null = null
  let ready: Promise<void> | null = null
  let release: (() => void) | undefined
  let pending: Pending | null = null
  let served = 0
  let output = ''
  let errorBytes = 0
  let idle: NodeJS.Timeout | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const stop = (error?: Error): void => {
    clearTimeout(idle)
    const current = child
    child = null
    ready = null
    output = ''
    errorBytes = 0
    served = 0
    current?.kill()
    release?.()
    release = undefined
    const waiting = pending
    pending = null
    if (waiting) waiting.reject(error ?? new Error(options.unavailable))
  }
  const start = (): Promise<void> => {
    const worker = launch(program)
    child = worker
    // An idle worker must not keep the app or a script alive; each request's
    // timeout timer holds the event loop open while a reply is outstanding.
    worker.unref()
    for (const stream of [worker.stdin, worker.stdout, worker.stderr])
      (stream as Partial<Socket>).unref?.()
    worker.stdout.setEncoding('utf8')
    worker.stdout.on('data', (part: string) => {
      if (child !== worker) return
      output += part
      let newline: number
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output
          .slice(0, newline)
          .replace(/^\uFEFF/, '')
          .trim()
        output = output.slice(newline + 1)
        if (!line) continue
        const waiting = pending
        let reply: Record<string, unknown> | undefined
        try {
          reply = JSON.parse(line)
        } catch {
          /* handled below */
        }
        if (!waiting || !reply || reply.id !== waiting.id) return stop(new Error(options.invalid))
        pending = null
        delete reply.id
        waiting.resolve(reply)
      }
      if (output.length > OUTPUT_LIMIT)
        stop(new Error(`${options.label} output exceeded its limit.`))
    })
    worker.stderr.on('data', (part: Buffer) => {
      if (child !== worker) return
      errorBytes += part.length
      if (errorBytes > OUTPUT_LIMIT)
        stop(new Error(`${options.label} error output exceeded its limit.`))
    })
    worker.stdin.on('error', () => {
      if (child === worker) stop()
    })
    worker.on('close', () => {
      if (child === worker) stop()
    })
    return new Promise((resolve, reject) => {
      worker.on('error', (error) => {
        if (child === worker) stop(error)
        reject(error)
      })
      worker.on('spawn', () => {
        try {
          release = constrainParser(worker.pid!)
          resolve()
        } catch (error) {
          stop(error as Error)
          reject(error)
        }
      })
    })
  }
  const send = async (request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    signal.throwIfAborted()
    clearTimeout(idle)
    if (!child) ready = start()
    await ready
    signal.throwIfAborted()
    const worker = child
    if (!worker) throw new Error(options.unavailable)
    const id = randomUUID()
    try {
      return await new Promise((resolve, reject) => {
        pending = { id, resolve, reject }
        const abort = (): void =>
          stop(
            new Error(
              `${options.label} stopped; an in-flight control action may already have occurred.`
            )
          )
        const timer = setTimeout(
          () => stop(new Error(`${options.label} timed out. Inspect before retrying an action.`)),
          options.timeout
        )
        const settle = (): void => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
        }
        pending.resolve = (value) => {
          settle()
          resolve(value)
        }
        pending.reject = (error) => {
          settle()
          reject(error)
        }
        signal.addEventListener('abort', abort, { once: true })
        worker.stdin.write(JSON.stringify({ ...request, id }) + '\n')
      })
    } finally {
      if (child === worker && ++served >= options.maxRequests) stop()
      else if (child === worker) {
        idle = setTimeout(() => stop(), options.idleMs)
        idle.unref()
      }
    }
  }
  return {
    request: (request, signal) => {
      const result = queue.then(() => send(request, signal))
      queue = result.catch(() => undefined)
      return result
    },
    stop: () => stop()
  }
}

export function powershellWorker(
  program: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
  options: WorkerOptions
): Promise<unknown> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = launch(program)
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
