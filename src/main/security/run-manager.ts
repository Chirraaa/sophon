import { PROBE_LIMIT, actionLimit, isBookkeepingTool, runSeconds } from '../../shared/loop-limits'
import { randomUUID } from 'crypto'

export interface RunContext {
  readonly sources: ResearchSource[]
  readonly id: string
  readonly startedAt: number
  readonly mode: TaskMode
  readonly endpoint: string
  readonly workspace: string
  readonly signal: AbortSignal
  readonly policyRevision: number
  readonly interaction: InteractionContext
  readonly interfacePresence?: InterfacePresence
  tools: number
  // Raised by the coding harness while verification shows progress; capped in loop-limits.
  actionLimit?: number
  deadlineSeconds?: number
  probes?: number
  searches: number
  pages: number
  images: number
  modelCallLimit?: number
  modelCalls: number
  usage?: RequestUsage
  onModelUsage?: (usage: RequestUsage) => void
  timing?: RequestTiming
  onTiming?: (timing: RequestTiming) => void
  onModelContext?: (context: ContextMeasurements) => void
  // Messages the user sent to this chat while the run was working.
  followUps?: { pending: () => boolean; take: () => FollowUp[] }
  searchUnavailable: boolean
}
export type FollowUp = { text: string; attachments: string[] }
let active: { run: RunContext; controller: AbortController; timer: NodeJS.Timeout } | null = null
// The deadline can move later while a run makes progress, so the timer re-arms itself
// for whatever remains instead of firing at a fixed time.
function armDeadline(run: RunContext): NodeJS.Timeout {
  const remaining = runSeconds(run) * 1000 - (performance.now() - run.startedAt)
  return setTimeout(
    () => {
      if (active?.run !== run) return
      if (runSeconds(run) * 1000 - (performance.now() - run.startedAt) > 1000)
        active.timer = armDeadline(run)
      else stopRun()
    },
    Math.max(1000, remaining)
  )
}
let revision = 0
let interfacePresence: () => InterfacePresence | undefined = () => undefined
export function setInterfacePresenceProvider(provider: () => InterfacePresence | undefined): void {
  interfacePresence = provider
}
export const currentRun = (): RunContext | undefined => active?.run
export function assertRun(run: RunContext): void {
  run.signal.throwIfAborted()
  if (active?.run !== run || run.policyRevision !== revision)
    throw new Error('This task is no longer authorized.')
}
export function stopRun(): void {
  if (active) {
    active.controller.abort(new Error('Stopped. No further actions will run.'))
    clearTimeout(active.timer)
  }
}
export function revokePolicy(): void {
  revision++
  stopRun()
}
export function startRun(
  mode: TaskMode,
  endpoint: string,
  workspace: string,
  interaction: InteractionContext = { surface: 'full-app', input: 'text' }
): RunContext {
  if (mode !== 'assistant')
    throw new Error('Unsupported task mode. Sophon uses one assistant runtime.')
  if (active) throw new Error('A task is already running.')
  const controller = new AbortController()
  const run: RunContext = Object.seal({
    id: randomUUID(),
    startedAt: performance.now(),
    mode,
    endpoint,
    workspace,
    signal: controller.signal,
    sources: [],
    policyRevision: revision,
    interaction: Object.freeze({ ...interaction }),
    get interfacePresence() {
      return interfacePresence()
    },
    tools: 0,
    actionLimit: undefined,
    deadlineSeconds: undefined,
    probes: 0,
    searches: 0,
    pages: 0,
    images: 0,
    modelCallLimit: undefined,
    modelCalls: 0,
    usage: undefined,
    onModelUsage: undefined,
    timing: undefined,
    onTiming: undefined,
    onModelContext: undefined,
    followUps: undefined,
    searchUnavailable: false
  })
  active = { run, controller, timer: armDeadline(run) }
  return run
}
export function finishRun(run: RunContext): void {
  if (active?.run !== run) return
  clearTimeout(active.timer)
  active.controller.abort()
  active = null
}
export function consumeToolBudget(
  run: RunContext,
  name = '',
  budget: 'action' | 'probe' = 'action'
): void {
  assertRun(run)
  if (budget === 'probe') {
    if ((run.probes ?? 0) >= PROBE_LIMIT)
      throw new Error(`The task reached its ${PROBE_LIMIT}-probe verification limit.`)
    run.probes = (run.probes ?? 0) + 1
    return
  }
  if (isBookkeepingTool(name)) return
  const limit = actionLimit(run)
  if (run.tools >= limit) throw new Error(`The task reached its ${limit}-action limit.`)
  run.tools++
}
