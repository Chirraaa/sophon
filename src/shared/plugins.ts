export interface McpConfig {
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface PluginSkill {
  id: string
  name: string
  description: string
  path: string
}

export interface PluginSummary {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  documents: string[]
  skills?: PluginSkill[]
  serverIds: string[]
  warnings: string[]
}

export interface McpSummary {
  id: string
  name: string
  githubLogin?: string
  pluginId?: string
  enabled: boolean
  type: McpConfig['type']
  destination: string
  credentialNames: string[]
  configuration: Omit<McpConfig, 'headers' | 'env'>
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolCount: number
}

export interface PluginState {
  plugins: PluginSummary[]
  servers: McpSummary[]
}

export interface GithubSignIn {
  id: string
  userCode: string
  expiresAt: number
  pollAfterMs: number
}
export interface PluginsApi {
  onGithubHistory: (
    callback: (update: {
      context: GithubContext
      snapshot: import('./github-history').GithubHistorySnapshot
    }) => void
  ) => () => void
  onGithubCheckout: (
    callback: (update: {
      context: GithubContext
      checkout: import('./github-history').GithubCheckout | null
    }) => void
  ) => () => void
  githubHistory: (
    context: GithubContext,
    action: import('./github-history').GithubHistoryAction
  ) => Promise<import('./github-history').GithubHistorySnapshot>
  githubCheckout: (
    context: GithubContext,
    action: import('./github-history').GithubCheckoutAction
  ) => Promise<import('./github-history').GithubCheckout | null>
  githubAccounts: () => Promise<PluginState>
  githubSignInConfigured: () => Promise<boolean>
  githubSignIn: (clientId: string) => Promise<GithubSignIn>
  githubPollSignIn: (id: string) => Promise<{ serverId?: string; pollAfterMs?: number }>
  githubCancelSignIn: (id: string) => Promise<void>
  githubCall: (id: string, tool: string, argumentsJson: string) => Promise<unknown>
  list: () => Promise<PluginState>
  importFolder: () => Promise<PluginState>
  enablePlugin: (id: string, enabled: boolean) => Promise<PluginState>
  removePlugin: (id: string) => Promise<PluginState>
  addServer: (name: string, configuration: string) => Promise<PluginState>
  updateServer: (id: string, name: string, configuration: string) => Promise<PluginState>
  enableServer: (id: string, enabled: boolean) => Promise<PluginState>
  removeServer: (id: string) => Promise<PluginState>
  connect: (id: string) => Promise<PluginState>
  disconnect: (id: string) => Promise<PluginState>
}

export const CONNECTOR_PRESETS = [
  { name: 'GitHub', config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
  { name: 'Jira / Confluence', config: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' } },
  { name: 'Custom HTTP', config: { type: 'http', url: 'https://example.com/mcp' } },
  {
    name: 'Local MCP',
    config: { type: 'stdio', command: 'node', args: ['C:\\path\\to\\server.js'] }
  }
] as const
