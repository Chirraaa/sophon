import { isRoutineNpm } from '../workflow/coding-mutation'
import type { RunContext } from './run-manager'

// Verification needs repetition: the same test or probe runs after every fix. A grant lets
// the user approve one exact check once per task instead of once per run of it. Grants are
// bound to the run object, so they end with the task, a Stop or a policy change, and they
// cover only read-style checks: run_command with purpose check and routine npm check
// scripts, never change commands, dev servers, deletions or MCP calls. Policy, workspace
// binding and revalidation still run on every execution.

const grants = new WeakMap<RunContext, Set<string>>()
const folder = (value: unknown): string =>
  String(value ?? '.')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .toLowerCase() || '.'

export function grantKey(name: string, args: Record<string, unknown>): string | undefined {
  if (name === 'run_command' && args.purpose === 'check' && typeof args.command === 'string')
    return JSON.stringify(['run_command', folder(args.path), args.command.trim()])
  if (name === 'run_npm' && args.action === undefined && Array.isArray(args.args)) {
    const argv = args.args.map(String)
    const script = argv[0] === 'run' ? argv[1] : argv[0]
    if (isRoutineNpm(argv) && !/^(?:dev|start|serve|preview)$/.test(script ?? ''))
      return JSON.stringify(['run_npm', folder(args.path), argv])
  }
  return undefined
}

export function addGrant(run: RunContext, name: string, args: Record<string, unknown>): boolean {
  const key = grantKey(name, args)
  if (!key) return false
  const set = grants.get(run) ?? new Set<string>()
  set.add(key)
  grants.set(run, set)
  return true
}

export function hasGrant(run: RunContext, name: string, args: Record<string, unknown>): boolean {
  const key = grantKey(name, args)
  return !!key && grants.get(run)?.has(key) === true
}
