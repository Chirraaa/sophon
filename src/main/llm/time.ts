import { performance } from 'node:perf_hooks'
import type { ModelMessage } from './types'

export function timeContext(started: number, now = new Date()): string {
  return [
    'LIVE HOST CLOCK (refreshed for this model request):',
    `Current UTC time: ${now.toISOString()}.`,
    `Local time: ${now.toString()}. Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    `Elapsed task time: ${Math.max(0, Math.floor(performance.now() - started))} ms.`,
    'Use these timestamps for dates and elapsed time. For monitoring, wait (when available) pauses within this task; there is no background scheduling after the task ends.'
  ].join('\n')
}

/**
 * The clock changes on every request, so it goes after the stable prefix (tools, instructions,
 * history) instead of inside the system message. Prompt caches match from the first token, and a
 * changing clock at the head forced the whole conversation to be reprocessed on every model call.
 * Only the last user or tool message is copied and extended; stored history is untouched. When no
 * such message ends the request, the clock stays in the system message.
 */
export function withClock(messages: ModelMessage[], clock: string): ModelMessage[] {
  const last = messages[messages.length - 1]
  if (last && (last.role === 'user' || last.role === 'tool')) {
    const content =
      typeof last.content === 'string'
        ? last.content + '\n\n' + clock
        : [...last.content, { type: 'text' as const, text: clock }]
    return [...messages.slice(0, -1), { ...last, content }]
  }
  const head = messages[0]
  if (head?.role === 'system' && typeof head.content === 'string')
    return [{ ...head, content: head.content + '\n\n' + clock }, ...messages.slice(1)]
  return [{ role: 'system', content: clock }, ...messages]
}
