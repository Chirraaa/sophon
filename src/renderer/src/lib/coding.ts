import { replyActivity } from './activity'

export function previewData(preview?: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse((preview ?? '').slice((preview ?? '').indexOf('{')))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}
export function patchEdits(
  args: Record<string, unknown>
): { old_text: string; new_text: string }[] {
  const edits = Array.isArray(args.edits) ? args.edits : [args]
  return edits
    .slice(0, 12)
    .filter(
      (edit) => edit && typeof edit.old_text === 'string' && typeof edit.new_text === 'string'
    )
}
export function patchLines(
  before: string,
  after: string
): { kind: 'context' | 'remove' | 'add'; text: string }[] {
  const old = before === '' ? [] : before.split(/\r?\n/)
  const next = after === '' ? [] : after.split(/\r?\n/)
  let start = 0,
    end = 0
  while (start < old.length && start < next.length && old[start] === next[start]) start++
  while (
    end < old.length - start &&
    end < next.length - start &&
    old[old.length - end - 1] === next[next.length - end - 1]
  )
    end++
  return [
    ...old.slice(Math.max(0, start - 2), start).map((text) => ({ kind: 'context' as const, text })),
    ...old.slice(start, old.length - end).map((text) => ({ kind: 'remove' as const, text })),
    ...next.slice(start, next.length - end).map((text) => ({ kind: 'add' as const, text })),
    ...old
      .slice(old.length - end, old.length - end + Math.min(end, 2))
      .map((text) => ({ kind: 'context' as const, text }))
  ]
}
export function codingView(item: ChatItem): {
  label: string
  stage: number
  attention: boolean
  completed: number
  current: string
} {
  const session = item.workflow?.codingSession
  const outcome = item.workflow?.outcome
  const completed = session?.tasks.filter((task) => task.status === 'verified').length ?? 0
  const active = session?.tasks.find((task) => task.status === 'active')
  const attention = ['needs_review', 'interrupted', 'blocked'].includes(outcome ?? '')
  let stage = !session?.plan ? 0 : active ? 1 : 2
  if (item.pending && ['write_file', 'edit_file'].includes(item.modelProgress?.toolName ?? ''))
    stage = 1
  if (item.specialists?.some((agent) => agent.status === 'running')) stage = 3
  if (
    item.actions.some(
      (action) => action.status === 'running' && ['run_npm', 'run_command'].includes(action.name)
    )
  )
    stage = 2
  const waiting = item.actions.some((action) => action.status === 'waiting')
  const label = waiting
    ? 'Your approval is needed'
    : outcome === 'interrupted'
      ? 'Paused'
      : outcome === 'blocked'
        ? 'Permission declined'
        : outcome === 'needs_review'
          ? 'Needs attention'
          : !item.pending
            ? session?.plan
              ? 'Finished'
              : outcome === 'answered' || outcome === 'actions_checked'
                ? 'Finished'
                : 'Waiting for your input'
            : ['Planning', 'Making changes', 'Checking changes', 'Reviewing'][stage]
  return {
    label,
    stage,
    attention,
    completed,
    current:
      !item.pending && attention
        ? (item.text?.match(
            /(?:^|\n)(Error: .+|Stopped[^\n]*|Coding work is incomplete\.[^\n]*|Coding task verification stopped\.[^\n]*|Code changes are not verified\.[^\n]*)/
          )?.[1] ??
          item.workflow?.nextStep ??
          'Work stopped before completion. Open the task evidence for details.')
        : ((item.pending && item.modelProgress ? replyActivity(item) : active?.title) ??
          (!session?.plan
            ? item.pending
              ? 'Working on the request'
              : 'Open the details to review the result'
            : item.pending
              ? 'Working through checks and review'
              : 'Open the details to review the result'))
  }
}
export function codingFiles(
  item: ChatItem
): { action: ToolAction; args: Record<string, unknown>; path: string }[] {
  return item.actions
    .filter((action) =>
      ['edit_file', 'write_file', 'delete_file', 'delete_directory'].includes(action.name)
    )
    .flatMap((action) => {
      const args = previewData(action.preview)?.arguments as Record<string, unknown> | undefined
      return args && typeof args.path === 'string' ? [{ action, args, path: args.path }] : []
    })
}
export function codingChecks(item: ChatItem): {
  action: ToolAction
  command: string
  status: string
  output: string
  path: string
  url?: string
}[] {
  return item.actions
    .filter((action) => ['run_npm', 'run_command'].includes(action.name))
    .map((action) => {
      const args = previewData(action.preview)?.arguments as
        { args?: string[]; path?: string; action?: string; command?: string } | undefined
      let status: string =
        action.status === 'waiting'
          ? 'Awaiting approval'
          : action.status === 'running'
            ? 'Running'
            : 'Unverified'
      let output = action.detail || 'Waiting for the command result.'
      let url: string | undefined
      try {
        const result = JSON.parse(action.detail ?? '')
        if (result.stopped) status = 'Stopped'
        else if (result.running === true) status = 'Server running'
        else if (Number.isInteger(result.exitCode))
          status = result.exitCode === 0 ? 'Passed' : `Failed (${result.exitCode})`
        if (typeof result.output === 'string') output = result.output
        else if (typeof result.output?.content === 'string') output = result.output.content
        if (result.running === true && typeof result.url === 'string')
          output = `Preview: ${result.url}\n\n${output}`
        if (
          result.running === true &&
          /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\//.test(result.url)
        )
          url = result.url
      } catch {
        if (action.status === 'failed') status = 'Stopped'
      }
      return {
        action,
        command:
          action.name === 'run_command'
            ? String(args?.command ?? 'Project command')
            : (args?.action === 'stop' ? 'Stop server: npm ' : 'npm ') +
              (Array.isArray(args?.args)
                ? args.args.filter((value) => typeof value === 'string').join(' ')
                : 'command'),
        status,
        url,
        output,
        path: typeof args?.path === 'string' ? args.path : '.'
      }
    })
}
export function latestCodingItem(items: ChatItem[]): ChatItem | undefined {
  const latest = items.at(-1)
  return latest?.from === 'agent' && latest.workflow?.codingSession ? latest : undefined
}

export function shortcutCodingItem(items: ChatItem[]): ChatItem | undefined {
  const latest = items.at(-1)
  if (latest?.pending || latest?.from === 'you')
    return items.findLast((item) => item.from === 'agent' && !!item.workflow?.codingSession)
  return latestCodingItem(items)
}
