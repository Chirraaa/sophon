import { codingMutation, codingMutationPath, isRoutineNpm } from './coding-mutation'
import { toolOutcome, type ToolOutcome } from './tool-outcome'

export type ActionRecord = Readonly<{
  actionId: string
  runId: string
  tool: string
  args: Readonly<Record<string, unknown>>
  outcome: ToolOutcome
  revision: number
  mutation: 'none' | 'applied' | 'possible'
  readbackWindow?: string
}>

export type VerificationReport = Readonly<{
  runId: string
  revision: number
  checkRevision: number
  status: 'passed' | 'pending' | 'not-required'
  summary: string
}>

// One authority for mutation revisions and live desktop identities per run.
// Workflow/session/verifier state are projections, never independent counters.
export class ActionLedger {
  private completed = new Set<string>()
  private changed = new Set<string>()
  private observations = new Map<string, NonNullable<ToolOutcome['observation']>>()
  private currentRevision: number
  private currentCheckRevision = 0
  private pending = new Map<string, { tool: string; args: Record<string, unknown> }>()
  constructor(
    readonly runId: string,
    revision = 0,
    paths: string[] = [],
    // The request asked for coding work (or resumed a coding session).
    readonly codingIntent = true
  ) {
    this.currentRevision = Math.max(0, revision)
    this.restore(paths)
  }
  get revision(): number {
    return this.currentRevision
  }
  get checkRevision(): number {
    return this.currentCheckRevision
  }
  paths(): string[] {
    return [...this.changed]
  }
  restore(paths: string[]): void {
    for (const path of paths) this.changed.add(path.replace(/\\/g, '/').replace(/^\.\//, ''))
  }
  accepts(report: VerificationReport | undefined): boolean {
    return (
      !!report &&
      report.runId === this.runId &&
      report.revision === this.revision &&
      report.checkRevision === this.checkRevision &&
      report.status === 'passed'
    )
  }
  begin(actionId: string, tool: string, args: Record<string, unknown>): void {
    if (this.pending.has(actionId) || this.completed.has(actionId))
      throw new Error('Duplicate action ID.')
    this.pending.set(actionId, { tool, args: structuredClone(args) })
  }
  complete(actionId: string, outcome: ToolOutcome): ActionRecord {
    const action = this.pending.get(actionId)
    if (!action) throw new Error('No pending action in the ledger.')
    const record = this.record(actionId, action.tool, action.args, outcome)
    this.pending.delete(actionId)
    return record
  }
  interrupt(): void {
    for (const id of this.pending.keys())
      this.complete(
        id,
        toolOutcome(
          'uncertain',
          'Interrupted before an outcome was recorded; changes may have occurred.'
        )
      )
    this.observations.clear()
  }
  record(
    actionId: string,
    tool: string,
    args: Record<string, unknown>,
    outcome: ToolOutcome
  ): ActionRecord {
    if (this.completed.has(actionId)) throw new Error('Action outcome already recorded.')
    if (
      outcome.execution !== 'not-started' &&
      ((tool === 'run_command' && args.purpose === 'check') ||
        (tool === 'run_npm' && args.action !== 'stop' && isRoutineNpm(args.args)))
    )
      this.currentCheckRevision++
    const observation = this.observations.get(String(args.observation))
    const readbackWindow =
      tool === 'act_on_control' && observation && observation.expiresAt > Date.now()
        ? observation.windowRef
        : undefined
    if (tool === 'act_on_control') this.observations.clear()
    for (const [id, entry] of this.observations)
      if (entry.expiresAt <= Date.now()) this.observations.delete(id)
    if (outcome.observation && ['observed', 'reported', 'verified'].includes(outcome.status)) {
      while (this.observations.size >= 4)
        this.observations.delete(this.observations.keys().next().value!)
      this.observations.set(outcome.observation.id, outcome.observation)
    }
    const mutation =
      (codingMutation(tool, args) || tool === 'create_directory') &&
      outcome.execution !== 'not-started'
        ? outcome.status === 'verified'
          ? 'applied'
          : 'possible'
        : 'none'
    if (mutation !== 'none') {
      this.currentRevision++
      if (
        codingMutation(tool, args) &&
        (tool !== 'delete_directory' || this.codingIntent || this.changed.size > 0)
      )
        this.changed.add(codingMutationPath(tool, args))
    }
    const record: ActionRecord = Object.freeze({
      actionId,
      runId: this.runId,
      tool,
      args: Object.freeze(structuredClone(args)),
      outcome,
      revision: this.revision,
      mutation,
      readbackWindow
    })
    this.completed.add(actionId)
    return record
  }
}
