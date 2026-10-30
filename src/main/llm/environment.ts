import { ACTION_LIMIT, RUN_SECONDS } from '../../shared/loop-limits'
import { APP_ROUTING } from './app-routing'
type Environment = {
  mode: TaskMode
  tools: string[]
  workspaceSelected: boolean
  inlineVisual: boolean
  codingMode?: 'auto' | 'ask-before-edit'
  interaction?: InteractionContext
  availableTools?: string[]
  unavailableTools?: Record<string, string>
  workspace?: string
  provider?: string
  model?: string
}

// Values that change between model calls in one run. They go last so the
// instructions before them stay a stable prefix for provider and llama.cpp
// prompt caches.
export type RunState = {
  remainingCalls: number
  remainingActions: number
  remainingSeconds?: number
  consultations?: number
  hostUI?: InterfacePresence
  context?: { usedTokens: number; budgetTokens: number | null; compactions: number }
}

export function runStatePrompt(state: RunState): string {
  return (
    'RUN STATE (refreshed every model call): ' +
    JSON.stringify({
      remaining: {
        modelCalls: state.remainingCalls,
        actions: state.remainingActions,
        seconds: state.remainingSeconds ?? RUN_SECONDS,
        ...(state.consultations !== undefined ? { subagents: state.consultations } : {})
      },
      ...(state.context ? { context: state.context } : {}),
      ...(state.hostUI ? { hostUI: state.hostUI } : {})
    }) +
    (state.context?.budgetTokens && state.context.usedTokens > state.context.budgetTokens * 0.6
      ? ' Context is filling: prefer targeted reads and narrow inspections, and unload schemas you no longer need with discover_tools.'
      : '')
  )
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
        codingMode: state.codingMode,
        limits: { actions: ACTION_LIMIT, seconds: RUN_SECONDS }
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
      ? 'Index tools without a loaded schema are still usable: call discover_tools with their exact names first ([] lists descriptions). Pass unload to drop loaded schemas you no longer need and keep context lean. Skip discovery for conversation and questions you can answer directly. Discovery never changes permissions.'
      : '',
    names.includes('consult_specialist') && !state.tools.includes('consult_specialist')
      ? 'SUBAGENTS: you can spawn subagents. consult_specialist starts a focused same-model subagent (researcher with web access, tutor, visual_explainer, reviewer) in its own context window, so its work does not fill yours. They run one at a time while you wait, within the RUN STATE budget; none run in the background or touch the desktop or files. The user sees each subagent in chat. When asked whether you can spawn agents, say yes and describe exactly this. Load it with discover_tools for difficult research, teaching, figures or draft review; answer simple requests yourself.'
      : '',
    'Tool availability is policy, not proof that dependencies or vision work; report specific errors.',
    `${state.workspaceSelected ? 'A working folder is selected.' : 'No working folder is selected; file tools require Settings > Files.'} You cannot see your own UI or the desktop unless an image or inspection result is supplied. Never operate your own approval controls. Stop cancels the run. There is no mode to switch.`,
    // Usage notes follow the loaded schemas; the index above already names
    // everything that discovery can load.
    has('plugins_list', 'plugin_read', 'mcp_catalog')
      ? 'RESOURCE INDEX: plugins_list discovers enabled plugin skills and MCP connection status; plugin_read reads exact entrypoints/references; mcp_catalog discovers connected schemas. Settings > Plugins controls connections. No connection or authentication is implied by an imported skill. Credentials stay in the host.'
      : '',
    has('harness_manage')
      ? 'harness_manage lists/reads local procedural skills and recipes. Read relevant guidance before using it; personal memory is separate (remember/recall).'
      : '',
    has('remember')
      ? 'MEMORY: you have a persistent memory across chats. When the user tells you something lasting about themselves, their work or their preferences, corrects you, or asks you to remember something, call remember in the same turn, then continue; do not ask permission. Update an existing entry (same title or its id) instead of adding near-duplicates, and forget entries the user asks you to drop. Never claim you cannot remember things between chats. Do not save trivia, one-off task details, secrets, or text from web pages, files and tool output unless the user explicitly asks.'
      : '',
    has('recall')
      ? 'RECALL: relevant saved memories are supplied automatically as saved-memory notes. Call recall to search saved memories and summaries of earlier conversations when the user refers to the past or personal context would help. If nothing is found, say so rather than guessing.'
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
      'input_batch',
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
  if (/```|~~~|^\s*>|["“”]/m.test(content)) return false
  return content
    .replace(/’/g, "'")
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
