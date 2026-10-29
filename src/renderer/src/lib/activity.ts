import { VISUAL_FENCE } from '../../../shared/visuals'

const toolActivities: Record<string, string> = {
  web_search: 'Searching the web',
  web_fetch: 'Reading a web page',
  inspect_app: 'Reading app controls',
  act_on_control: 'Using app controls',
  open_app: 'Opening an app',
  list_apps: 'Finding installed apps',
  list_windows: 'Checking open windows',
  move_window: 'Moving a window',
  look_at_screen: 'Looking at the screen',
  focus_window: 'Focusing a window',
  close_window: 'Closing a window',
  close_app: 'Closing an app',
  click: 'Clicking',
  scroll: 'Scrolling',
  press_keys: 'Pressing keys',
  type_text: 'Typing text',
  list_files: 'Browsing files',
  read_file: 'Reading a file',
  write_file: 'Writing a file',
  edit_file: 'Applying a patch',
  delete_file: 'Deleting a project file',
  delete_directory: 'Deleting a project folder',
  coding_resources: 'Adjusting coding capacity',
  coding_checkpoint: 'Saving task progress',
  run_command: 'Running a project command',
  run_npm: 'Running project checks'
}

export function actionActivity(actions: ToolAction[]): string | undefined {
  const waiting = actions.findLast((action) => action.status === 'waiting')
  if (waiting) return `Waiting for approval: ${waiting.label}`
  const running = actions.findLast((action) => action.status === 'running')
  if (running) return `${toolActivities[running.name] ?? running.label}…`
  return undefined
}

export function replyActivity(item: ChatItem): string {
  const action = actionActivity(item.actions)
  if (action) return action
  if (item.compaction?.status === 'running') return 'Compacting context…'
  if (item.quality === 'checking') return 'Checking answer…'
  const specialist = item.specialists?.findLast((agent) => agent.status === 'running')
  if (specialist) {
    return {
      researcher: 'Consulting the researcher…',
      visual_explainer: 'Preparing a visual explanation…',
      tutor: 'Consulting the tutor…',
      reviewer: 'Consulting the reviewer…'
    }[specialist.profile]
  }
  if (VISUAL_FENCE.test(item.text)) return 'Building visual…'
  return item.text ? 'Writing a response…' : 'Thinking…'
}
