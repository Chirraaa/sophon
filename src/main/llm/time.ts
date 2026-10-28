import { performance } from 'node:perf_hooks'

export function timeContext(started: number, now = new Date()): string {
  return [
    'LIVE HOST CLOCK (refreshed for this model request):',
    `Current UTC time: ${now.toISOString()}.`,
    `Local time: ${now.toString()}. Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    `Elapsed task time: ${Math.max(0, Math.floor(performance.now() - started))} ms.`,
    'Use these timestamps for dates and elapsed time. For monitoring, wait (when available) pauses within this task; there is no background scheduling after the task ends.'
  ].join('\n')
}
