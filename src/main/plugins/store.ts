import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { pluginSkills } from './skills'
import type { ImportedPlugin } from './import'
import { destination, parseMcpConfig } from './config'
import type { McpConfig, PluginSummary, McpSummary } from '../../shared/plugins'

interface PluginRecord extends Omit<PluginSummary, 'documents'> {
  documents: Record<string, string>
}
export interface ServerRecord {
  id: string
  name: string
  githubLogin?: string
  pluginId?: string
  enabled: boolean
  config: McpConfig
}
interface Store {
  version: 1
  plugins: PluginRecord[]
  servers: ServerRecord[]
}
let state: Store | undefined
const location = (): string => join(app.getPath('userData'), 'plugins', 'registry.enc')
function persist(next: Store): void {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows credential encryption is unavailable.')
  const file = location()
  mkdirSync(join(app.getPath('userData'), 'plugins'), { recursive: true })
  writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 })
  renameSync(file + '.tmp', file)
  state = next
}
function append(next: Store, source: ImportedPlugin): void {
  if (next.plugins.some((p) => p.name === source.name))
    throw new Error('This plugin is already imported. Remove it before importing a new version.')
  if (next.plugins.length >= 30 || next.servers.length + source.servers.length > 100)
    throw new Error('Plugin or MCP registry limit reached.')
  const id = randomUUID()
  const servers = source.servers.map((server) => ({
    ...server,
    id: randomUUID(),
    pluginId: id,
    enabled: false
  }))
  next.plugins.push({
    id,
    name: source.name,
    description: source.description,
    version: source.version,
    enabled: false,
    documents: source.documents,
    warnings: source.warnings,
    serverIds: servers.map((s) => s.id)
  })
  next.servers.push(...servers)
}
function get(): Store {
  if (state) return state
  if (existsSync(location())) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Windows credential encryption is unavailable.')
    const next = JSON.parse(safeStorage.decryptString(readFileSync(location()))) as Store
    if (next.version !== 1 || !Array.isArray(next.plugins) || !Array.isArray(next.servers))
      throw new Error('Unsupported plugin registry; original data has been preserved.')
    next.servers.forEach((server) => {
      server.config = parseMcpConfig(server.config)
    })
    state = next
    return next
  }
  const next: Store = { version: 1, plugins: [], servers: [] }
  persist(next)
  return next
}
function change(action: (next: Store) => void): void {
  const next = structuredClone(get())
  action(next)
  if (JSON.stringify(next).length > 16000000) throw new Error('Plugin registry exceeds 16 MB.')
  persist(next)
}
export function pluginSummaries(): PluginSummary[] {
  return get().plugins.map((p) => ({
    ...p,
    documents: Object.keys(p.documents),
    skills: pluginSkills(p.id, p.documents)
  }))
}
export function serverSummaries(): McpSummary[] {
  return get().servers.map((s) => ({
    id: s.id,
    name: s.name,
    githubLogin: s.githubLogin,
    pluginId: s.pluginId,
    enabled: s.enabled,
    type: s.config.type,
    destination: destination(s.config),
    credentialNames: Object.keys(s.config.env ?? s.config.headers ?? {}),
    configuration:
      s.config.type === 'http'
        ? { type: 'http', url: s.config.url }
        : { type: 'stdio', command: s.config.command, args: s.config.args, cwd: s.config.cwd },
    status: 'disconnected',
    toolCount: 0
  }))
}
export function serverRecord(id: string, requireEnabled = true): ServerRecord {
  const server = get().servers.find((s) => s.id === id)
  if (
    !server ||
    (requireEnabled &&
      (!server.enabled ||
        (server.pluginId && !get().plugins.find((p) => p.id === server.pluginId)?.enabled)))
  )
    throw new Error('MCP connection is missing or disabled. Enable it in Settings > Plugins.')
  return structuredClone(server)
}
export function importPlugin(source: ImportedPlugin): void {
  change((next) => append(next, source))
}
export function enablePlugin(id: string, enabled: boolean): void {
  change((next) => {
    const plugin = next.plugins.find((p) => p.id === id)
    if (!plugin) throw new Error('Plugin not found.')
    plugin.enabled = enabled
    if (!enabled)
      next.servers
        .filter((s) => s.pluginId === id)
        .forEach((s) => {
          s.enabled = false
        })
  })
}
export function removePlugin(id: string): void {
  change((next) => {
    next.plugins = next.plugins.filter((p) => p.id !== id)
    next.servers = next.servers.filter((s) => s.pluginId !== id)
  })
}
export function addServer(name: string, config: McpConfig): void {
  if (!name.trim() || name.length > 100)
    throw new Error('Enter a connection name of up to 100 characters.')
  change((next) => {
    if (next.servers.length >= 100) throw new Error('At most 100 MCP connections are supported.')
    next.servers.push({
      id: randomUUID(),
      name: name.trim(),
      config: parseMcpConfig(config),
      enabled: false
    })
  })
}
export function enableServer(id: string, enabled: boolean): void {
  change((next) => {
    const server = next.servers.find((s) => s.id === id)
    if (!server) throw new Error('MCP connection not found.')
    if (enabled && server.pluginId && !next.plugins.find((p) => p.id === server.pluginId)?.enabled)
      throw new Error('Enable this connection’s plugin first.')
    server.enabled = enabled
  })
}
export function updateServer(id: string, name: string, config: McpConfig): void {
  if (!name.trim() || name.length > 100)
    throw new Error('Enter a connection name of up to 100 characters.')
  change((next) => {
    const server = next.servers.find((s) => s.id === id)
    if (!server) throw new Error('MCP connection not found.')
    server.name = name.trim()
    if (JSON.stringify(server.config) !== JSON.stringify(config)) delete server.githubLogin
    server.config = parseMcpConfig(config)
    server.enabled = false
  })
}
export function setGithubIdentity(id: string, login: string, config: McpConfig): void {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login))
    throw new Error('GitHub returned an invalid account name.')
  change((next) => {
    const server = next.servers.find((server) => server.id === id)
    if (
      !server ||
      server.config.url !== 'https://api.githubcopilot.com/mcp/' ||
      JSON.stringify(server.config) !== JSON.stringify(config)
    )
      throw new Error('The saved GitHub connection changed. Refresh your accounts.')
    server.githubLogin = login
  })
}
export function removeServer(id: string): void {
  change((next) => {
    next.servers = next.servers.filter((s) => s.id !== id)
    next.plugins.forEach((p) => {
      p.serverIds = p.serverIds.filter((s) => s !== id)
    })
  })
}
export function readPluginDocument(id: string, path: string): string {
  const plugin = get().plugins.find((p) => p.id === id && p.enabled)
  if (!plugin || !Object.hasOwn(plugin.documents, path))
    throw new Error('Enabled plugin document not found. Use plugins_list for exact paths.')
  return plugin.documents[path]
}
