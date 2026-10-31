import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import type { ProbeSpec, ProofProbe } from './contract'

// Script probes live in the app's coding-runs folder, never in the user's repository, so
// the model and the falsifier can write executable checks without touching project files.
// The host rewrites each script from the approved source before every run.

const PRELUDE: Record<'node' | 'python', string> = {
  node: [
    '// Sophon verification probe. Exit 0 when the claim holds, nonzero when it is violated.',
    "import { pathToFileURL as __probeUrl } from 'node:url'",
    "import { resolve as __probeResolve } from 'node:path'",
    '// workspace(path) gives an importable URL for a file relative to the probe folder.',
    'const workspace = (path) => __probeUrl(__probeResolve(process.cwd(), path)).href',
    ''
  ].join('\n'),
  python: [
    '# Sophon verification probe. Exit 0 when the claim holds, nonzero when it is violated.',
    'import os as __probe_os, sys as __probe_sys',
    '__probe_sys.path.insert(0, __probe_os.getcwd())',
    ''
  ].join('\n')
}

export function probeScript(spec: ProbeSpec): string | undefined {
  return spec.script ? PRELUDE[spec.script.language] + spec.script.source : undefined
}

function safeDirectory(parts: string[]): string {
  let directory = app.getPath('userData')
  for (const part of parts) {
    directory = join(directory, part)
    if (!existsSync(directory)) mkdirSync(directory)
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe probe directory.')
  }
  return directory
}

export function probeScriptPath(workflowId: string, probe: ProofProbe): string | undefined {
  if (!probe.script) return undefined
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(workflowId)) throw new Error('Invalid coding session ID.')
  const extension = probe.script.language === 'node' ? 'mjs' : 'py'
  return join(
    app.getPath('userData'),
    'coding-runs',
    workflowId,
    'probes',
    `${probe.id}-${probe.definition}.${extension}`
  )
}

export function writeProbeScript(workflowId: string, probe: ProofProbe): void {
  const target = probeScriptPath(workflowId, probe)
  const source = probeScript(probe)
  if (!target || source === undefined) return
  safeDirectory(['coding-runs', workflowId, 'probes'])
  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('Unsafe probe file.')
  }
  const temp = target + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temp, source, { flag: 'wx' })
    renameSync(temp, target)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
}

const quote = (value: string): string => "'" + value.replace(/'/g, "''") + "'"

// The exact run_command arguments a probe executes with; approval and grants bind to these.
export function probeArguments(
  workflowId: string,
  probe: ProofProbe
): { command: string; path: string; purpose: 'check'; timeout_seconds: number } {
  const script = probeScriptPath(workflowId, probe)
  const command = script
    ? `& ${probe.script!.language === 'node' ? 'node' : 'python'} ${quote(script)}`
    : probe.command!
  return {
    command,
    path: probe.path ?? '.',
    purpose: 'check',
    timeout_seconds: probe.timeout_seconds ?? 120
  }
}

// Workspace files a probe depends on: the files it declares plus file-like tokens in its
// command. Their content hash is part of every observation, so a test edited between a
// failing and a passing run cannot count as a witness of the change.
export function probeDependencies(workspace: string, probe: ProbeSpec): string {
  const tokens = new Set<string>(probe.files ?? [])
  for (const match of (probe.command ?? '').matchAll(/[\w@./\\-]+\.[A-Za-z][\w]{0,7}\b/g))
    tokens.add(match[0])
  const root = resolve(workspace || '.')
  const base = resolve(root, probe.path ?? '.')
  const parts: string[] = []
  for (const token of [...tokens].sort()) {
    const target = resolve(isAbsolute(token) ? token : join(base, token))
    const inside = relative(root, target)
    if (!workspace || inside.startsWith('..') || isAbsolute(inside)) continue
    try {
      const stat = lstatSync(target)
      if (!stat.isFile() || stat.size > 4_000_000) continue
      parts.push(
        inside.replace(/\\/g, '/') +
          '\0' +
          createHash('sha256').update(readFileSync(target)).digest('hex')
      )
    } catch {
      if ((probe.files ?? []).includes(token)) parts.push(inside.replace(/\\/g, '/') + '\0missing')
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}
