const { app, BrowserWindow, globalShortcut, ipcMain, safeStorage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/plugins-ui')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (channel === 'llm:status') return { online: false, model: '' }
    if (channel === 'llm:modelInfo') return { id: 'fixture' }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'application windows')
  const main = BrowserWindow.getAllWindows().find((w) => w.isResizable())
  const errors = []
  main.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  main.webContents.setBackgroundThrottling(false)
  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  await main.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  const click = async (label, scope = 'document') => {
    const button = `Array.from(${scope}.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)})`
    await wait(() => evaluate(`!!(${button}) && !(${button}).disabled`), 'enabled button: ' + label)
    await evaluate(`(${button}).click()`)
  }
  const card = `Array.from(document.querySelectorAll('section[aria-label="MCP connections"] > div')).find(el => el.querySelector('h4')?.textContent === 'Fixture MCP')`
  const snapshot = () => evaluate('window.api.plugins.list()')
  const setField = (selector, value, textarea = false) =>
    evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
  await wait(
    () => evaluate(`!!document.querySelector('nav[aria-label="Main navigation"]')`),
    'navigation'
  )
  await click('Skip setup', `document.querySelector('[role="dialog"]')`)
  await wait(() => evaluate(`!document.querySelector('[role="dialog"]')`), 'onboarding complete')
  await click('Settings', `document.querySelector('nav[aria-label="Main navigation"]')`)
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('[role="tab"]')).some(el => el.textContent === 'Plugins')`
      ),
    'plugins tab'
  )
  await click('Plugins')
  await wait(
    () => evaluate(`document.body.textContent.includes('No plugins installed.')`),
    'empty plugin registry'
  )
  assert.deepEqual((await snapshot()).plugins, [])
  assert.deepEqual((await snapshot()).servers, [])
  await click('Add MCP connection')
  await click('Local MCP')
  const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true })
    .trim()
    .split(/\r?\n/)[0]
  await setField('form input', 'Fixture MCP')
  await setField(
    'form textarea',
    JSON.stringify(
      {
        type: 'stdio',
        command: node,
        args: [path.join(root, 'scripts/fixtures/mcp-server.cjs')],
        env: { TEST_TOKEN: 'ui-secret-canary' }
      },
      null,
      2
    ),
    true
  )
  await click('Save connection')
  await wait(
    async () => (await snapshot()).servers.some((s) => s.name === 'Fixture MCP'),
    'saved fixture'
  )
  await wait(() => evaluate(`!!(${card})`), 'fixture card')
  await click('Enable connection', card)
  await wait(
    () => evaluate(`!!document.querySelector('[role="alertdialog"]')`),
    'real native consent'
  )
  assert(
    await evaluate(
      `document.querySelector('[role="alertdialog"]').textContent.includes('outside Sophon')`
    )
  )
  assert(
    !(await evaluate(
      `document.querySelector('[role="alertdialog"]').textContent.includes('ui-secret-canary')`
    ))
  )
  await click('Cancel', `document.querySelector('[role="alertdialog"]')`)
  await wait(() => evaluate(`!document.querySelector('[role="alertdialog"]')`), 'cancel consent')
  assert(!(await snapshot()).servers.find((s) => s.name === 'Fixture MCP').enabled)
  await click('Enable connection', card)
  await wait(() => evaluate(`!!document.querySelector('[role="alertdialog"]')`), 'second consent')
  await click('Allow this exact action', `document.querySelector('[role="alertdialog"]')`)
  await wait(
    async () => (await snapshot()).servers.find((s) => s.name === 'Fixture MCP').enabled,
    'enabled fixture'
  )
  await wait(() => evaluate(`!(${card}).querySelector('button').disabled`), 'settled UI')
  await click('Connect', card)
  await wait(
    async () =>
      (await snapshot()).servers.find((s) => s.name === 'Fixture MCP').status === 'connected',
    'real MCP connection'
  )
  await wait(() => evaluate(`(${card}).textContent.includes('3 tools')`), 'tool count')
  assert(!JSON.stringify(await snapshot()).includes('ui-secret-canary'))
  const encrypted = fs.readFileSync(path.join(profile, 'plugins/registry.enc'))
  assert(!encrypted.includes('ui-secret-canary'))
  assert(safeStorage.decryptString(encrypted).includes('ui-secret-canary'))
  await evaluate(`(${card}).scrollIntoView({ block: 'center' })`)
  await delay(300)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      await delay(400)
      fs.writeFileSync(
        path.join(output, 'connected.png'),
        (
          await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG()
      )
      break
    } catch (error) {
      if (attempt === 2) throw error
      await delay(300)
    }
  }
  await click('Disconnect', card)
  await wait(
    async () =>
      (await snapshot()).servers.find((s) => s.name === 'Fixture MCP').status === 'disconnected',
    'disconnect'
  )
  await click('Configure', card)
  await wait(() => evaluate(`!!document.querySelector('form textarea')`), 'configuration editor')
  assert(
    !(await evaluate(`document.querySelector('form textarea').value.includes('ui-secret-canary')`))
  )
  await click('Save connection')
  await wait(() => evaluate(`!document.querySelector('form')`), 'saved replacement')
  const replaced = (await snapshot()).servers.find((s) => s.name === 'Fixture MCP')
  assert.equal(replaced.enabled, false)
  assert.equal(replaced.credentialNames.length, 0)
  await evaluate(`document.querySelector('[aria-label="Remove Fixture MCP connection"]').click()`)
  await wait(
    async () => !(await snapshot()).servers.some((s) => s.name === 'Fixture MCP'),
    'removal'
  )
  await click('Assistant', `document.querySelector('nav[aria-label="Main navigation"]')`)
  const session = await evaluate('window.api.getSession()')
  main.webContents.send('session:update', {
    ...session,
    busy: true,
    runningChatId: session.chatId,
    items: [
      {
        id: 'plugin-preview-fixture',
        from: 'agent',
        text: '',
        pending: true,
        actions: [
          {
            id: 'mcp-preview',
            name: 'mcp_call',
            label: 'MCP: echo',
            status: 'waiting',
            canAlwaysAllow: false,
            preview: JSON.stringify({
              arguments: { server: 'fixture', tool: 'echo', arguments_json: '{"message":"hello"}' },
              plugin: {
                server: 'Fixture MCP',
                destination: 'https://fixture.example/mcp',
                operation: 'echo',
                arguments: { message: 'hello' },
                access: 'Arguments go to this external service.'
              }
            })
          }
        ]
      }
    ]
  })
  await wait(
    () => evaluate(`!!document.querySelector('section[aria-busy]')`),
    'MCP action approval'
  )
  const preview = await evaluate(`document.querySelector('section[aria-busy]').textContent`)
  assert(
    preview.includes('Fixture MCP') &&
      preview.includes('https://fixture.example/mcp') &&
      preview.includes('hello')
  )
  assert(
    !(await evaluate(
      `Array.from(document.querySelectorAll('section[aria-busy] button')).some(b => /Always allow/.test(b.textContent))`
    ))
  )

  assert.deepEqual(
    errors.filter((message) => !message.startsWith("Loading the font 'data:font/woff2;base64,")),
    []
  )
  assert(
    BrowserWindow.getAllWindows().every((win) => !win.isVisible()),
    'Test windows stay hidden'
  )
  console.log(
    'PASS production Plugins UI, empty defaults, JSON form, real consent cancellation/approval, actual stdio handshake, Windows encryption, credential omission/replacement, disconnect and removal'
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
