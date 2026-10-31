const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const endpoint = 'https://api.githubcopilot.com/mcp/'
const servers = [
  { id: 'saved', enabled: true, status: 'disconnected', configuration: { url: endpoint } },
  { id: 'disabled', enabled: false, status: 'disconnected', configuration: { url: endpoint } },
  {
    id: 'other',
    enabled: true,
    status: 'disconnected',
    configuration: { url: 'https://example.com/mcp' }
  }
]
let active = false
let recovery = false
let connections = 0
let consents = 0
const handlers = {}
const record = (id) => {
  const server = servers.find((server) => server.id === id)
  return { ...server, config: { type: 'http', url: server.configuration.url } }
}
const ipc = load('src/main/plugins/ipc.ts', {
  electron: { dialog: {} },
  '../security/native-consent': {
    nativeConsent: async () => {
      consents++
      return true
    }
  },
  '../security/run-manager': {
    currentRun: () => active,
    anyRunActive: () => !!active,
    revokePolicy: () => {}
  },
  '../settings': { settingsRecovery: () => ({ required: recovery }) },
  './import': {},
  './config': {},
  './store': {
    pluginSummaries: () => [],
    serverRecord: record,
    enableServer: (id, enabled) => {
      servers.find((server) => server.id === id).enabled = enabled
    },
    removeServer: (id) => {
      servers.splice(
        servers.findIndex((server) => server.id === id),
        1
      )
    }
  },
  './runtime': {
    connectionSummaries: () => structuredClone(servers),
    connectServer: async (id) => {
      connections++
      servers.find((server) => server.id === id).status = 'connected'
    },
    disconnect: async (id) => {
      servers.find((server) => server.id === id).status = 'disconnected'
    }
  },
  './github': { registerGithubIpc: () => {} },
  './github-accounts': { identifyGithubAccounts: async () => {} },
  './github-auth': {}
})
ipc.registerPluginsIpc({
  handle: (name, handler) => {
    handlers[name] = handler
  }
})
async function main() {
  active = true
  await handlers['github:accounts']()
  active = false
  recovery = true
  await handlers['github:accounts']()
  assert.equal(connections, 0, 'Active tasks and recovery prevent restoration')
  recovery = false
  const restored = await handlers['github:accounts']()
  assert.equal(restored.servers[0].status, 'connected')
  assert.equal(connections, 1, 'Only enabled official GitHub accounts reconnect')
  await handlers['github:accounts']()
  assert.equal(connections, 1, 'Connected accounts do not reconnect again')
  await handlers['plugins:disconnect']({}, 'saved')
  await handlers['github:accounts']()
  assert.equal(connections, 1, 'Explicit disconnect stays disconnected')
  assert.equal(record('saved').enabled, false)
  await handlers['plugins:remove-server']({}, 'saved')
  assert(!servers.some((server) => server.id === 'saved'))
  assert.equal(consents, 0, 'Restoring and removing accounts need no native permission dialogs')
  console.log(
    'PASS GitHub restart restoration, explicit disconnect, task/recovery guards and removal'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
