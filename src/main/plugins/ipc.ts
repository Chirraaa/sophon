import { dialog } from 'electron'
import type { SecureIpc } from '../security/ipc'
import { nativeConsent } from '../security/native-consent'
import { revokePolicy, anyRunActive } from '../security/run-manager'
import { settingsRecovery } from '../settings'
import { readPlugin } from './import'
import { parseMcpConfig, destination } from './config'
import * as store from './store'
import { connectServer, disconnect, connectionSummaries } from './runtime'
import type { PluginState } from '../../shared/plugins'
import { registerGithubIpc } from './github'
import { identifyGithubAccounts } from './github-accounts'
import type { GithubHistorySnapshot } from '../../shared/github-history'
import {
  startGithubSignIn,
  pollGithubSignIn,
  cancelGithubSignIn,
  githubSignInConfigured
} from './github-auth'

export const pluginState = (): PluginState => ({
  plugins: store.pluginSummaries(),
  servers: connectionSummaries()
})
let busy = false
async function mutation(action: () => Promise<void>): Promise<PluginState> {
  if (busy) throw new Error('Another plugin change is in progress.')
  if (anyRunActive()) throw new Error('Finish or stop the current task before changing connections.')
  if (settingsRecovery().required)
    throw new Error('Review recovered settings before changing plugins.')
  busy = true
  try {
    await action()
    return pluginState()
  } finally {
    busy = false
  }
}
export function registerPluginsIpc(
  ipc: SecureIpc,
  publishHistory?: (context: GithubContext, snapshot: GithubHistorySnapshot) => void
): void {
  registerGithubIpc(ipc, publishHistory)
  ipc.handle('github:accounts', async () => {
    if (!busy && !anyRunActive() && !settingsRecovery().required) {
      await mutation(async () => {
        await identifyGithubAccounts()
        if (anyRunActive() || settingsRecovery().required) return

        await Promise.allSettled(
          connectionSummaries()
            .filter(
              (server) =>
                server.enabled &&
                server.configuration.url === 'https://api.githubcopilot.com/mcp/' &&
                server.status === 'disconnected'
            )
            .map((server) => connectServer(server.id))
        )
      })
    }
    return pluginState()
  })
  ipc.handle('github:sign-in-configured', () => githubSignInConfigured())
  ipc.handle('github:sign-in', (_event, clientId: string) => startGithubSignIn(clientId))
  ipc.handle('github:poll-sign-in', (_event, id: string) => pollGithubSignIn(id))
  ipc.handle('github:cancel-sign-in', (_event, id: string) => cancelGithubSignIn(id))
  ipc.handle('plugins:list', pluginState)
  ipc.handle('plugins:import', () =>
    mutation(async () => {
      const choice = await dialog.showOpenDialog({
        title: 'Import a plugin folder',
        properties: ['openDirectory', 'dontAddToRecent']
      })
      if (choice.canceled || !choice.filePaths[0]) return
      const plugin = readPlugin(choice.filePaths[0])

      store.importPlugin(plugin)
    })
  )
  ipc.handle('plugins:enable', (_event, id: string, enabled: boolean) =>
    mutation(async () => {
      const plugin = store.pluginSummaries().find((p) => p.id === id)
      if (!plugin) throw new Error('Plugin not found.')
      if (
        enabled &&
        !(await nativeConsent(
          'Enable plugin guidance?',
          `${plugin.name} ${plugin.version}\n${plugin.description}\n\nDocuments:\n${plugin.documents.join('\n')}\n\nMCP servers must be enabled and connected separately.`
        ))
      )
        return
      revokePolicy()
      for (const serverId of plugin.serverIds) await disconnect(serverId)
      store.enablePlugin(id, enabled)
    })
  )
  ipc.handle('plugins:remove', (_event, id: string) =>
    mutation(async () => {
      revokePolicy()
      for (const serverId of store.pluginSummaries().find((p) => p.id === id)?.serverIds ?? [])
        await disconnect(serverId)
      store.removePlugin(id)
    })
  )
  ipc.handle('plugins:add-server', (_event, name: string, raw: string) =>
    mutation(async () => {
      const config = parseMcpConfig(JSON.parse(raw))
      store.addServer(name, config)
    })
  )
  ipc.handle('plugins:enable-server', (_event, id: string, enabled: boolean) =>
    mutation(async () => {
      const server = store.serverRecord(id, false)
      if (
        enabled &&
        !(
          server.config.type === 'http' &&
          server.config.url === 'https://api.githubcopilot.com/mcp/'
        ) &&
        !(await nativeConsent(
          'Enable this MCP connection?',
          `${server.name}\n${destination(server.config)}\n\nCredential fields: ${Object.keys(server.config.headers ?? server.config.env ?? {}).join(', ') || 'none'}\n\n${server.config.type === 'stdio' ? 'Connecting starts this command with your Windows account permissions. It can access files and the network outside Sophon’s workspace and app rules. Only enable servers you trust.' : 'Connecting sends configured credentials to this endpoint. Approved tool calls can read or change data using this account’s permissions.'}\n\nTool calls and resource reads always require approval. Enabling does not connect automatically.`
        ))
      )
        return
      revokePolicy()
      await disconnect(id)
      store.enableServer(id, enabled)
    })
  )
  ipc.handle('plugins:remove-server', (_event, id: string) =>
    mutation(async () => {
      revokePolicy()
      await disconnect(id)
      store.removeServer(id)
    })
  )
  ipc.handle('plugins:connect', (_event, id: string) =>
    mutation(async () => {
      revokePolicy()
      await connectServer(id)
    })
  )
  ipc.handle('plugins:update-server', (_event, id: string, name: string, raw: string) =>
    mutation(async () => {
      const config = parseMcpConfig(JSON.parse(raw))
      revokePolicy()
      await disconnect(id)
      store.updateServer(id, name, config)
    })
  )

  ipc.handle('plugins:disconnect', async (_event, id: string) => {
    revokePolicy()
    await disconnect(id)
    const server = store.serverRecord(id, false)
    if (server.config.url === 'https://api.githubcopilot.com/mcp/') store.enableServer(id, false)
    return pluginState()
  })
}
