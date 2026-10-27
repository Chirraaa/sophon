import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { Plug, FolderPlus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CONNECTOR_PRESETS, type PluginState } from '../../../../shared/plugins'

export function PluginsTab(): React.JSX.Element {
  const [state, setState] = useState<PluginState>({ plugins: [], servers: [] })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('GitHub')
  const [configuration, setConfiguration] = useState(
    JSON.stringify(CONNECTOR_PRESETS[0].config, null, 2)
  )
  const [authorization, setAuthorization] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const editor = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (showAdd) editor.current?.scrollIntoView({ block: 'start' })
  }, [showAdd, editing])
  useEffect(() => {
    let active = true
    window.api.plugins
      .list()
      .then((value) => {
        if (active) setState(value)
      })
      .catch((e) => {
        if (active) setError(String(e.message))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  async function perform(action: () => Promise<PluginState>): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setState(await action())
    } catch (e) {
      setError((e as Error).message)

      try {
        setState(await window.api.plugins.list())
      } catch {
        /* Keep the original error. */
      }
    } finally {
      setBusy(false)
    }
  }
  async function add(): Promise<void> {
    await perform(async () => {
      const config = JSON.parse(configuration)
      if (authorization.trim()) {
        if (config.type === 'stdio' || config.command)
          throw new Error('Local MCP credentials belong in the env object.')
        config.headers = { ...config.headers, Authorization: authorization.trim() }
      }
      const next = editing
        ? await window.api.plugins.updateServer(editing, name, JSON.stringify(config))
        : await window.api.plugins.addServer(name, JSON.stringify(config))
      setAuthorization('')
      setConfiguration(JSON.stringify(CONNECTOR_PRESETS[0].config, null, 2))
      setShowAdd(false)
      setEditing(null)
      return next
    })
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void perform(() => window.api.plugins.importFolder())}
        >
          <FolderPlus className="size-3.5" /> Import plugin folder
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setEditing(null)
            setAuthorization('')
            setShowAdd(!showAdd)
          }}
        >
          <Plug className="size-3.5" /> Add MCP connection
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void perform(() => window.api.plugins.list())}
        >
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {(busy || loading) && (
        <p role="status" className="text-xs text-muted-foreground">
          {loading ? 'Loading plugins…' : 'Updating plugins…'}
        </p>
      )}
      {showAdd && (
        <form
          ref={editor}
          className="space-y-4 rounded-2xl border border-border p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          {editing && (
            <p className="text-xs text-muted-foreground">
              Replace this connection’s configuration. Re-enter credentials to keep using them;
              omitted credentials are removed. Save disables the connection until you review and
              enable it again.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {CONNECTOR_PRESETS.map((p) => (
              <Button
                key={p.name}
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setName(p.name)
                  setConfiguration(JSON.stringify(p.config, null, 2))
                  setAuthorization('')
                }}
              >
                {p.name}
              </Button>
            ))}
          </div>
          <label className="block space-y-2 text-xs">
            <span>Connection name</span>
            <Input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="block space-y-2 text-xs">
            <span>MCP configuration (JSON)</span>
            <Textarea
              className="min-h-36 font-mono text-xs"
              value={configuration}
              onChange={(e) => setConfiguration(e.target.value)}
              maxLength={32000}
              required
              disabled={busy}
              spellCheck={false}
            />
          </label>
          <label className="block space-y-2 text-xs">
            <span>Authorization header (optional, HTTP only)</span>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Bearer your-token or Basic encoded-credentials"
              value={authorization}
              onChange={(e) => setAuthorization(e.target.value)}
              maxLength={4096}
              disabled={busy}
            />
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            GitHub accepts a personal access token as Bearer authorization. Jira / Confluence
            supports API token authentication when enabled by your organization. Other headers and
            local environment variables can be supplied in the JSON. Credentials are encrypted on
            this computer and never included in the model’s tool catalogue.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            For GitHub browser sign-in, open GitHub in the sidebar. Other OAuth-only services
            require an authenticated local MCP bridge. Connections use Streamable HTTP or local
            stdio; legacy SSE is not supported.
          </p>
          <Button type="submit" size="sm" disabled={busy}>
            Save connection
          </Button>
        </form>
      )}
      <section className="space-y-3" aria-label="Installed plugins">
        <h3 className="text-sm font-medium">Plugins</h3>
        {!loading && !error && !state.plugins.length && (
          <p className="text-xs text-muted-foreground">
            No plugins installed. Import a plugin folder to add one.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Enable skills for the assistant to discover. Connect each included MCP separately.
        </p>
        {state.plugins.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Import a folder containing .claude-plugin/plugin.json.
          </p>
        )}
        {state.plugins.map((plugin) => (
          <div key={plugin.id} className="space-y-3 rounded-2xl border border-border p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium">
                  {plugin.name}{' '}
                  <span className="text-xs text-muted-foreground">{plugin.version}</span>
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {plugin.description}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${plugin.name}`}
                disabled={busy}
                onClick={() => void perform(() => window.api.plugins.removePlugin(plugin.id))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void perform(() => window.api.plugins.enablePlugin(plugin.id, !plugin.enabled))
                }
              >
                {plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {plugin.documents.filter((p) => p.endsWith('/SKILL.md')).length} skills ·{' '}
                {plugin.serverIds.length} connections
              </span>
            </div>
            {plugin.warnings.length > 0 && (
              <Collapsible className="text-xs text-muted-foreground">
                <CollapsibleTrigger className="cursor-pointer">
                  Import notes ({plugin.warnings.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {plugin.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}
            <Collapsible className="text-xs text-muted-foreground">
              <CollapsibleTrigger className="cursor-pointer">Included documents</CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 space-y-1 break-all">
                  {plugin.documents.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ))}
      </section>
      <section className="space-y-3" aria-label="MCP connections">
        <h3 className="text-sm font-medium">MCP connections</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Enable a connection, then connect to discover its tools. Connections stay closed after
          restarting Sophon. Calls and resource reads show an approval card with the exact
          operation.
        </p>
        {state.servers.length === 0 && (
          <p className="text-xs text-muted-foreground">Add your first MCP connection above.</p>
        )}
        {state.servers.map((server) => {
          const pluginDisabled =
            !!server.pluginId && !state.plugins.find((p) => p.id === server.pluginId)?.enabled
          return (
            <div key={server.id} className="space-y-3 rounded-2xl border border-border p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-medium">{server.name}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {server.type === 'stdio' ? 'Local process' : 'Remote HTTP'} · {server.status}
                    {server.status === 'connected' ? ` · ${server.toolCount} tools` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${server.name} connection`}
                  disabled={busy}
                  onClick={() => void perform(() => window.api.plugins.removeServer(server.id))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {server.destination}
              </p>
              {server.credentialNames.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Stored fields: {server.credentialNames.join(', ')}
                </p>
              )}
              {server.error && (
                <p role="alert" className="text-xs text-destructive">
                  {server.error}
                </p>
              )}
              {pluginDisabled && (
                <p className="text-xs text-muted-foreground">Enable the parent plugin first.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || pluginDisabled}
                  onClick={() =>
                    void perform(() => window.api.plugins.enableServer(server.id, !server.enabled))
                  }
                >
                  {server.enabled ? 'Disable connection' : 'Enable connection'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setEditing(server.id)
                    setName(server.name)
                    setConfiguration(JSON.stringify(server.configuration, null, 2))
                    setAuthorization('')
                    setShowAdd(true)
                  }}
                >
                  Configure
                </Button>
                {server.status === 'connected' || server.status === 'connecting' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void perform(() => window.api.plugins.disconnect(server.id))}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !server.enabled || pluginDisabled}
                    onClick={() => {
                      setState((current) => ({
                        ...current,
                        servers: current.servers.map((item) =>
                          item.id === server.id
                            ? { ...item, status: 'connecting', error: undefined }
                            : item
                        )
                      }))
                      void perform(() => window.api.plugins.connect(server.id))
                    }}
                  >
                    Connect
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
