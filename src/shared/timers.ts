// Countdown timers the assistant sets on request. They live in the main process so the
// full window and the shortcut window show the same clock.
export const TIMER_MIN_SECONDS = 1
export const TIMER_MAX_SECONDS = 24 * 60 * 60
export const TIMER_LIMIT = 5
export const TIMER_LABEL_MAX = 60

export interface TimerInfo {
  id: string
  label: string
  durationMs: number
  /** Epoch milliseconds at which the countdown reaches zero. */
  endsAt: number
  state: 'running' | 'done'
}

/** Clock text for a remaining time: 4:32, or 1:02:03 from an hour up. Rounds up so 0:00 means done. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** Spoken-style length, for confirmations: "1 hour 30 minutes", "45 seconds". */
export function describeDuration(seconds: number): string {
  const total = Math.round(seconds)
  const parts: string[] = []
  const unit = (value: number, name: string): void => {
    if (value > 0) parts.push(`${value} ${name}${value === 1 ? '' : 's'}`)
  }
  unit(Math.floor(total / 3600), 'hour')
  unit(Math.floor((total % 3600) / 60), 'minute')
  unit(total % 60, 'second')
  return parts.join(' ') || '0 seconds'
}
