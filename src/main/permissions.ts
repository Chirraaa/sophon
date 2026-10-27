import { getSettings } from './settings'
import { isKnownTool } from './tools/registry'
export function toolPermission(name: string): ToolPermission {
  if (!isKnownTool(name)) return 'block'
  return getSettings().tools[name] ?? 'block'
}
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/\.exe$/, '')
function matches(candidate: string, rule: string): boolean {
  const c = normalize(candidate)
  const r = normalize(rule)
  if (!c || !r) return false
  if (c === r) return true
  return r.length >= 3 && c.includes(r)
}
export function blockedAppRule(...names: string[]): string | null {
  for (const rule of getSettings().rules.blockedApps) {
    if (names.some((n) => matches(n, rule))) return rule
  }
  return null
}
export function protectedWindowRule(title: string, exe: string): string | null {
  for (const rule of getSettings().rules.protectedWindows) {
    if (matches(exe, rule) || matches(title, rule)) return rule
  }
  return null
}
type Outcome = ApprovalDecision | 'timeout'
const APPROVAL_TIMEOUT_MS = 90000
const pending = new Map<string, (d: Outcome) => void>()
export function requestApproval(
  actionId: string,
  signal?: AbortSignal,
  onAlways?: () => void
): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (d: Outcome): void => {
      if (settled) return
      if (d === 'always') {
        if (!onAlways || signal?.aborted) return
        onAlways()
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      pending.delete(actionId)
      resolve(d)
    }
    const abort = (): void => finish('deny')
    const timer = setTimeout(() => finish('timeout'), APPROVAL_TIMEOUT_MS)
    pending.set(actionId, finish)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
export function resolveApproval(actionId: string, decision: unknown): void {
  if (decision !== 'once' && decision !== 'always' && decision !== 'deny') return
  pending.get(String(actionId))?.(decision)
}
