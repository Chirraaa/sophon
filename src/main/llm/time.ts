import { performance } from 'node:perf_hooks'

export function timeContext(started: number, now = new Date()): string {
  return [
    'LIVE HOST CLOCK (refreshed for this model request):',
    `Current UTC time: ${now.toISOString()}.`,
    `Local time: ${now.toString()}. Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    `Elapsed task time: ${Math.max(0, Math.floor(performance.now() - started))} ms.`,
    'Use host timestamps to assess elapsed time; token counts and reasoning are not clocks. Time continues passing during generation and tool calls. Use wait when available to pause and resume within this active task, then inspect again for monitoring requests. Waiting alone does not observe the desktop. Respect remaining action, model-step and task limits. There is no background scheduling or automatic wake-up after the task ends.'
  ].join('\n')
}
