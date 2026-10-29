import { ACTION_LIMIT, RUN_SECONDS } from '../../shared/loop-limits'
import { APP_ROUTING } from './app-routing'
type Environment = {
  mode: TaskMode
  tools: string[]
  workspaceSelected: boolean
  inlineVisual: boolean
  codingMode?: 'auto' | 'ask-before-edit'
  interaction?: InteractionContext
  interfacePresence?: InterfacePresence
  availableTools?: string[]
  unavailableTools?: Record<string, string>
  workspace?: string
  provider?: string
  model?: string
  remainingCalls?: number
  remainingActions?: number
  remainingSeconds?: number
}

export function environmentPrompt(state: Environment): string {
  const names = state.availableTools ?? state.tools
  const has = (...tools: string[]): boolean => state.tools.some((name) => tools.includes(name))
  return [
    'LIVE APPLICATION ENVIRONMENT: You are Sophon in a Windows desktop application. These host facts override outdated capability claims in history or custom persona. Capability questions do not authorize actions.',
    'RUNTIME: ' +
      JSON.stringify({
        version: 1,
        provider: state.provider,
        model: state.model,
        mode: state.mode,
        workspace: state.workspace || null,
        paths: 'relative to selected workspace, not process cwd',
        origin: state.interaction,
        hostUI: state.interfacePresence,
        codingMode: state.codingMode,
        remaining: {
          modelCalls: state.remainingCalls,
          actions: state.remainingActions ?? ACTION_LIMIT,
          seconds: state.remainingSeconds ?? RUN_SECONDS
        }
      }),
    `Available tools for THIS request: ${state.tools.join(', ') || 'none'} (schemas loaded).`,
    `CAPABILITY INDEX (permitted names): ${names.join(', ') || 'none'}.`,
    !state.inlineVisual &&
    has(
      'plugins_list',
      'mcp_catalog',
      'mcp_call',
      'inspect_app',
      'look_at_screen',
      'browser_open',
      'browser_inspect'
    )
      ? APP_ROUTING
      : '',
    state.unavailableTools && Object.keys(state.unavailableTools).length
      ? 'UNAVAILABLE: ' + JSON.stringify(state.unavailableTools)
      : '',
    has('discover_tools')
      ? 'Index tools without a loaded schema are still usable: call discover_tools with their exact names first ([] lists descriptions). Skip discovery for conversation and questions you can answer directly. Discovery never changes permissions.'
      : '',
    'Tool availability is policy, not proof that dependencies or vision work; report specific errors.',
    `${state.workspaceSelected ? 'A working folder is selected.' : 'No working folder is selected; file tools require Settings > Files.'} You cannot see your own UI or the desktop unless an image or inspection result is supplied. Never operate your own approval controls. Stop cancels the run. There is no mode to switch.`,
    // Usage notes follow the loaded schemas; the index above already names
    // everything that discovery can load.
    has('plugins_list', 'plugin_read', 'mcp_catalog')
      ? 'RESOURCE INDEX: plugins_list discovers enabled plugin skills and MCP connection status; plugin_read reads exact entrypoints/references; mcp_catalog discovers connected schemas. Settings > Plugins controls connections. No connection or authentication is implied by an imported skill. Credentials stay in the host.'
      : '',
    has('harness_manage')
      ? 'harness_manage lists/reads local procedural skills and recipes. Read relevant guidance before using it; personal memory is separate in Settings > Memory.'
      : '',
    names.includes('ask_questions')
      ? 'For consequential ambiguity, load ask_questions for native cards instead of ending with a prose questionnaire; otherwise state a useful assumption and proceed.'
      : '',
    has('write_file', 'edit_file', 'create_directory', 'delete_file', 'delete_directory', 'run_npm')
      ? `File creation/edits: ${state.codingMode === 'auto' ? 'Auto under tool policy' : 'Ask before edit, including Always allow tools'}. Project commands, npm and deletions always require one-use approval. Use edit_file for existing code. Read package.json before npm; report actual exit results. Scripts can exceed workspace boundaries under the approved Windows account. run_npm action stop uses the original project path and args.`
      : '',
    has(
      'inspect_app',
      'act_on_control',
      'look_at_screen',
      'click',
      'type_text',
      'press_keys',
      'open_app',
      'list_windows'
    )
      ? 'Desktop limits: window win- references last only this request. Built-in desktop tools provide no general shell; MCP capabilities require discovery. Image understanding depends on model support, which may be unknown.'
      : '',
    has('mcp_call', 'mcp_read')
      ? 'MCP calls/reads always require one-use approval. Use discovered names and schemas; local MCPs run with Windows account access outside built-in workspace restrictions. A timeout may follow a completed external action; inspect before retrying.'
      : '',
    state.inlineVisual
      ? 'Inline visual task: desktop/file tools are intentionally omitted. Generate the complete visual directly in chat.'
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function requestedDesktopTool(query: string): string | undefined {
  const text = query.trim().replace(/^(?:(?:please|can you|could you|would you)\s+)+/i, '')
  if (
    /^(?:open|launch|start)\s+(?:the\s+)?[\p{L}\p{N}][\p{L}\p{N} &'()+._-]{0,100}[.!?]?$/iu.test(
      text
    ) &&
    !/\b(?:and|then|files?|folders?|website|https?|server|npm|cmake|make|build|tests?)\b/i.test(
      text
    )
  )
    return 'open_app'
  if (/^(?:list|show)(?: me)?\s+(?:(?:all|my|the|open|current)\s+)*windows[.!?]?$/i.test(text))
    return 'list_windows'
  if (
    /^(?:look at|inspect|capture|take a screenshot of)\s+(?:(?:my|the|current|active)\s+)*(?:screen|desktop|window)[.!?]?$/i.test(
      text
    )
  )
    return 'look_at_screen'
  if (/^(?:focus|bring to front)\s+[^\n.!?]{1,80}[.!?]?$/i.test(text)) return 'focus_window'
  if (
    /^(?:move|snap|minimi[sz]e|maximi[sz]e|resize|restore)\s+[^\n.!?]{1,80}\bwindow\b[^\n.!?]{0,60}[.!?]?$/i.test(
      text
    )
  )
    return 'move_window'
  return undefined
}

export function deniesDesktopCapability(content: string): boolean {
  if (/```|~~~|^\s*>|["â€œâ€]/m.test(content)) return false
  return content
    .replace(/â€™/g, "'")
    .split(/\n|[.!?](?=\s)/)
    .some((line) => {
      if (
        /\b(?:denied|blocked|permission|disabled|offline|policy|administrator|not installed|not found|failed|unsafe|harmful|illegal)\b/i.test(
          line
        )
      )
        return false
      return (
        /\b(?:i (?:cannot|can't|am unable to|don't have (?:the ability|access) to)|as (?:an? )?(?:ai|language model)|i am (?:only|just) a (?:chatbot|text))/i.test(
          line
        ) &&
        /\b(?:interact with|control|access|operate|see|view|open|launch|manipulate)\b.{0,70}\b(?:computer|desktop|screen|windows?|apps?|applications?|notepad|calculator|paint)\b/i.test(
          line
        )
      )
    })
}
