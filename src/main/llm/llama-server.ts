import { spawn, type ChildProcess } from 'child_process'
import { lstatSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import { createServer } from 'net'
import { setTimeout as delay } from 'timers/promises'
import {
  DEFAULT_LLAMA_OPTIONS,
  buildLlamaArgs,
  llamaOptionIssues,
  looksLikeLlamaHelp,
  parseLlamaCapabilities,
  sanitizeLlamaOptions,
  type LlamaCapabilities,
  type LlamaOptions
} from '../../shared/llama-server'

// Everything here is electron-free so the launcher can be exercised against a real llama-server.

export interface LlamaConfig {
  enabled: boolean
  executable: string
  modelPath: string
  caps: LlamaCapabilities | null
  options: LlamaOptions
}

export interface LlamaStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  port?: number
  pid?: number
  error?: string
  log: string
}

export const DEFAULT_LLAMA_CONFIG: LlamaConfig = {
  enabled: false,
  executable: '',
  modelPath: '',
  caps: null,
  options: DEFAULT_LLAMA_OPTIONS
}

const CAPABILITY_KEYS: (keyof LlamaCapabilities)[] = [
  'loadMode',
  'noMmap',
  'mlock',
  'flashAttnValue',
  'flashAttnFlag',
  'cacheType',
  'reasoningBudget',
  'gpuLayers',
  'jinja',
  'noWebui'
]

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function sanitizeLlamaConfig(raw: unknown): LlamaConfig {
  const r = isObj(raw) ? raw : {}
  const caps = isObj(r.caps)
    ? (Object.fromEntries(
        CAPABILITY_KEYS.map((key) => [key, (r.caps as Record<string, unknown>)[key] === true])
      ) as unknown as LlamaCapabilities)
    : null
  return {
    enabled: r.enabled === true,
    executable: typeof r.executable === 'string' ? r.executable.slice(0, 1000) : '',
    modelPath: typeof r.modelPath === 'string' ? r.modelPath.slice(0, 1000) : '',
    caps,
    options: sanitizeLlamaOptions(r.options, DEFAULT_LLAMA_OPTIONS)
  }
}

export function readLlamaConfig(file: string): LlamaConfig {
  try {
    return sanitizeLlamaConfig(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return structuredClone(DEFAULT_LLAMA_CONFIG)
  }
}

export function writeLlamaConfig(file: string, config: LlamaConfig): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(config, null, 2), 'utf8')
  renameSync(file + '.tmp', file)
}

// The program is something the user chose, but it still must look like llama-server: an arbitrary
// executable (a shell, an installer) is never launched on the strength of a settings value.
export function assertLlamaExecutable(path: string): void {
  if (!path || !isAbsolute(path)) throw new Error('Choose the llama-server program first.')
  if (!/^llama-server(\.exe)?$/i.test(basename(path)))
    throw new Error('Choose the llama-server program. Its file name must be llama-server.exe.')
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    throw new Error('The llama-server program could not be found. Choose it again.')
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Choose the llama-server program itself, not a shortcut or link.')
}

export function assertGgufModel(path: string): void {
  if (!path || !isAbsolute(path)) throw new Error('Choose a model first.')
  if (extname(path).toLowerCase() !== '.gguf')
    throw new Error('Choose a .gguf model file. llama.cpp cannot load other formats.')
  try {
    if (!statSync(path).isFile()) throw new Error('Not a file')
  } catch {
    throw new Error('The model file could not be found. Choose it again.')
  }
}

// The program is trusted enough to run, but it does not need the user's credentials. CUDA and
// driver paths in the environment are kept because GPU builds rely on them.
const SENSITIVE_ENV = /token|secret|password|passwd|credential|api[_-]?key|^aws_|^github_|^ssh_/i
export function llamaEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env))
    if (value !== undefined && !SENSITIVE_ENV.test(name)) out[name] = value
  return out
}

