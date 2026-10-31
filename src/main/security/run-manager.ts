import { PROBE_LIMIT, actionLimit, isBookkeepingTool, runSeconds } from '../../shared/loop-limits'
import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'

// Who a run is working for when several agents share one chat. The root chat's own run is
// handle "main"; spawned agents get a1, a2… and a colour shared by their thread and cursor.
export interface RunAgent {
  readonly handle: string
  readonly title: string
  readonly color: string
  readonly chatId: string
  readonly rootChatId: string
  readonly depth: number
  readonly kind: AgentKind
}
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
  readonly agent?: RunAgent
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
  // Messages the user or another agent sent to this chat while the run was working.
  followUps?: { pending: () => boolean; take: () => FollowUp[] }
  searchUnavailable: boolean
}
export type FollowUp = {
  text: string
  attachments: string[]
  // Set when another agent sent the message rather than the user.
  sender?: AgentSender
}
type ActiveRun = { run: RunContext; controller: AbortController; timer: NodeJS.Timeout }
// Several runs can be active at once (parallel agents). Each async call chain carries its
// own run, so tools always act for the run that started them.
const active = new Map<string, ActiveRun>()
const scope = new AsyncLocalStorage<RunContext>()
// Absolute ceiling regardless of settings; each run holds a model stream and maybe a worker.
export const RUN_CEILING = 6
let runLimit = 1
export function setRunLimit(limit: number): void {
  runLimit = Math.max(1, Math.min(RUN_CEILING, Math.floor(limit) || 1))
}
const finishedListeners = new Set<(run: RunContext) => void>()
// Lets per-run state (captures, window claims, cursors) drop its entries when a run ends.
export function onRunFinished(listener: (run: RunContext) => void): () => void {
  finishedListeners.add(listener)
  return () => {
    finishedListeners.delete(listener)
  }
}
// The deadline can move later while a run makes progress, so the timer re-arms itself
// for whatever remains instead of firing at a fixed time.
function armDeadline(run: RunContext): NodeJS.Timeout {
  const remaining = runSeconds(run) * 1000 - (performance.now() - run.startedAt)
  return setTimeout(
    () => {
      const entry = active.get(run.id)
      if (entry?.run !== run) return
      if (runSeconds(run) * 1000 - (performance.now() - run.startedAt) > 1000)
        entry.timer = armDeadline(run)
      else stopRun(run.id)
    },
    Math.max(1000, remaining)
  )
}
let revision = 0
let interfacePresence: () => InterfacePresence | undefined = () => undefined
export function setInterfacePresenceProvider(provider: () => InterfacePresence | undefined): void {
  interfacePresence = provider
}
// The run of the current async call chain. Outside any run's chain (an IPC handler, a
// single-run test) the only active run is current; with several active, none is.
export function currentRun(): RunContext | undefined {
  const scoped = scope.getStore()
  if (scoped) return active.get(scoped.id)?.run === scoped ? scoped : undefined
  if (active.size !== 1) return undefined
  return active.values().next().value!.run
}
// Runs fn (and everything it awaits) as the given run.
export function withRun<T>(run: RunContext, fn: () => T): T {
  return scope.run(run, fn)
}
export const anyRunActive = (): boolean => active.size > 0
export const activeRunCount = (): number => active.size
export const activeRuns = (): RunContext[] => [...active.values()].map((entry) => entry.run)
export const runById = (id: string): RunContext | undefined => active.get(id)?.run
export function assertRun(run: RunContext): void {
  run.signal.throwIfAborted()
  if (active.get(run.id)?.run !== run || run.policyRevision !== revision)
    throw new Error('This task is no longer authorized.')
}
// Stops one run, or every run when no id is given.
export function stopRun(id?: string): void {
  const entries = typeof id === 'string' ? [active.get(id)].filter(Boolean) : [...active.values()]
  for (const entry of entries as ActiveRun[]) {
    entry.controller.abort(new Error('Stopped. No further actions will run.'))
    clearTimeout(entry.timer)
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
  interaction: InteractionContext = { surface: 'full-app', input: 'text' },
  agent?: RunAgent
): RunContext {
  if (mode !== 'assistant')
    throw new Error('Unsupported task mode. Sophon uses one assistant runtime.')
  if (active.size >= runLimit)
    throw new Error(
      runLimit === 1
        ? 'A task is already running.'
        : `Sophon is already running ${active.size} tasks, the most at once allowed in Settings > Agents. Wait for one to finish or stop one.`
    )
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
    agent: agent ? Object.freeze({ ...agent }) : undefined,
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
  active.set(run.id, { run, controller, timer: armDeadline(run) })
  return run
}
export function finishRun(run: RunContext): void {
  const entry = active.get(run.id)
  if (entry?.run !== run) return
  clearTimeout(entry.timer)
  entry.controller.abort()
  active.delete(run.id)
  for (const listener of finishedListeners) {
    try {
      listener(run)
    } catch {
      // Cleanup of one subsystem must not keep the others holding this run's state.
    }
  }
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
