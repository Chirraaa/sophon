import { fallbackActionLabel } from '../../../shared/action-label'

export function actionLabel(action: ToolAction): string {
  return action.label?.trim() && action.label !== 'Unknown action'
    ? action.label
    : fallbackActionLabel(action.name)
}

const STATUS: Record<ToolActionStatus, string> = {
  running: 'In progress',
  waiting: 'Awaiting approval',
  done: 'Complete',
  failed: 'Stopped or failed'
}

function compact(text: string, limit = 220): string {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value
}

export function actionError(action: ToolAction): string | undefined {
  if (action.status !== 'failed' || !action.detail?.trim()) return undefined
  const detail = action.detail.trim()
  if (/[{}[\]]|sourceId|untrusted-data|\\u[0-9a-f]{4}/i.test(detail))
    return 'The action could not be completed.'
  return compact(detail)
}

export function actionHint(action: ToolAction): string {
  const error = actionError(action)
  return `${actionLabel(action)} · ${STATUS[action.status]}${error ? '\n' + error : ''}`
}
