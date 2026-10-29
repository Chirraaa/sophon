export const TOOL_INFO: ToolInfo[] = [
  {
    name: 'browser_open',
    label: 'Open browser pages',
    description:
      'Open a visible Edge or Chrome session with a separate Sophon profile. Sign in directly in that browser; websites use its cookies and run scripts.',
    default: 'ask'
  },
  {
    name: 'browser_tabs',
    label: 'List browser tabs',
    description: 'List tabs in Sophon-managed browser sessions only.',
    default: 'ask'
  },
  {
    name: 'browser_inspect',
    label: 'Read browser elements',
    description:
      'Read visible page controls and text without screenshots. Password and file inputs are excluded.',
    default: 'ask'
  },
  {
    name: 'browser_act',
    label: 'Use browser elements',
    description:
      'Click or edit an inspected page element. Buttons and Enter may submit information. Allowed browser inspection supplies a fresh read-back.',
    default: 'ask'
  },
  {
    name: 'run_command',
    label: 'Run project commands',
    description:
      'Run PowerShell commands for Git, Java, C/C++, Make, CMake and other installed tools. Always asks for the exact command; runs with your account access. Stop terminates its process tree.',
    default: 'ask'
  },
  {
    name: 'plugins_list',
    label: 'Discover plugins',
    description: 'List enabled skills and MCP connections without calling external services.',
    default: 'ask'
  },
  {
    name: 'plugin_read',
    label: 'Read plugin guidance',
    description: 'Read imported skill instructions and references from enabled plugins.',
    default: 'ask'
  },
  {
    name: 'mcp_catalog',
    label: 'Discover connected MCP capabilities',
    description: 'List tool schemas, resources and prompts from a connected MCP server.',
    default: 'ask'
  },
  {
    name: 'mcp_call',
    label: 'Use MCP tools',
    description:
      'Call a connected local or remote MCP tool. Always asks for this exact operation; server account permissions apply.',
    default: 'ask'
  },
  {
    name: 'mcp_read',
    label: 'Read MCP resources and prompts',
    description: 'Read data from a connected MCP server. Always asks for approval.',
    default: 'ask'
  },
  {
    name: 'list_audio',
    label: 'Read audio levels',
    description: 'Read system output volume and app audio sessions, including mute state.',
    default: 'ask'
  },
  {
    name: 'set_volume',
    label: 'Change volume and mute',
    description: 'Set system output or one app audio session volume and mute state.',
    default: 'ask'
  },
  {
    name: 'list_radios',
    label: 'Read wireless devices',
    description: 'Read Wi-Fi and Bluetooth radio names and on/off states.',
    default: 'ask'
  },
  {
    name: 'set_radio',
    label: 'Control Wi-Fi and Bluetooth',
    description:
      'Turn one Wi-Fi or Bluetooth radio on or off. Turning off can disconnect networks, audio and input devices.',
    default: 'ask'
  },
  {
    name: 'notes_list',
    label: 'List notes',
    description: "Search and list titles and previews of Sophon's own notes.",
    default: 'ask'
  },
  {
    name: 'notes_read',
    label: 'Read notes',
    description: 'Read the full text of one Sophon note.',
    default: 'ask'
  },
  {
    name: 'notes_create',
    label: 'Create notes',
    description: 'Save a new note in Sophon. The text is shown before it is saved.',
    default: 'ask'
  },
  {
    name: 'notes_edit',
    label: 'Edit notes',
    description: 'Change a note after reading it. You see the before and after.',
    default: 'ask'
  },
  {
    name: 'notes_delete',
    label: 'Delete notes',
    description: 'Permanently delete one note. Always asks for approval.',
    default: 'ask'
  },
  {
    name: 'edit_file',
    label: 'Edit project files',
    description:
      'Apply up to 12 focused text patches to an existing workspace file. Checks the approved file identity and every match before saving.',
    default: 'ask'
  },
  {
    name: 'create_directory',
    label: 'Create project folders',
    description: 'Create a folder inside the working folder. Parent must exist.',
    default: 'ask'
  },
  {
    name: 'delete_file',
    label: 'Delete project files',
    description:
      'Permanently delete one exact workspace file. Always asks for approval; protected and linked entries are blocked.',
    default: 'ask'
  },
  {
    name: 'delete_directory',
    label: 'Delete project folders',
    description:
      'Permanently delete an empty folder, or an explicitly requested tree of up to 250 entries. Always asks and previews contents.',
    default: 'ask'
  },
  {
    name: 'run_npm',
    label: 'Run npm commands',
    description:
      'Run npm in a project folder. Always asks: scripts have your Windows account access. Commands time out after 120 seconds; ready dev servers remain running until stopped or the app exits.',
    default: 'ask'
  },
  {
    name: 'harness_manage',
    label: 'Evolve procedural memory',
    description:
      'Read, propose, probe and compose local Markdown skills, Python recipes, subagent guidance and loop hooks. Stored as plaintext with previous revisions.',
    default: 'ask'
  },
  {
    name: 'python_calculate',
    label: 'Python calculations and CSV',
    description:
      'Evaluate bounded Python expressions on numbers and inline or approved workspace CSV data. No shell, imports or arbitrary file access. Requires Python 3.',
    default: 'ask'
  },
  {
    name: 'clear_chat',
    label: 'Clear chat',
    description:
      'Erase every message in the current chat and its memories. Always asks for approval, and the chat is cleared once the reply ends.',
    default: 'ask'
  },
  {
    name: 'wait',
    label: 'Wait',
    description: 'Pause an active task for up to 60 seconds, then continue. Stop cancels the wait.',
    default: 'ask'
  },
  {
    name: 'inspect_app',
    label: 'Read app controls',
    description:
      'Inspect named controls and visible text in one app. Password controls are excluded.',
    default: 'ask'
  },
  {
    name: 'act_on_control',
    label: 'Use app controls',
    description:
      'Activate a named control or replace a text field after inspecting it. Each action is previewed and checked.',
    default: 'ask'
  },
  {
    name: 'web_search',
    label: 'Public web search',
    description: 'Search public information using your selected search provider.',
    default: 'ask'
  },
  {
    name: 'web_fetch',
    label: 'Read public websites',
    description:
      'Read public HTTPS pages without browser cookies or scripts. URLs go to websites; up to three public redirects are followed.',
    default: 'ask'
  },
  {
    name: 'open_app',
    label: 'Open apps',
    description: 'Open installed Windows apps by name using their registered launch identities.',
    default: 'ask'
  },
  {
    name: 'list_apps',
    label: 'Find installed apps',
    description: 'Search names of installed Windows Start menu apps. Blocked apps are excluded.',
    default: 'ask'
  },
  {
    name: 'list_windows',
    label: 'List windows',
    description: 'Read the titles, apps and positions of your open windows.',
    default: 'ask'
  },
  {
    name: 'move_window',
    label: 'Move and resize windows',
    description: 'Snap, move, resize, maximize, minimize or restore windows, on any monitor.',
    default: 'ask'
  },
  {
    name: 'look_at_screen',
    label: 'Look at screen',
    description:
      'Capture the active or named app window, optionally cropped, for visual questions.',
    default: 'ask'
  },
  {
    name: 'focus_window',
    label: 'Focus windows',
    description: 'Bring an app window to the front.',
    default: 'ask'
  },
  {
    name: 'close_window',
    label: 'Close windows',
    description: 'Request that one window close, leaving save prompts to you.',
    default: 'ask'
  },
  {
    name: 'close_app',
    label: 'Close apps',
    description: 'Request that every window of an app close, leaving save prompts to you.',
    default: 'ask'
  },
  {
    name: 'click',
    label: 'Click',
    description: 'Click at coordinates from the last captured image.',
    default: 'ask'
  },
  {
    name: 'scroll',
    label: 'Scroll',
    description: 'Scroll the active or named window.',
    default: 'ask'
  },
  {
    name: 'press_keys',
    label: 'Press keys',
    description: 'Navigate pages, tabs, zoom and other shortcuts in a window.',
    default: 'ask'
  },
  {
    name: 'type_text',
    label: 'Type text',
    description: 'Type text into the active or named window.',
    default: 'ask'
  },
  {
    name: 'list_files',
    label: 'Browse files',
    description: 'List files in your chosen working folder.',
    default: 'ask'
  },
  {
    name: 'read_file',
    label: 'Read files and pictures',
    description: 'Read text files and inspect images inside your working folder.',
    default: 'ask'
  },
  {
    name: 'write_file',
    label: 'Write files',
    description:
      'Create or explicitly replace text, HTML, data and source-code files inside your working folder. Replacements check the approved file identity.',
    default: 'ask'
  }
]
export const isKnownTool = (name: string): boolean => TOOL_INFO.some((t) => t.name === name)
export const defaultToolPermissions = (): Record<string, ToolPermission> =>
  Object.fromEntries(TOOL_INFO.map((t) => [t.name, t.default]))
