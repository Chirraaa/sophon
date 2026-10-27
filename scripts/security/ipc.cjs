const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
module.exports = async function ({ load, registry, contracts, endpoint, runManager, fixture }) {
  const profile = path.join(fixture, 'profile')
  fs.mkdirSync(profile)
  let failSave = false
  const persistence = load('src/main/settings.ts', {
    electron: { app: { isPackaged: false, getAppPath: () => fixture, getPath: () => profile } },
    path,
    crypto,
    '../shared/shortcut-contract': load('src/shared/shortcut-contract.ts'),
    fs: {
      ...fs,
      renameSync: (...args) => {
        if (failSave) throw new Error('synthetic disk failure')
        return fs.renameSync(...args)
      }
    },
    './tools/registry': registry,
    './network/endpoint': endpoint,
    './security/run-manager': runManager,
    './security/audit': { securityEvent: () => {} }
  })
  const file = path.join(profile, 'settings.json')
  fs.writeFileSync(file, '{')
  assert(Object.values(persistence.loadSettings().tools).every((p) => p === 'block'))
  assert(persistence.settingsRecovery().required)
  assert(fs.existsSync(path.join(profile, persistence.settingsRecovery().backup)))
  persistence.acknowledgeSettingsRecovery()
  fs.writeFileSync(
    file,
    JSON.stringify({
      model: { endpoint: 'http://remote.example/v1' },
      tools: { read_file: 'allow' }
    })
  )
  assert.equal(persistence.loadSettings().tools.read_file, 'ask', 'Legacy grants must be reset')
  assert.equal(
    persistence.getSettings().model.provider,
    'local',
    'Legacy profiles retain local inference'
  )
  assert.equal(persistence.getSettings().model.endpoint, 'http://127.0.0.1:1234/v1')
  assert.throws(
    () => persistence.draftSettings({ model: { endpoint: 'https://api.openai.com/v1' } }),
    /Remote inference is disabled/
  )
  assert.throws(
    () => persistence.draftSettings({ model: { provider: 'unknown' } }),
    /Unknown model provider/
  )
  const apiConnection = {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    modelId: 'fixture-model',
    maxTokens: 8192
  }
  persistence.updateSettings({ model: apiConnection })
  assert.equal(persistence.loadSettings().model.provider, 'openai')
  assert.equal(persistence.getSettings().model.maxTokens, 8192)
  persistence.updateSettings({ model: { provider: 'chatgpt' } })
  assert.equal(persistence.loadSettings().model.provider, 'chatgpt')
  assert.throws(
    () => persistence.draftSettings({ model: { endpoint: 'https://other.example/v1' } }),
    /OpenAI requires/
  )
  persistence.updateSettings({ model: { provider: 'openai' } })
  assert.throws(
    () => persistence.draftSettings({ model: { endpoint: 'https://other.example/v1' } }),
    /OpenAI requires/
  )
  persistence.updateSettings({
    model: { provider: 'compatible', endpoint: 'https://other.example/api/v1' }
  })
  assert.equal(persistence.loadSettings().model.endpoint, 'https://other.example/api/v1')
  persistence.updateSettings({ model: { provider: 'local', endpoint: 'http://127.0.0.1:1234/v1' } })
  const before = persistence.getSettings()
  failSave = true
  assert.throws(() => persistence.updateSettings({ tools: { read_file: 'ask' } }), /save settings/)
  assert.deepEqual(
    persistence.getSettings(),
    before,
    'A failed write cannot commit authority in memory'
  )
  failSave = false
  persistence.updateSettings({ tools: { read_file: 'allow' } })
  assert.equal(
    persistence.loadSettings().tools.read_file,
    'allow',
    'Current Always allow grants persist across reload'
  )
  persistence.updateSettings({ tools: { read_file: 'block' } })
  persistence.updateSettings({ tools: { read_file: 'ask' } })
  const approvalPermissions = load('src/main/permissions.ts', {
    './settings': persistence,
    './tools/registry': registry
  })
  const approvedRun = runManager.startRun('assistant', persistence.getSettings().model.endpoint, '')
  const approvalId = crypto.randomUUID()
  const granted = approvalPermissions.requestApproval(approvalId, approvedRun.signal, () =>
    persistence.allowApprovedTool('read_file', approvedRun)
  )
  failSave = true
  assert.throws(() => approvalPermissions.resolveApproval(approvalId, 'always'), /save settings/)
  assert.equal(persistence.getSettings().tools.read_file, 'ask')
  runManager.assertRun(approvedRun)
  failSave = false
  approvalPermissions.resolveApproval(approvalId, 'always')
  assert.equal(await granted, 'always')
  runManager.assertRun(approvedRun)
  assert.equal(persistence.loadSettings().tools.read_file, 'allow')
  assert.throws(() => persistence.allowApprovedTool('run_npm', approvedRun))
  persistence.updateSettings({ tools: { read_file: 'ask' } })
  assert.throws(() => runManager.assertRun(approvedRun))
  approvalPermissions.resolveApproval(approvalId, 'always')
  assert.equal(persistence.getSettings().tools.read_file, 'ask', 'Replayed grants do nothing')
  assert.throws(() => persistence.allowApprovedTool('read_file', approvedRun))
  runManager.finishRun(approvedRun)
  let grantCount = 0
  for (const decision of ['deny', 'stop']) {
    const controller = new AbortController()
    const id = crypto.randomUUID()
    const pending = approvalPermissions.requestApproval(id, controller.signal, () => grantCount++)
    if (decision === 'stop') controller.abort()
    else approvalPermissions.resolveApproval(id, 'deny')
    assert.equal(await pending, 'deny')
    approvalPermissions.resolveApproval(id, 'always')
  }
  assert.equal(grantCount, 0, 'Denied/stopped approvals cannot widen permissions')
  const npmId = crypto.randomUUID()
  const npmApproval = approvalPermissions.requestApproval(npmId)
  approvalPermissions.resolveApproval(npmId, 'always')
  approvalPermissions.resolveApproval(npmId, 'once')
  assert.equal(await npmApproval, 'once', 'One-use-only approvals reject permanent grants')
  persistence.updateSettings({ tools: { read_file: 'block' } })
  console.log(
    'PASS pending permanent grant, save failure, run continuity, revocation, replay, Stop and npm exclusion'
  )
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete saved.tools.read_file
  saved.tools.open_app = 'corrupt'
  fs.writeFileSync(file, JSON.stringify(saved))
  assert.equal(persistence.loadSettings().tools.read_file, 'block')
  assert.equal(persistence.getSettings().tools.open_app, 'block')
  const copy = persistence.getSettings()
  copy.tools.read_file = 'ask'
  assert.equal(persistence.getSettings().tools.read_file, 'block')
  console.log(
    'PASS corrupted policy, legacy-grant migration, missing/invalid grants, atomic save failure and defensive snapshots'
  )

  const handlers = new Map(),
    listeners = new Map()
  const sender = { isDestroyed: () => false, mainFrame: { url: 'sophon-app://app/index.html' } }
  const document = load('src/main/security/trusted-document.ts', {
    '@electron-toolkit/utils': { is: { dev: false } }
  })
  const ipc = load('src/main/security/ipc.ts', {
    '../memory/records': load('src/main/memory/records.ts'),
    electron: {
      ipcMain: {
        handle: (name, callback) => handlers.set(name, callback),
        on: (name, callback) => listeners.set(name, callback)
      }
    },
    './trusted-document': document,
    '../settings': persistence,
    './tool-contracts': contracts
  }).secureIpc((s) => s === sender)
  let changed = 0
  ipc.handle('settings:update', () => {
    changed++
  })
  ipc.on('voice:audio', () => {
    changed++
  })
  const valid = { sender, senderFrame: sender.mainFrame }
  let keyChanges = 0
  ipc.handle('model:set-key', () => {
    keyChanges++
  })
  const keyHandler = handlers.get('model:set-key')
  for (const args of [
    ['local', 'http://127.0.0.1:1234/v1', 'fixture-key'],
    ['openai', apiConnection.endpoint],
    ['openai', apiConnection.endpoint, 'x'.repeat(4097)],
    ['openai', apiConnection.endpoint, 'fixture-key', 'extra']
  ])
    assert.throws(() => keyHandler(valid, ...args), /Invalid IPC/)
  assert.throws(
    () => keyHandler({ sender, senderFrame: {} }, 'openai', apiConnection.endpoint, 'fixture-key'),
    /Untrusted/
  )
  keyHandler(valid, 'openai', apiConnection.endpoint, 'fixture-key')
  assert.equal(keyChanges, 1)
  let taught = 0
  ipc.handle('memory:save', () => {
    taught++
  })
  const teach = handlers.get('memory:save')
  const note = {
    title: 'Tests',
    content: 'Run the project checks.',
    kind: 'procedure',
    scope: 'global',
    pinned: false
  }
  for (const bad of [
    null,
    [],
    { ...note, content: 'x'.repeat(1201) },
    { ...note, source: 'model' },
    { ...note, scopeKey: 'forged' },
    { ...note, id: '../other' }
  ])
    assert.throws(() => teach(valid, bad), /Invalid IPC/)
  assert.throws(() => teach({ sender, senderFrame: {} }, note), /Untrusted/)
  teach(valid, note)
  assert.equal(taught, 1)
  let clipboardText
  ipc.handle('clipboard:write-text', (_event, value) => {
    clipboardText = value
  })
  const copyHandler = handlers.get('clipboard:write-text')
  copyHandler(valid, 'const answer = 42\n')
  assert.equal(clipboardText, 'const answer = 42\n')
  assert.throws(() => copyHandler({ sender, senderFrame: {} }, 'text'), /Untrusted/)
  for (const value of [null, {}, 'x'.repeat(512001), 'bad\0text'])
    assert.throws(() => copyHandler(valid, value), /Invalid IPC/)
  const settingsHandler = handlers.get('settings:update')
  for (const event of [
    { sender: { ...sender }, senderFrame: sender.mainFrame },
    { sender, senderFrame: { url: sender.mainFrame.url } },
    { sender, senderFrame: null }
  ])
    assert.throws(() => settingsHandler(event, { tools: { read_file: 'block' } }), /Untrusted/)
  const original = sender.mainFrame.url
  for (const url of [
    'sophon-visual://render/id',
    'file:///C:/untrusted/index.html',
    'https://example.com',
    original + '?x=1',
    'sophon-app://app/assets/evil.html'
  ]) {
    sender.mainFrame.url = url
    assert.throws(() => settingsHandler(valid, {}), /Untrusted/)
  }
  sender.mainFrame.url = original
  for (const patch of [
    null,
    [],
    'x',
    { tools: { read_file: 2 } },
    { policyVersion: 2 },
    { voice: { serverPath: 'C:\\custom.exe' } },
    { voice: { modelPath: 'C:\\custom.bin' } },
    { bogus: true },
    JSON.parse('{"__proto__":{}}')
  ])
    assert.throws(() => settingsHandler(valid, patch), /Invalid IPC/)
  settingsHandler(valid, { tools: { read_file: 'block' } })
  assert.equal(changed, 1)
  listeners.get('voice:audio')({ sender, senderFrame: {} }, crypto.randomUUID(), new Uint8Array(2))
  listeners.get('voice:audio')(valid, crypto.randomUUID(), new Uint8Array(3000000))
  assert.equal(changed, 1, 'Untrusted events and oversized audio must be discarded')
  for (let i = 0; i < 19; i++) settingsHandler(valid, {})
  assert.throws(() => settingsHandler(valid, {}), /rate limit/)
  assert.throws(() => ipc.handle('unlisted', () => {}), /contract/)
  console.log(
    'PASS unowned/sibling/child/null/navigated senders, payload/prototype bounds, unlisted IPC, event validation and rate limits'
  )

  const exposed = new Map()
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) },
    ipcRenderer: { invoke: () => {}, on: () => {}, send: () => {} }
  }
  load('src/preload/index.ts', { electron, __process: { contextIsolated: true } })
  assert.deepEqual([...exposed.keys()], ['api'])
  assert.equal(exposed.get('api').ipcRenderer, undefined)
  assert.equal(exposed.get('api').process, undefined)
  assert.throws(
    () => load('src/preload/index.ts', { electron, __process: { contextIsolated: false } }),
    /context isolation/
  )
  console.log(
    'PASS narrow bridge has no generic IPC, process, environment or insecure window fallback'
  )
}
