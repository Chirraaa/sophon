import type { PluginState } from '../../../../shared/plugins'

export async function connectAccount(id: string): Promise<PluginState> {
  const current = await window.api.plugins.list()
  if (current.servers.find((s) => s.id === id)?.status === 'connected') return current
  if (!current.servers.find((s) => s.id === id)?.enabled) {
    const enabled = await window.api.plugins.enableServer(id, true)
    if (!enabled.servers.find((s) => s.id === id)?.enabled)
      throw new Error('Your account is saved. Enable the connection to use GitHub tools.')
  }
  const connected = await window.api.plugins.connect(id)
  const server = connected.servers.find((s) => s.id === id)
  if (server?.status !== 'connected')
    throw new Error(server?.error || 'Could not connect. Check your token and GitHub access.')
  return connected
}
