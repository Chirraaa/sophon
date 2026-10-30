import type { RunContext } from '../security/run-manager'

// Where a task's wall-clock time went. Tool time includes the capture and
// accessibility time spent inside those tools; approval time is the user's.
export type TimingKind = 'model' | 'tool' | 'approval' | 'capture' | 'automation'

export function emptyTiming(): RequestTiming {
  return {
    wallMs: 0,
    modelMs: 0,
    modelCalls: 0,
    toolMs: 0,
    toolCalls: 0,
    approvalMs: 0,
    approvals: 0,
    captureMs: 0,
    captures: 0,
    automationMs: 0,
    automationCalls: 0
  }
}

const COUNTS = {
  model: 'modelCalls',
  tool: 'toolCalls',
  approval: 'approvals',
  capture: 'captures',
  automation: 'automationCalls'
} as const

export function recordTiming(run: RunContext, kind: TimingKind, ms: number): void {
  const timing = { ...(run.timing ?? emptyTiming()) }
  timing[`${kind}Ms`] += Math.max(0, Math.round(ms))
  timing[COUNTS[kind]] += 1
  timing.wallMs = Math.round(performance.now() - run.startedAt)
  run.timing = timing
  run.onTiming?.(timing)
}
