import { spawn, type ChildProcess } from 'child_process'
import { statSync } from 'fs'
import { dirname, isAbsolute } from 'path'
import { createServer } from 'net'
import { randomUUID } from 'crypto'
import { setTimeout as delay } from 'timers/promises'
import { leaseVoice } from './integrity'
import { ownedJson } from '../security/owned-http'
type Config = AppSettings['voice']
export function validateWhisperPaths(config: Config): void {
  for (const [path, label] of [
    [config.serverPath, 'whisper-server program'],
    [config.modelPath, 'Whisper base model']
  ] as const) {
    if (!path || !isAbsolute(path))
      throw new Error(`Choose the ${label} in Settings → Voice first.`)
    try {
      if (!statSync(path).isFile()) throw new Error('Not a file')
    } catch {
      throw new Error(`The ${label} file could not be found. Check Settings → Voice.`)
    }
  }
}
async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('No local port available.'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}
export class WhisperServer {
  private child: ChildProcess | null = null
  private controller: AbortController | null = null
  private ready: Promise<string> | null = null
  private configKey = ''
  private inferencePath = ''
  private releaseFiles: (() => void) | null = null
  stop(): void {
    this.controller?.abort()
    this.controller = null
    const release = this.releaseFiles
    this.releaseFiles = null
    if (
      release &&
      this.child?.pid &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
      this.child.once('exit', release)
    else release?.()
    this.child?.kill()
    this.child = null
    this.ready = null
    this.configKey = ''
  }
  private async launch(config: Config, cpu: boolean, signal: AbortSignal): Promise<string> {
    const port = await availablePort()
    signal.throwIfAborted()
    const route = `/inference-${randomUUID()}`
    const args = [
      '--model',
      config.modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--language',
      'auto',
      '--inference-path',
      route
    ]
    if (cpu) args.push('--no-gpu')
    const child = spawn(config.serverPath, args, {
      cwd: dirname(config.serverPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PATH: process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : ''
      }
    })
    this.child = child
    let failure = ''
    let logs = ''
    child.stdout?.on('data', (data: Buffer) => {
      logs = (logs + data.toString()).slice(-2000)
    })
    child.stderr?.on('data', (data: Buffer) => {
      logs = (logs + data.toString()).slice(-2000)
    })
    child.once('error', (error) => {
      failure = error.message
    })
    child.once('exit', (code) => {
      failure = `Whisper exited (${code ?? 'stopped'}). ${logs.trim()}`
    })
    const kill = (): void => {
      child.kill()
    }
    signal.addEventListener('abort', kill, { once: true })
    const base = `http://127.0.0.1:${port}`
    try {
      const deadline = Date.now() + 45000
      while (Date.now() < deadline) {
        signal.throwIfAborted()
        if (failure) throw new Error(failure)
        try {
          const res = await ownedJson(
            port,
            '/health',
            child.pid!,
            AbortSignal.any([signal, AbortSignal.timeout(700)])
          )
          if (res.status === 'ok') {
            if (failure) throw new Error(failure)
            this.inferencePath = route
            return base
          }
        } catch {
          signal.throwIfAborted()
        }
        await delay(150, undefined, { signal })
      }
      throw new Error(
        'Whisper took too long to load. Check the program and model in Settings → Voice.'
      )
    } catch (error) {
      child.kill()
      throw error
    } finally {
      signal.removeEventListener('abort', kill)
    }
  }
  private ensure(config: Config): Promise<string> {
    if (!config.enabled)
      throw new Error('Microphone access is disabled. Enable it in Settings → Voice.')
    const key = JSON.stringify([config.serverPath, config.modelPath, config.compute])
    if (this.ready && this.configKey === key && this.child?.exitCode === null && !this.child.killed)
      return this.ready
    this.stop()
    validateWhisperPaths(config)
    this.configKey = key
    const controller = new AbortController()
    this.controller = controller
    this.ready = (async () => {
      this.releaseFiles = await leaseVoice(config, controller.signal)
      try {
        return await this.launch(config, config.compute === 'cpu', controller.signal)
      } catch (error) {
        if (config.compute !== 'auto' || controller.signal.aborted) throw error
        return this.launch(config, true, controller.signal)
      }
    })()
    return this.ready
  }
  async transcribe(audio: Uint8Array, config: Config, signal: AbortSignal): Promise<string> {
    const ready = this.ensure(config)
    try {
      const base = await ready
      signal.throwIfAborted()
      const boundary = `sophon-${randomUUID()}`
      const fields = {
        language: config.language,
        translate: 'false',
        response_format: 'json',
        temperature: '0.0',
        temperature_inc: '0.0',
        suppress_non_speech: 'true'
      }
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="command.wav"\r\nContent-Type: audio/wav\r\n\r\n`
        ),
        Buffer.from(audio),
        Buffer.from(
          '\r\n' +
            Object.entries(fields)
              .map(
                ([name, value]) =>
                  `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
              )
              .join('') +
            `--${boundary}--\r\n`
        )
      ])
      if (!this.child?.pid || this.child.exitCode !== null || this.child.killed)
        throw new Error('The owned voice service stopped.')
      const data = await ownedJson(
        Number(new URL(base).port),
        this.inferencePath,
        this.child.pid,
        AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        body,
        `multipart/form-data; boundary=${boundary}`
      )
      const text = typeof data.text === 'string' ? data.text.replace(/\[[^\]]*\]/g, '').trim() : ''
      if (!text) throw new Error('No speech detected. Please try again.')
      return text
    } catch (error) {
      if (this.ready === ready) this.stop()
      throw error
    }
  }
}
