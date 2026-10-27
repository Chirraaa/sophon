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

export class ToolDiscovery {
  private requested = new Set<string>()

  constructor(query: string) {
    const groups: [RegExp, string[]][] = [
      [/\b(open|launch|start|ouvrir)\b/i, ['open_app', 'list_apps', 'list_windows']],
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
        /\b(search|research|latest|browse|sources?|chercher)\b|https:\/\//i,
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

      this.requested = new Set(names)
      return `Schemas loaded for the next model call: ${names.join(', ')}. No actions executed or permissions changed. Call discover_tools again to switch tools.`
    }
    return JSON.stringify(
      catalog.map((tool) => ({
        name: tool.function.name,
        summary: tool.function.description.slice(0, 180)
      }))
    )
  }
}
