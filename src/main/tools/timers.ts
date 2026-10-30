import { toolOutcome, type ToolOutcome } from '../workflow/tool-outcome'
import { describeDuration } from '../../shared/timers'
import { TimerError, listTimers, removeTimer, startTimer } from '../services/timers'

export function executeTimerTool(
  name: string,
  args: Record<string, unknown>
): string | ToolOutcome {
  try {
    if (name === 'timer_set') {
      const timer = startTimer(Number(args.seconds), (args.label as string | undefined) ?? '')
      const named = timer.label ? ` "${timer.label}"` : ''
      return `Timer${named} started for ${describeDuration(timer.durationMs / 1000)} (id ${timer.id}). It counts down in the app and the user is alerted when it ends.`
    }
    const running = listTimers().filter((timer) => timer.state === 'running')
    const targets = args.id ? running.filter((timer) => timer.id === args.id) : running
    if (!targets.length)
      return toolOutcome(
        'failed',
        args.id ? 'No running timer has that id.' : 'No timer is running.',
        {
          execution: 'not-started',
          code: 'target-missing'
        }
      )
    targets.forEach((timer) => removeTimer(timer.id))
    return `Cancelled ${targets.length === 1 ? 'the timer' : `${targets.length} timers`}.`
  } catch (error) {
    if (error instanceof TimerError)
      return toolOutcome('failed', `Timer not changed: ${error.message}`, {
        execution: 'not-started',
        code: 'execution-error'
      })
    return toolOutcome('uncertain', `Tool error: ${(error as Error).message}`, {
      execution: 'unknown'
    })
  }
}
