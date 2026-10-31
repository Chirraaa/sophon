import type { FailureFingerprint } from './fingerprint'

// Budgets that follow convergence instead of counting attempts. Each check or probe is a
// track. A fix attempt that changes nothing about the failure is a stall; a failure that
// shrinks or turns green is progress, and progress earns more model calls, actions and
// time up to a hard ceiling. Escalations push a stalled model to change strategy before
// the run gives up, and the run stops only when repeated attempts add no information.

export type Limits = { calls: number; actions: number; seconds: number }
export type Observation = 'pass' | 'progress' | 'regression' | 'new' | 'repeat' | 'unchanged'
export type Escalation = Readonly<{
  key: string
  label: string
  level: 1 | 2
  failures: number
  signals: readonly string[]
  paths: readonly string[]
}>

// Stalls are fix attempts (edits between runs) that reproduced an already-seen failure.
// claims: completions claimed while a check still fails on unchanged code.
export const STALL = { hypothesis: 2, widen: 4, stop: 6, idle: 10, claims: 2 } as const
export const CREDIT = { calls: 3, actions: 15, seconds: 300 } as const

type Track = {
  label: string
  revision: number
  failing: boolean
  passedOnce: boolean
  count: number
  seen: Map<string, number>
  stall: number
  // Failing observations since the last progress, whatever their fingerprint.
  idle: number
  escalated: number
  claims: number
  fingerprint?: FailureFingerprint
}

export class ConvergenceGovernor {
  private tracks = new Map<string, Track>()
  private credits = 0

  constructor(
    readonly base: Limits,
    readonly ceiling: Limits
  ) {}

  get earned(): number {
    return this.credits
  }

  limits(): Limits {
    const grow = (key: keyof Limits): number =>
      Math.max(
        this.base[key],
        Math.min(this.ceiling[key], this.base[key] + this.credits * CREDIT[key])
      )
    return { calls: grow('calls'), actions: grow('actions'), seconds: grow('seconds') }
  }

  // Progress outside tracked checks, such as a falsifier finding a real defect.
  credit(): void {
    this.credits++
  }

  observe(
    key: string,
    label: string,
    revision: number,
    passed: boolean,
    fingerprint?: FailureFingerprint
  ): Observation {
    let track = this.tracks.get(key)
    if (!track) {
      track = {
        label,
        revision,
        failing: false,
        passedOnce: false,
        count: 0,
        seen: new Map(),
        stall: 0,
        idle: 0,
        escalated: 0,
        claims: 0
      }
      this.tracks.set(key, track)
    }
    track.label = label
    if (passed) {
      const recovered = track.failing
      Object.assign(track, {
        failing: false,
        passedOnce: true,
        count: 0,
        stall: 0,
        idle: 0,
        escalated: 0,
        claims: 0,
        revision,
        fingerprint: undefined
      })
      track.seen.clear()
      if (!recovered) return 'pass'
      this.credit()
      return 'progress'
    }
    const fp = fingerprint ?? { key: 'unknown', signals: [], count: 1, paths: [] }
    // Re-running unchanged code reproduces the failure without being an attempt.
    if (track.failing && track.revision === revision) {
      track.fingerprint = fp
      return 'unchanged'
    }
    const seen = track.seen.get(fp.key) ?? 0
    track.seen.set(fp.key, seen + 1)
    let result: Observation
    if (!track.failing && track.passedOnce) result = 'regression'
    else if (seen > 0) {
      track.stall++
      result = 'repeat'
    } else if (track.failing && fp.count < track.count) {
      track.stall = 0
      track.idle = 0
      track.escalated = 0
      this.credit()
      result = 'progress'
    } else result = 'new'
    if (result !== 'progress') track.idle++
    Object.assign(track, { failing: true, count: fp.count, revision, fingerprint: fp, claims: 0 })
    return result
  }

  // The check failed on exactly this code: running it again cannot pass.
  unchangedFailure(key: string, revision: number): boolean {
    const track = this.tracks.get(key)
    return !!track?.failing && track.revision === revision
  }

  // Completion was claimed although nothing changed since the check failed.
  claimWithoutChange(key: string): void {
    const track = this.tracks.get(key)
    if (track?.failing) track.claims++
  }

  failing(key: string): boolean {
    return this.tracks.get(key)?.failing === true
  }

  // A reason to stop, once attempts have stopped producing new information.
  stopReason(keys?: (key: string) => boolean): string | undefined {
    for (const [key, track] of this.tracks) {
      if (!track.failing || (keys && !keys(key))) continue
      if (track.claims >= STALL.claims)
        return `${track.label} still fails and the code has not changed since; completion was claimed ${track.claims} times without a fix. Code remains unverified.`
      if (track.stall >= STALL.stop)
        return `${track.label} reproduced the same failure after ${track.stall} fix attempts; further edits were not converging. Code remains unverified.`
      if (track.idle >= STALL.idle)
        return `${track.label} failed ${track.idle} times without the failure shrinking; the repair was not converging. Code remains unverified.`
    }
    return undefined
  }

  // The next strategy change to push, at most once per level for each failing track.
  nextEscalation(): Escalation | undefined {
    for (const [key, track] of this.tracks) {
      if (!track.failing) continue
      const level =
        track.stall >= STALL.widen || track.idle >= STALL.idle - 3
          ? 2
          : track.stall >= STALL.hypothesis || track.idle >= STALL.idle - 5
            ? 1
            : 0
      if (level <= track.escalated) continue
      track.escalated = level
      return Object.freeze({
        key,
        label: track.label,
        level: level as 1 | 2,
        failures: track.idle,
        signals: track.fingerprint?.signals ?? [],
        paths: track.fingerprint?.paths ?? []
      })
    }
    return undefined
  }

  status(): { earned: number; ceiling: number } {
    return { earned: this.limits().calls - this.base.calls, ceiling: this.ceiling.calls }
  }
}

const normalized = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

export function escalationMessage(
  escalation: Escalation,
  context: { read: string[]; changed: string[] }
): string {
  const failure = escalation.signals.length
    ? ` Diagnostics: ${escalation.signals.slice(0, 5).join(' | ')}.`
    : ''
  if (escalation.level === 1)
    return (
      `Convergence: ${escalation.label} is still failing the same way after your edits (${escalation.failures} failing runs since the last progress).${failure} ` +
      'Your recent fixes did not change the failure, so the cause is probably not where you have been editing. Before the next edit, write down one root-cause hypothesis and the observation that would confirm or refute it, then gather that observation: read the code on the failing path, run one narrower probe, or add a temporary diagnostic. Do not repeat a fix that already failed, and do not weaken or delete the check.'
    )
  const read = new Set(context.read.map(normalized))
  const unread = escalation.paths.filter((path) => !read.has(normalized(path))).slice(0, 6)
  return (
    `Convergence is still stalled on ${escalation.label}.${failure} ` +
    (unread.length
      ? `Files named by the failure that you have not read in this task: ${unread.join(', ')}. Read them before editing. `
      : '') +
    (context.changed.length
      ? `Your edits so far touched ${context.changed.slice(-6).join(', ')}; the cause may be outside them. `
      : '') +
    'Re-read the failing assertion against the original request: if the check contradicts the request, say so and withdraw that probe with a reason instead of weakening it silently. If your last change made things worse, revert it. Consider a falsifier or reviewer subagent with the exact failure. ' +
    'Another round without new information ends the task with an honest report of what is unverified.'
  )
}
