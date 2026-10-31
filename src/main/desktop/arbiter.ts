import { onRunFinished, runById, type RunContext } from '../security/run-manager'

// Windows has one pointer, one keyboard focus and one foreground window. Parallel agents
// share them in turns: each input action (a click, keys, a batch, focusing or moving a
// window) holds a short input lease, granted first come first served. Between actions any
// agent can take the next turn. Accessibility actions and screenshots need no lease.
//
// An agent that acts in a window also claims it for a while, so two agents never drive
// the same app at once (one typing a message into a chat another is navigating away).

export const CLAIM_IDLE_MS = 30_000
const CLAIM_WAIT_MS = 20_000
const LEASE_WAIT_MS = 90_000

export type DesktopOwner = { runId: string; handle: string; title: string }
const owner = (run: RunContext): DesktopOwner => ({
  runId: run.id,
  handle: run.agent?.handle ?? 'main',
  title: run.agent?.title ?? 'Main task'
})
const alive = (run: RunContext): boolean => runById(run.id) === run && !run.signal.aborted

type Waiter = { run: RunContext; grant: () => void }
let holder: { run: RunContext; depth: number } | null = null
const queue: Waiter[] = []
const claims = new Map<number, { run: RunContext; at: number }>()
const changes = new Set<() => void>()
const notify = (): void => {
  for (const listener of [...changes]) listener()
}

export class WindowBusyError extends Error {
  readonly code = 'WINDOW_BUSY'
  constructor(
    message: string,
    readonly busyWith: DesktopOwner
  ) {
    super(message)
  }
}

// The agent currently driving the pointer and keyboard, if any.
export const desktopHolder = (): DesktopOwner | null => (holder ? owner(holder.run) : null)

// Who has claimed a window, when it is someone other than this run and the claim is live.
export function windowClaim(hwnd: number, run?: RunContext): DesktopOwner | null {
  const claim = claims.get(hwnd)
  if (!claim || claim.run === run) return null
  if (!alive(claim.run) || Date.now() - claim.at > CLAIM_IDLE_MS) {
    claims.delete(hwnd)
    return null
  }
  return owner(claim.run)
}

function abortable(run: RunContext, ms: number, register: (wake: () => void) => () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false
    const finish = (error?: unknown): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      unregister()
      run.signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = (): void => finish(run.signal.reason ?? new Error('Stopped.'))
    const timer = setTimeout(() => finish(), ms)
    const unregister = register(() => finish())
    run.signal.addEventListener('abort', onAbort, { once: true })
    if (run.signal.aborted) onAbort()
  })
}

async function awaitClaim(run: RunContext, hwnd: number, onWait?: (busy: DesktopOwner) => void): Promise<void> {
  const deadline = Date.now() + CLAIM_WAIT_MS
  let told = false
  for (;;) {
    run.signal.throwIfAborted()
    const busy = windowClaim(hwnd, run)
    if (!busy) return
    if (!told) {
      told = true
      onWait?.(busy)
    }
    const left = deadline - Date.now()
    if (left <= 0)
      throw new WindowBusyError(
        `This window is in use by agent ${busy.handle} ("${busy.title}"). No input was sent. Wait for that agent (check_agents), coordinate with message_agent, or work in another window.`,
        busy
      )
    // Claims also lapse on their own, so re-check at least every second.
    await abortable(run, Math.min(left, 1000), (wake) => {
      changes.add(wake)
      return () => changes.delete(wake)
    })
  }
}

async function acquire(run: RunContext, onWait?: (busy: DesktopOwner) => void): Promise<void> {
  if (holder?.run === run) {
    holder.depth++
    return
  }
  if (!holder && !queue.length) {
    holder = { run, depth: 1 }
    return
  }
  if (holder) onWait?.(owner(holder.run))
  let granted = false
  const waiter: Waiter = { run, grant: () => (granted = true) }
  queue.push(waiter)
  try {
    const deadline = Date.now() + LEASE_WAIT_MS
    while (!granted) {
      const left = deadline - Date.now()
      if (left <= 0)
        throw new Error(
          'Waited too long for the desktop while other agents used it. No input was sent; try again.'
        )
      await abortable(run, left, (wake) => {
        const grant = waiter.grant
        waiter.grant = () => {
          grant()
          wake()
        }
        return () => {
          waiter.grant = grant
        }
      })
    }
  } catch (error) {
    const index = queue.indexOf(waiter)
    if (index >= 0) queue.splice(index, 1)
    // Granted just as it gave up: pass the turn on.
    if (granted && holder?.run === run) release(run)
    throw error
  }
}

function release(run: RunContext): void {
  if (holder?.run !== run) return
  if (--holder.depth > 0) return
  holder = null
  while (queue.length) {
    const next = queue.shift()!
    if (!alive(next.run)) continue
    holder = { run: next.run, depth: 1 }
    next.grant()
    break
  }
  notify()
}

// Runs one desktop action for a run. With `input`, the action holds the input lease; with
// a window, it waits for (then refreshes) this run's claim on that window.
export async function withDesktop<T>(
  run: RunContext,
  options: { hwnd?: number; input: boolean; onWait?: (busy: DesktopOwner) => void },
  fn: () => Promise<T>
): Promise<T> {
  if (options.hwnd) await awaitClaim(run, options.hwnd, options.onWait)
  if (options.input) await acquire(run, options.onWait)
  try {
    // Re-check after a wait for the lease: another agent may have claimed it meanwhile.
    if (options.hwnd && options.input) {
      const busy = windowClaim(options.hwnd, run)
      if (busy)
        throw new WindowBusyError(
          `This window is in use by agent ${busy.handle} ("${busy.title}"). No input was sent. Wait for that agent (check_agents), coordinate with message_agent, or work in another window.`,
          busy
        )
    }
    if (options.hwnd) claims.set(options.hwnd, { run, at: Date.now() })
    return await fn()
  } finally {
    if (options.hwnd && claims.get(options.hwnd)?.run === run)
      claims.set(options.hwnd, { run, at: Date.now() })
    if (options.input) release(run)
    else notify()
  }
}

// A finished run gives up its turn, its place in line and its window claims.
onRunFinished((run) => {
  for (const [hwnd, claim] of claims) if (claim.run === run) claims.delete(hwnd)
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].run === run) queue.splice(i, 1)
  if (holder?.run === run) {
    holder.depth = 1
    release(run)
  } else notify()
})
