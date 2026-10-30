import { useEffect, useState } from 'react'
import type { TimerInfo } from '../../../shared/timers'

/** The assistant's timers, kept in step with the main process. Ticks once a second while any runs. */
export function useTimers(): { timers: TimerInfo[]; now: number } {
  const [timers, setTimers] = useState<TimerInfo[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let current = true
    const apply = (list: TimerInfo[]): void => {
      if (!current) return
      // Read the clock with the list so a new timer never renders against an old time.
      setNow(Date.now())
      setTimers(list)
    }
    void window.api.timers.list().then(apply)
    const detach = window.api.timers.onChange(apply)
    return () => {
      current = false
      detach()
    }
  }, [])
  const running = timers.some((timer) => timer.state === 'running')
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [running])
  return { timers, now }
}
