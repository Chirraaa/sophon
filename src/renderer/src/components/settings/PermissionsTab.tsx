import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ChevronDown, Search, ShieldCheck } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ChipList, Notice, Row, Section, Segmented, PillButton } from './controls'
import { save } from './save'
const LEVELS: {
  value: ToolPermission
  label: string
}[] = [
  { value: 'allow', label: 'Always allow' },
  { value: 'ask', label: 'Ask first' },
  { value: 'block', label: 'Block' }
]
const ONE_USE = [
  'run_command',
  'run_npm',
  'delete_file',
  'delete_directory',
  'mcp_call',
  'mcp_read'
]
const GROUPS = [
  {
    title: 'Browser interaction',
    description: 'Use a separate Sophon browser session with its own sign-in.',
    names: ['browser_open', 'browser_tabs', 'browser_inspect', 'browser_act']
  },
  {
    title: 'Files & coding',
    description: 'Read, create and edit in your working folder.',
    names: [
      'list_files',
      'read_file',
      'write_file',
      'edit_file',
      'create_directory',
      'delete_file',
      'delete_directory',
      'run_npm',
      'run_command'
    ]
  },
  {
    title: 'Apps & windows',
    description: 'Open apps and manage their windows.',
    names: [
      'open_app',
      'list_apps',
      'list_windows',
      'move_window',
      'focus_window',
      'close_window',
      'close_app'
    ]
  },
  {
    title: 'Screen & interaction',
    description: 'See the screen, click, type and use app controls.',
    names: [
      'look_at_screen',
      'inspect_app',
      'act_on_control',
      'click',
      'scroll',
      'press_keys',
      'type_text',
      'wait'
    ]
  },
  {
    title: 'Web & research',
    description: 'Search the web and read public pages.',
    names: ['web_search', 'web_fetch']
  },
  {
    title: 'Memory & calculations',
    description: 'Evolve procedural guidance and run calculations.',
    names: ['harness_manage', 'python_calculate']
  },
  {
    title: 'Plugins & connections',
    description: 'Discover skills and use connected MCP services.',
    names: ['plugins_list', 'plugin_read', 'mcp_catalog', 'mcp_call', 'mcp_read']
  },
  {
    title: 'Audio & wireless',
    description: 'Volume, mute, Wi-Fi and Bluetooth.',
    names: ['list_audio', 'set_volume', 'list_radios', 'set_radio']
  }
]
function permission(tool: ToolInfo, settings: AppSettings): ToolPermission {
  const level = settings.tools[tool.name] ?? 'block'
  return ONE_USE.includes(tool.name) && level === 'allow' ? 'ask' : level
}
export function PermissionsTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let alive = true
    window.api
      .toolsInfo()
      .then((list) => {
        if (alive) setTools(list)
      })
      .catch((cause: Error) => {
        if (alive) setError(cause.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [refresh])
  const groups = [
    ...GROUPS,
    {
      title: 'Other tools',
      description: 'Additional capabilities.',
      names: tools
        .filter((tool) => !GROUPS.some((group) => group.names.includes(tool.name)))
        .map((tool) => tool.name)
    }
  ]
  const searching = !!query.trim() || filter !== 'all'
  const matches = (tool: ToolInfo): boolean =>
    (filter === 'all' || permission(tool, settings) === filter) &&
    `${tool.label} ${tool.description} ${tool.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  const visible = tools.filter(matches)
  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Choose what Sophon can do"
        description="Open a category to review its tools. Permissions apply across chats; Always allow requires confirmation. You can stop a task at any time."
      >
        <div className="mb-4 grid grid-cols-3 gap-2">
          {LEVELS.map((level) => (
            <Button
              variant="ghost"
              key={level.value}
              type="button"
              aria-pressed={filter === level.value}
              onClick={() => {
                const next = filter === level.value ? 'all' : level.value
                setFilter(next)
                setExpanded(
                  next !== 'all' || query.trim() ? groups.map((group) => group.title) : []
                )
              }}
              className={cn(
                'h-auto flex-col items-start gap-0 whitespace-normal rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                filter === level.value
                  ? 'border-ring bg-white/8'
                  : 'border-border bg-white/2 hover:bg-white/5'
              )}
            >
              <span className="block text-lg font-medium tabular-nums">
                {tools.filter((tool) => permission(tool, settings) === level.value).length}
              </span>
              <span className="text-[11px] text-muted-foreground">{level.label}</span>
            </Button>
          ))}
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search permissions"
            placeholder="Find a tool, like screenshots or files…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setExpanded(
                event.target.value.trim() || filter !== 'all'
                  ? groups.map((group) => group.title)
                  : []
              )
            }}
            className="pl-9 text-xs"
          />
        </div>
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span role="status">
            {loading
              ? 'Loading permissions…'
              : `${visible.length} of ${tools.length} tools${filter === 'all' ? '' : ` · ${LEVELS.find((level) => level.value === filter)?.label}`}`}
          </span>
          {searching && (
            <PillButton
              onClick={() => {
                setQuery('')
                setFilter('all')
                setExpanded([])
              }}
            >
              Clear filters
            </PillButton>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}{' '}
            <PillButton
              disabled={loading}
              onClick={() => {
                setLoading(true)
                setError('')
                setRefresh((value) => value + 1)
              }}
            >
              Retry loading tools
            </PillButton>
          </p>
        )}
        {!loading && !error && !visible.length && (
          <p className="py-4 text-xs text-muted-foreground">
            No tools match. Try another search or clear your filters.
          </p>
        )}
        <div className="mb-4 grid grid-cols-1 gap-2 min-[1000px]:grid-cols-2">
          {groups.map((group) => {
            const members = tools.filter((tool) => group.names.includes(tool.name))
            const shown = members.filter(matches)
            if (!shown.length) return null
            const open = expanded.includes(group.title)
            const id = `permission-${group.title.toLowerCase().replace(/[^a-z]+/g, '-')}`
            return (
              <div
                key={group.title}
                className={cn(
                  'overflow-hidden rounded-xl border border-border',
                  open && 'col-span-full'
                )}
              >
                <Button
                  variant="ghost"
                  type="button"
                  aria-expanded={open}
                  aria-controls={id}
                  onClick={() =>
                    setExpanded((current) =>
                      open
                        ? current.filter((title) => title !== group.title)
                        : [...current, group.title]
                    )
                  }
                  className="flex h-auto w-full items-center justify-start gap-3 whitespace-normal p-4 text-left hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {group.title}{' '}
                      <span className="ml-1 text-muted-foreground">({shown.length})</span>
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {group.description}
                    </span>
                    <span className="mt-2 block text-[10px] text-muted-foreground">
                      {LEVELS.map(
                        (level) =>
                          `${members.filter((tool) => permission(tool, settings) === level.value).length} ${level.label.toLowerCase()}`
                      ).join(' · ')}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </Button>
                {open && (
                  <div id={id} className="border-t border-border px-4">
                    {shown.map((tool) => (
                      <Row key={tool.name} label={tool.label} hint={tool.description}>
                        <Segmented
                          value={permission(tool, settings)}
                          options={
                            ONE_USE.includes(tool.name)
                              ? LEVELS.filter((level) => level.value !== 'allow')
                              : LEVELS
                          }
                          onChange={(level) => void save({ tools: { [tool.name]: level } })}
                        />
                      </Row>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <Collapsible className="mb-3 rounded-xl border border-border p-3">
          <CollapsibleTrigger className="cursor-pointer text-xs">
            Change all permissions
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Notice>
              Workspace creation and edits use the coding mode in the composer: Auto runs enabled
              file tools; Ask before edit requires approval even for Always allow tools. Block
              always applies.
            </Notice>
            <div className="flex flex-wrap gap-2 py-3">
              <PillButton
                disabled={tools.length === 0}
                onClick={() =>
                  void save({
                    tools: Object.fromEntries(
                      tools.map((t) => [t.name, ONE_USE.includes(t.name) ? 'ask' : 'allow'])
                    )
                  })
                }
              >
                Allow tools that support permanent approval
              </PillButton>
              <PillButton
                disabled={tools.length === 0}
                onClick={() =>
                  void save({
                    coding: { mode: 'ask-before-edit' },
                    tools: Object.fromEntries(tools.map((t) => [t.name, 'ask']))
                  })
                }
              >
                Ask for all tools
              </PillButton>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
          Web tools also need web access in Model; file tools need a working folder in Files;
          harness tools need memory enabled. Commands, deletion and connected MCP operations always
          ask.
        </p>
      </Section>

      <Section
        title="Blocked apps"
        description="Prevents app launch and accessibility control inspection/actions. Matched by name, so 'powershell' also catches 'Windows PowerShell'."
      >
        <ChipList
          items={settings.rules.blockedApps}
          onChange={(blockedApps) => void save({ rules: { blockedApps } })}
          placeholder="App name, like regedit"
        />
      </Section>

      <Section
        title="Windows it may not touch"
        description="Matched against the window title and the program name. These windows are also hidden from the model, and it can't move or resize them."
      >
        <ChipList
          items={settings.rules.protectedWindows}
          onChange={(protectedWindows) => void save({ rules: { protectedWindows } })}
          placeholder="App or window name, like keepass"
        />
      </Section>

      <Notice>
        These limits are enforced by the app, not by asking the model nicely, so they hold even if
        the model misbehaves. They match on names, though. They stop the agent from opening or
        moving things directly, but they are not a sandbox: an app you allow can still start other
        programs. Local MCP servers run separately with your Windows account access; these app and
        window rules do not sandbox them. Manage those connections in Plugins.
      </Notice>
    </div>
  )
}
