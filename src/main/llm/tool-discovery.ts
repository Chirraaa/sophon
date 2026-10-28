export const CODING_PINNED_TOOLS = [
  'list_files',
  'read_file',
  'edit_file',
  'write_file',
  'run_command',
  'run_npm',
  'coding_checkpoint',
  'coding_resources'
]

type Tool = { function: { name: string; description: string } }

const DESKTOP_TOOLS = ['list_windows', 'inspect_app', 'act_on_control', 'look_at_screen']
const RELATED: Record<string, string[]> = {
  browser_open: ['browser_inspect', 'browser_act', 'browser_tabs'],
  browser_tabs: ['browser_inspect', 'browser_act', 'browser_open', 'inspect_app', 'list_windows'],
  browser_inspect: ['browser_act', 'browser_tabs', 'browser_open'],
  browser_act: ['browser_inspect', 'browser_tabs'],
  plugins_list: ['mcp_catalog', 'mcp_call', 'plugin_read', 'list_windows', 'inspect_app'],
  mcp_catalog: ['mcp_call', 'mcp_read', 'plugins_list'],
  mcp_call: ['mcp_catalog', 'mcp_read', 'plugins_list'],
  open_app: DESKTOP_TOOLS,
  inspect_app: DESKTOP_TOOLS,
  act_on_control: DESKTOP_TOOLS,
  look_at_screen: ['click', 'scroll', 'press_keys', 'type_text', ...DESKTOP_TOOLS],
  click: ['look_at_screen', 'inspect_app', 'list_windows'],
  type_text: ['inspect_app', 'press_keys', 'list_windows']
}

export class ToolDiscovery {
  private requested = new Set<string>()

  constructor(query: string) {
    const groups: [RegExp, string[]][] = [
      [
        /\b(discord|spotify|slack|notion|teams|outlook|calendar|gmail|jira|confluence|github)\b/i,
        [
          'plugins_list',
          'mcp_catalog',
          'browser_tabs',
          'list_windows',
          'inspect_app',
          'act_on_control'
        ]
      ],
      [
        /\b(browser|web app|website|webpage|chrome|edge)\b/i,
        ['browser_tabs', 'browser_open', 'browser_inspect', 'browser_act']
      ],
      [/\b(open|launch|start|ouvrir)\b/i, ['open_app', 'list_apps', ...DESKTOP_TOOLS]],
      [
        /\b(window|windows|screen|desktop|click|button|type|scroll|notepad|fenêtre|écran)\b/i,
        [
          'list_windows',
          'inspect_app',
          'act_on_control',
          'look_at_screen',
          'click',
          'type_text',
          'press_keys',
          'scroll'
        ]
      ],
      [
        /\b(files?|folder|workspace|project|repository|code|coding|implement|fix|build|npm|git|clone|commit|push|pull|java|javac|cmake|make|gcc|compile)\b/i,
        ['list_files', 'read_file', 'edit_file', 'write_file', 'run_command', 'run_npm']
      ],
      [
        /\b(search|research|latest|newest|news|headlines?|today|weather|prices?|currently|recent(?:ly)?|browse|sources?|chercher)\b|https:\/\//i,
        ['web_search', 'web_fetch']
      ],
      [/\b(calculate|csv|sum|average)\b|\d\s*[+*/=]\s*\d/i, ['python_calculate']],
      [/\b(volume|mute|audio)\b/i, ['list_audio', 'set_volume']],
      [/\b(wi-?fi|bluetooth|radio)\b/i, ['list_radios', 'set_radio']],
      [
        /\b(plugin|mcp|github|jira|confluence|skills?)\b/i,
        ['plugins_list', 'plugin_read', 'mcp_catalog', 'harness_manage']
      ]
    ]
    for (const [pattern, names] of groups)
      if (pattern.test(query)) names.forEach((name) => this.requested.add(name))

    for (const name of query.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) this.requested.add(name)
  }

  // A bounded working set: explicit requests first, useful follow-ups next, then
  // recently loaded schemas. Availability is still checked on every selection.
  private remember(names: string[]): void {
    this.requested = new Set(
      [
        ...new Set([...names, ...names.flatMap((name) => RELATED[name] ?? []), ...this.requested])
      ].slice(0, 8)
    )
  }

  used(name: string): void {
    this.remember([name])
  }

  select<T extends Tool>(catalog: T[], pinned: string[] = []): T[] {
    const available = new Map(catalog.map((tool) => [tool.function.name, tool]))
    const optional = [...this.requested]
      .filter((name) => available.has(name) && !pinned.includes(name))
      .slice(0, 8)
    return [...new Set(['discover_tools', ...pinned, ...optional])].flatMap((name) =>
      available.has(name) ? [available.get(name)!] : []
    )
  }

  load(names: string[], catalog: Tool[]): string {
    const available = new Set(catalog.map((tool) => tool.function.name))
    if (names.length) {
      const unavailable = names.filter((name) => !available.has(name))
      if (unavailable.length)
        return `Not loaded: ${unavailable.join(', ')} unavailable in this phase or under current policy. No permissions changed.`

      this.remember(names)
      return `Schemas ready: ${this.select(catalog)
        .map((tool) => tool.function.name)
        .filter((name) => name !== 'discover_tools')
        .join(
          ', '
        )}. No actions executed or permissions changed. Use loaded tools directly; discover only missing tools.`
    }
    return JSON.stringify(
      catalog.map((tool) => ({
        name: tool.function.name,
        summary: tool.function.description.slice(0, 180)
      }))
    )
  }
}
