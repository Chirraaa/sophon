import { spawn } from 'child_process'
import { join } from 'path'
import { stat } from 'fs/promises'
import { StringDecoder } from 'string_decoder'
import { workspacePath } from './files'
import { assertRun, type RunContext } from '../security/run-manager'
import { containCommand } from '../security/worker-job'
import { untrustedData } from '../llm/untrusted-data'

export type CommandArgs = {
  command: string
  path?: string
  purpose: 'inspect' | 'change' | 'check'
  timeout_seconds?: number
}

export async function runCommand(
  args: CommandArgs,
  run: RunContext,
  onOutput?: (output: string) => void
): Promise<string> {
  const cwd = await workspacePath(args.path ?? '.')
  if (!(await stat(cwd)).isDirectory()) throw new Error('Choose an existing project folder.')
  assertRun(run)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$global:LASTEXITCODE = 0',
    'try {',
    args.command,
    'if (-not $?) { exit 1 }',
    'exit $LASTEXITCODE',
    '} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }'
  ].join('\n')
  const executable = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
      }
    )
    let release: (() => void) | undefined
    let head = '',
      tail = '',
      total = 0
    let stopped = false
    let streamTimer: ReturnType<typeof setTimeout> | undefined
    const collect = (text: string): void => {
      total += text.length
      head = (head + text).slice(0, 8000)
      tail = (tail + text).slice(-8000)
      streamTimer ??= setTimeout(() => {
        streamTimer = undefined
        onOutput?.(tail)
      }, 100)
    }
    const stdout = new StringDecoder('utf8'),
      stderr = new StringDecoder('utf8')
    child.stdout.on('data', (chunk: Buffer) => collect(stdout.write(chunk)))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr.write(chunk)))
    const stop = (): void => {
      stopped = true
      release?.()
      release = undefined
      child.kill()
    }
    const timer = setTimeout(stop, (args.timeout_seconds ?? 120) * 1000)
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
      run.signal.removeEventListener('abort', stop)
      release?.()
      release = undefined
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (exitCode) => {
      collect(stdout.end() + stderr.end())
      cleanup()
      onOutput?.(tail)
      resolve(
        JSON.stringify({
          exitCode,
          stopped,
          output: JSON.parse(
            untrustedData(
              'command-output',
              'PowerShell command output',
              total > 8000 ? head + '\n[output truncated; final diagnostics follow]\n' + tail : head
            )
          )
        })
      )
    })
  })
}
