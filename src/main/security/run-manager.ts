import { ACTION_LIMIT, RUN_SECONDS, isBookkeepingTool } from '../../shared/loop-limits'
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
  searches: number
  pages: number
  modelCallLimit?: number
  modelCalls: number
  usage?: RequestUsage
  onModelUsage?: (usage: RequestUsage) => void
  onModelContext?: (context: ContextMeasurements) => void
  searchUnavailable: boolean
}
let active: { run: RunContext; controller: AbortController; timer: NodeJS.Timeout } | null = null
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
    searches: 0,
    pages: 0,
    modelCallLimit: undefined,
    modelCalls: 0,
    usage: undefined,
    onModelUsage: undefined,
    onModelContext: undefined,
    searchUnavailable: false
  })
  const timer = setTimeout(stopRun, RUN_SECONDS * 1000)
  active = { run, controller, timer }
  return run
}
export function finishRun(run: RunContext): void {
  if (active?.run !== run) return
  clearTimeout(active.timer)
  active.controller.abort()
  active = null
}
export function consumeToolBudget(run: RunContext, name = ''): void {
  assertRun(run)
  if (isBookkeepingTool(name)) return
  if (run.tools >= ACTION_LIMIT)
    throw new Error(`The task reached its ${ACTION_LIMIT}-action limit.`)
  run.tools++
}
