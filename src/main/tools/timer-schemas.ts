import { TIMER_LABEL_MAX, TIMER_MAX_SECONDS, TIMER_MIN_SECONDS } from '../../shared/timers'

export const timerSchemas = [
  {
    type: 'function',
    function: {
      name: 'timer_set',
      description:
        'Start a countdown timer that keeps running in the background and shows in the app and the shortcut window. Convert the requested time to seconds yourself (for example 5 minutes is 300). The user is alerted when it ends, so do not wait or poll. Up to 5 timers run at once.',
      parameters: {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description: `Length in seconds, ${TIMER_MIN_SECONDS} to ${TIMER_MAX_SECONDS}.`
          },
          label: {
            type: 'string',
            maxLength: TIMER_LABEL_MAX,
            description: 'Short name, such as "Tea" or "Break". Optional.'
          }
        },
        required: ['seconds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'timer_cancel',
      description:
        'Cancel a running timer by its id from timer_set. Without an id, cancels every running timer.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^timer-[0-9a-f]{12}$', description: 'Id from timer_set.' }
        }
      }
    }
  }
]
