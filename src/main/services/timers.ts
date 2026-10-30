import { randomBytes } from 'crypto'
import {
  TIMER_LABEL_MAX,
  TIMER_LIMIT,
  TIMER_MAX_SECONDS,
  TIMER_MIN_SECONDS,
  type TimerInfo
} from '../../shared/timers'

export class TimerError extends Error {}

const timers = new Map<string, TimerInfo>()
const handles = new Map<string, NodeJS.Timeout>()
const changeListeners = new Set<(timers: TimerInfo[]) => void>()
const doneListeners = new Set<(timer: TimerInfo) => void>()

export const listTimers = (): TimerInfo[] =>
  [...timers.values()].sort((a, b) => a.endsAt - b.endsAt)
const publish = (): void => {
  const snapshot = listTimers()
  for (const listener of changeListeners) listener(snapshot)
}

export function onTimersChange(listener: (timers: TimerInfo[]) => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
export function onTimerDone(listener: (timer: TimerInfo) => void): () => void {
  doneListeners.add(listener)
  return () => doneListeners.delete(listener)
}

export function startTimer(seconds: number, label: string): TimerInfo {
  if (!Number.isFinite(seconds) || seconds < TIMER_MIN_SECONDS || seconds > TIMER_MAX_SECONDS)
    throw new TimerError('A timer must run between 1 second and 24 hours.')
  if ([...timers.values()].filter((timer) => timer.state === 'running').length >= TIMER_LIMIT)
    throw new TimerError(`Only ${TIMER_LIMIT} timers can run at once. Cancel one first.`)
  const durationMs = Math.round(seconds * 1000)
  const timer: TimerInfo = {
    id: `timer-${randomBytes(6).toString('hex')}`,
    label: label.trim().slice(0, TIMER_LABEL_MAX),
    durationMs,
    endsAt: Date.now() + durationMs,
    state: 'running'
  }
  timers.set(timer.id, timer)
  const handle = setTimeout(() => finish(timer.id), durationMs)
  handles.set(timer.id, handle)
  publish()
  return timer
}

function finish(id: string): void {
  const timer = timers.get(id)
  handles.delete(id)
  if (!timer || timer.state !== 'running') return
  const done: TimerInfo = { ...timer, state: 'done', endsAt: Date.now() }
  timers.set(id, done)
  publish()
  for (const listener of doneListeners) listener(done)
}

/** Stops a running timer or clears a finished one. Returns whether anything was removed. */
export function removeTimer(id: string): boolean {
  const handle = handles.get(id)
  if (handle) clearTimeout(handle)
  handles.delete(id)
  const removed = timers.delete(id)
  if (removed) publish()
  return removed
}
