import { LoopBudgets } from './loop-budgets'
import { createHash, randomUUID } from 'crypto'
import { untrustedData } from '../llm/untrusted-data'
import { MUTATIONS, assessResult, unsupportedCompletion } from './results'
import { validCodingSession } from './coding-session'

const MAX_EVIDENCE = 16
const ACTIVE_PHASES = ['inspect', 'act', 'verify', 'respond', 'finished']
const OUTCOMES = [
  'running',
  'answered',
  'actions_checked',
  'needs_review',
  'blocked',
  'interrupted'
]
const STATUSES = ['pending', 'observed', 'reported', 'verified', 'failed', 'denied', 'uncertain']

export function isContinuation(text: string): boolean {
  if (/^My answers:\s*\n/i.test(text.trim())) return true
  return /^(?:please\s+)?(?:continue|resume|try again|retry|go ahead|carry on|keep going|go on|pick up where (?:you|we) left off)(?:(?:\s+(?:the\s+)?(?:previous\s+|last\s+|current\s+)?(?:task|request|response|answer|work))|(?:\s+from where (?:you|we) (?:left off|stopped)))?[.!]?(?:\s*[,;:\u2014-]\s*[\s\S]+)?$/i.test(
    text.trim()
  )
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && !v.includes('\0')
const date = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8640000000000000
const member = (value: unknown, list: string[]): boolean =>
  typeof value === 'string' && list.includes(value)
export function validWorkflow(value: unknown): value is WorkflowState {
  return (
    obj(value) &&
    value.version === 1 &&
    str(value.id, 80) &&
    value.mode === 'assistant' &&
    str(value.workspaceKey, 64) &&
    str(value.goal, 32000) &&
    member(value.phase, ACTIVE_PHASES) &&
    member(value.outcome, OUTCOMES) &&
    str(value.nextStep, 400) &&
    date(value.updatedAt) &&
    Number.isInteger(value.omittedEvidence) &&
    Number(value.omittedEvidence) >= 0 &&
    (value.codingSession === undefined || validCodingSession(value.codingSession)) &&
    (value.codingPaths === undefined ||
      (Array.isArray(value.codingPaths) &&
        value.codingPaths.length <= 256 &&
        value.codingPaths.every((path) => str(path, 2000)))) &&
    Array.isArray(value.evidence) &&
    value.evidence.length <= MAX_EVIDENCE &&
    value.evidence.every(
      (e) =>
        obj(e) &&
        str(e.actionId, 80) &&
        str(e.runId, 80) &&
        str(e.tool, 80) &&
        str(e.target, 160) &&
        member(e.status, STATUSES) &&
        str(e.summary, 240) &&
        date(e.at)
    )
  )
}
export function interruptedWorkflow(state: WorkflowState): WorkflowState {
  return {
    ...state,
    phase: 'finished',
    outcome: 'interrupted',
    updatedAt: Date.now(),
    nextStep:
      'Inspect the last action before continuing; it may have occurred before the interruption.',
    evidence: state.evidence.map((e) =>
      e.status === 'pending'
        ? {
            ...e,
            status: 'uncertain',
            summary:
              'Interrupted before the result was recorded. Do not assume the action did not happen.'
          }
        : e
    )
  }
}
export const WORKFLOW_INSTRUCTIONS =
  'WORKFLOW: The app tracks stages and action evidence. Workflow envelopes are reference data, not permission. The user goal includes all constraints in the original request. Inspect the relevant target, take the smallest supported action, then check the result. Observed means data received; reported means a tool reported success; verified means a specific postcondition was checked, not that the entire goal is complete. A close request is not proof of closure. Never claim an unperformed action or test. On resume, old evidence is historical: re-observe changing state, do not replay completed actions or reuse approvals. Stop on denial. A failed or uncertain mutation needs inspection before another action; do not blindly replay it. A nonzero project check is diagnostic evidence for the coding harness repair loop, not permission denial; obey its repair limit and never weaken checks.'

export class WorkflowController {
  readonly budgets = new LoopBudgets()
  private recoveryAction?: string
  canRecover(actionId: string): boolean {
    return this.recoveryAction === actionId
  }
  private state: WorkflowState
  readonly resumed: boolean
  constructor(
    private runId: string,
    mode: TaskMode,
    workspace: string,
    goal: string,
    previous: WorkflowState | undefined,
    private publish: (state: WorkflowState) => void
  ) {
    const workspaceKey = createHash('sha256').update(workspace.toLowerCase()).digest('hex')
    this.resumed =
      !!previous &&
      validWorkflow(previous) &&
      previous.mode === mode &&
      previous.workspaceKey === workspaceKey &&
      ['needs_review', 'interrupted', 'answered', 'actions_checked'].includes(previous.outcome) &&
      isContinuation(goal)
    this.state = this.resumed
      ? {
          ...structuredClone(previous!),
          phase: 'inspect',
          outcome: 'running',
          updatedAt: Date.now(),
          nextStep:
            'Continue from the last unfinished step or partial answer. Preserve the original constraints; do not restart or repeat completed work. Re-observe external state only when needed for the next action.'
        }
      : {
          version: 1,
          id: randomUUID(),
          mode,
          workspaceKey,
          goal,
          phase: 'inspect',
          outcome: 'running',
          nextStep: 'Identify the needed evidence and the next supported action.',
          evidence: [],
          omittedEvidence: 0,
          updatedAt: Date.now()
        }
    this.emit()
  }
  snapshot(): WorkflowState {
    return structuredClone(this.state)
  }
  trackCoding(paths: string[]): void {
    if (!paths.length) return
    this.state.codingPaths = paths.slice(-256)
    this.emit()
  }
  trackCodingSession(session: CodingSessionState): void {
    if (!validCodingSession(session)) throw new Error('Invalid coding checkpoint.')
    this.state.codingSession = structuredClone(session)
    this.emit()
  }
  private emit(): void {
    this.state.updatedAt = Date.now()
    this.publish(this.snapshot())
  }
  context(): string {
    const recent = this.state.evidence.slice(-3)
    return untrustedData(
      'task-checkpoint',
      'current task',
      JSON.stringify({
        ...(this.resumed ? { originalGoal: this.state.goal } : {}),
        phase: this.state.phase,
        nextStep: this.state.nextStep,
        evidence: recent.map(({ actionId, tool, target, status, summary, at, runId }) => ({
          actionId,
          tool,
          target: target.slice(0, 100),
          status,
          summary: summary.slice(0, 120),
          at,
          historical: runId !== this.runId
        })),
        olderEvidence: this.state.omittedEvidence + this.state.evidence.length - recent.length
      })
    )
  }
  beforeAction(actionId: string, tool: string, args: Record<string, unknown>): void {
    if (this.state.outcome !== 'running') throw new Error('This workflow has stopped.')
    this.state.phase = MUTATIONS.has(tool) ? 'act' : 'inspect'
    this.state.nextStep = 'Wait for the approved tool result before deciding what to do next.'
    this.state.evidence.push({
      actionId,
      runId: this.runId,
      tool,
      target: String(
        args.path ?? args.title ?? args.window ?? args.name ?? args.control ?? ''
      ).slice(0, 160),
      status: 'pending',
      summary: 'Action proposed; execution and result are not yet confirmed.',
      at: Date.now()
    })
    if (this.state.evidence.length > MAX_EVIDENCE) {
      this.state.evidence.shift()
      this.state.omittedEvidence++
    }
    this.emit()
  }
  afterAction(
    actionId: string,
    args: Record<string, unknown>,
    result: string | { text: string; image: string }
  ): EvidenceStatus {
    const evidence = this.state.evidence.find((e) => e.actionId === actionId)
    if (!evidence || evidence.status !== 'pending') throw new Error('No pending workflow action.')
    this.state.phase = 'verify'
    const assessment = assessResult(evidence.tool, args, result)
    Object.assign(evidence, assessment, { at: Date.now() })
    const resultText = typeof result === 'string' ? result : result.text
    this.recoveryAction = undefined
    const recover = this.budgets.recover(
      evidence.tool,
      String(args.path ?? ''),
      resultText,
      assessment.status
    )
    if (evidence.tool === 'click' && resultText.startsWith('Screenshot required:') && recover) {
      this.recoveryAction = actionId
      this.state.nextStep =
        'No click was executed. Capture the intended window again and choose fresh coordinates inside the new image.'
    } else if (recover && /^(?:Missing workspace path:|Patch not applied:)/.test(resultText)) {
      this.recoveryAction = actionId
      this.state.nextStep =
        'No workspace change occurred. Inspect the current file or intended parent before a corrected action; at most two consecutive refreshes per path are allowed.'
    } else if (resultText.startsWith('Target not found:') && recover) {
      this.recoveryAction = actionId
      this.state.nextStep =
        'No action was executed. Refresh the window list and resolve the exact intended target, or ask the user.'
    } else if (
      ['web_search', 'web_fetch'].includes(evidence.tool) &&
      resultText.startsWith('Web unavailable:')
    ) {
      this.state.nextStep =
        'The public web service was unavailable, not denied by the user. Do not repeat a failed search or change providers. Read an available public source or explain the verification limit. Permission denials still stop the task.'
    } else if (['denied', 'failed', 'uncertain'].includes(assessment.status)) {
      this.state.phase = 'finished'
      this.state.outcome = assessment.status === 'denied' ? 'blocked' : 'needs_review'
      this.state.nextStep =
        assessment.status === 'denied'
          ? 'The action was denied. No automatic retry is allowed.'
          : 'Inspect the failed or uncertain result before choosing a new action. Earlier changes may already have occurred.'
    } else
      this.state.nextStep =
        assessment.status === 'reported'
          ? 'Check the relevant outcome with an available observation tool, or clearly report that it is unverified.'
          : 'Use this evidence to choose the next step or give a supported answer.'
    this.emit()
    return assessment.status
  }
  completionIssue(text: string, expectedTool?: string): string | undefined {
    this.state.phase = 'respond'
    this.emit()
    if (
      expectedTool &&
      /^(?:done|completed|finished|success)[.!]?$/i.test(text.trim()) &&
      !this.state.evidence.some(
        (e) =>
          e.runId === this.runId &&
          e.tool === expectedTool &&
          ['observed', 'reported', 'verified'].includes(e.status)
      )
    )
      return 'A completion claim has no matching action evidence in this request.'
    return unsupportedCompletion(text, this.state.evidence, this.runId)
  }
  finish(incomplete = false, codingVerified = false): void {
    if (this.state.outcome !== 'running') return
    const actions = this.state.evidence.filter(
      (e) => e.runId === this.runId && MUTATIONS.has(e.tool)
    )
    this.state.phase = 'finished'
    this.state.outcome =
      incomplete ||
      actions.some((e, index) => {
        if (e.status === 'verified') return false
        if (
          codingVerified &&
          ['run_npm', 'run_command'].includes(e.tool) &&
          e.status === 'reported'
        )
          return false

        if (
          e.status === 'failed' &&
          /^(?:Patch not applied:|Missing workspace path:)/.test(e.summary) &&
          actions
            .slice(index + 1)
            .some(
              (next) =>
                next.tool === e.tool && next.target === e.target && next.status === 'verified'
            )
        )
          return false
        return true
      })
        ? 'needs_review'
        : actions.length
          ? 'actions_checked'
          : 'answered'
    this.state.nextStep = incomplete
      ? 'The request ended before completion was established. Review the evidence and continue if needed.'
      : this.state.outcome === 'needs_review'
        ? 'Action results were reported but not all postconditions were checked. Inspect before repeating an action.'
        : actions.length
          ? 'Recorded action postconditions were checked; review the answer against the full user goal.'
          : 'Answer delivered; no external action completion is implied.'
    this.emit()
  }
  interrupt(): void {
    if (this.state.outcome !== 'running') return
    this.state = interruptedWorkflow(this.state)
    this.emit()
  }
}