export async function probeLlamaCapabilities(
  executable: string,
  signal?: AbortSignal
): Promise<LlamaCapabilities> {
  assertLlamaExecutable(executable)
  const help = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, ['--help'], {
      cwd: dirname(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: llamaEnvironment()
    })
    let text = ''
    const collect = (data: Buffer): void => {
      if (text.length < 400000) text += data.toString()
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => child.kill(), 15000)
    const abort = (): void => {
      child.kill()
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      resolve(text)
    })
  })
  if (!looksLikeLlamaHelp(help))
    throw new Error('This program did not respond like llama-server. Choose llama-server.exe.')
  return parseLlamaCapabilities(help)
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is already in use. Pick another port in the model options.`
            : error.message
        )
      )
    )
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()))
  })
}

export type HealthCheck = (port: number, pid: number, signal: AbortSignal) => Promise<boolean>

const START_TIMEOUT_MS = 10 * 60 * 1000
const LOG_LIMIT = 6000

// Vision needs the model's projector file, which sits beside it as mmproj*.gguf. Without it the
// server loads fine but answers every image request with HTTP 500.
export function findProjector(modelPath: string): string | undefined {
  try {
    const name = readdirSync(dirname(modelPath)).find((file) =>
      /^mmproj.*\.gguf$/i.test(file)
    )
    return name ? join(dirname(modelPath), name) : undefined
  } catch {
    return undefined
  }
}

export class LlamaServer {
  private child: ChildProcess | null = null
  private controller: AbortController | null = null
  private stopping = false
  private log = ''
  private current: Omit<LlamaStatus, 'log'> = { state: 'stopped' }
  constructor(
    private readonly health: HealthCheck,
    private readonly onStatus: (status: LlamaStatus) => void = () => {}
  ) {}

  status(): LlamaStatus {
    return { ...this.current, log: this.log }
  }

  private set(next: Omit<LlamaStatus, 'log'>): void {
    this.current = next
    this.onStatus(this.status())
  }

  async start(config: LlamaConfig): Promise<LlamaStatus> {
    if (this.current.state === 'starting' || this.current.state === 'running')
      throw new Error('The model is already running. Stop it first.')
    assertLlamaExecutable(config.executable)
    assertGgufModel(config.modelPath)
    if (!config.caps)
      throw new Error('Choose the llama-server program again to detect its options.')
    const issues = Object.values(llamaOptionIssues(config.options, config.caps))
    if (issues.length) throw new Error(issues[0])
    const port = config.options.port
    try {
      await assertPortFree(port)
    } catch (error) {
      this.set({ state: 'error', error: (error as Error).message })
      throw error
    }

    this.log = ''
    this.stopping = false
    const controller = new AbortController()
    this.controller = controller
    const args = buildLlamaArgs(
      config.options,
      config.caps,
      config.modelPath,
      findProjector(config.modelPath)
    )
    const child = spawn(config.executable, args, {
      cwd: dirname(config.executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: llamaEnvironment()
    })
    this.child = child
    this.set({ state: 'starting', port, pid: child.pid })
    const collect = (data: Buffer): void => {
      this.log = (this.log + data.toString()).slice(-LOG_LIMIT)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    let failure = ''
    child.once('error', (error) => {
      failure = error.message
    })
    child.once('exit', (code) => {
      if (this.child === child) this.child = null
      if (this.stopping) {
        this.set({ state: 'stopped' })
        return
      }
      failure = failure || `llama-server stopped unexpectedly (exit code ${code ?? 'unknown'}).`
      this.set({ state: 'error', error: failure })
    })

    try {
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        controller.signal.throwIfAborted()
        if (failure || child.exitCode !== null)
          throw new Error(failure || 'llama-server stopped while loading the model.')
        try {
          if (
            child.pid &&
            (await this.health(
              port,
              child.pid,
              AbortSignal.any([controller.signal, AbortSignal.timeout(1500)])
            ))
          ) {
            this.set({ state: 'running', port, pid: child.pid })
            return this.status()
          }
        } catch {
          controller.signal.throwIfAborted()
        }
        await delay(400, undefined, { signal: controller.signal })
      }
      throw new Error('The model took too long to load. Try a smaller context or fewer GPU layers.')
    } catch (error) {
      if (this.stopping) throw new Error('Start cancelled.', { cause: error })
      child.kill()
      const message = (error as Error).message
      this.set({ state: 'error', error: message })
      throw error
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.stopping = true
    this.controller?.abort()
    this.controller = null
    if (!child || child.exitCode !== null) {
      this.child = null
      if (this.current.state !== 'stopped') this.set({ state: 'stopped' })
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill()
    })
    this.child = null
    if (this.current.state !== 'stopped') this.set({ state: 'stopped' })
  }
}
