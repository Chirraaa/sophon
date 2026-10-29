const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { load } = require('./security/load.cjs')

const exe = process.env.LLAMA_SERVER_EXE
const modelPath = process.env.LLAMA_MODEL
if (!exe || !modelPath) {
  console.log('skipped llama.cpp UI check (set LLAMA_SERVER_EXE and LLAMA_MODEL)')
  app.exit(0)
}
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/llama-ui')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}

// What a user would have saved after choosing the program and model in the file pickers.
const shared = load('src/shared/llama-server.ts')
const help = spawnSync(exe, ['--help'], { encoding: 'utf8' })
const caps = shared.parseLlamaCapabilities(help.stdout + help.stderr)
const PORT = 18091
fs.writeFileSync(
  path.join(profile, 'llama-server.json'),
  JSON.stringify({
    enabled: true,
    executable: exe,
    modelPath,
    caps,
    options: { ...shared.DEFAULT_LLAMA_OPTIONS, contextSize: 4096, port: PORT }
  })
)

const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (channel === 'llm:modelInfo') return { id: 'fixture' }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))

async function wait(check, label) {
  const end = Date.now() + 90000
  while (Date.now() < end) {
    if (await check()) return
    await delay(100)
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
  const capture = async (name) => {
    // A hidden window can hand back an old frame, so ask once to refresh it and keep the second.
    await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(400)
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    )
  }
  const text = () => evaluate('document.body.innerText')
  const button = (label) =>
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)})`
  const click = async (label) => {
    await wait(
      () => evaluate(`!!(${button(label)}) && !(${button(label)}).disabled`),
      'button ' + label
    )
    await evaluate(`(${button(label)}).click()`)
  }
  const row = (label) =>
    `Array.from(document.querySelectorAll('[data-setting-row]')).find(r => r.textContent.startsWith(${JSON.stringify(label)}))`
  const setNumber = (label, value) =>
    evaluate(`(() => {
      const el = (${row(label)}).querySelector('input')
      el.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })()`)
  const llama = () => evaluate('window.api.llama.get()')
  // Drive a dropdown the way a person does: open it, then pick the option by its label.
  const choose = async (label, option) => {
    await evaluate(`(${row(label)}).querySelector('button, [role="combobox"]').click()`)
    await wait(
      () => evaluate("document.querySelectorAll('[role=option]').length > 0"),
      'options for ' + label
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[role=option]')).find(el => el.textContent.trim() === ${JSON.stringify(option)}).click()`
    )
  }

  await wait(
    () => evaluate(`!!document.querySelector('nav[aria-label="Main navigation"]')`),
    'navigation'
  )
  await click('Skip setup')
  await wait(() => evaluate(`!document.querySelector('[role="dialog"]')`), 'onboarding complete')

  await evaluate(
    `Array.from(document.querySelectorAll('nav[aria-label="Main navigation"] button')).find(b => b.textContent.trim() === 'Settings').click()`
  )
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('[role="tab"]')).some(el => el.textContent === 'Model')`
      ),
    'Model tab'
  )
  await evaluate(
    `Array.from(document.querySelectorAll('[role="tab"]')).find(el => el.textContent === 'Model').click()`
  )

  // The saved choices show up with the Runtime set to llama.cpp, and the external address is hidden.
  await wait(async () => (await text()).includes('llama.cpp, run by Sophon'), 'runtime row')
  await wait(async () => (await text()).includes('Context size'), 'llama.cpp panel')
  let page = await text()
  assert(page.includes(exe) && page.includes(modelPath), 'saved program and model are shown')
  assert(
    !page.includes('Server address'),
    'the external address is hidden while Sophon runs the model'
  )
  assert(page.includes('Memory-map the model') && page.includes('Let the model think first'))
  assert(!page.includes('Limit thinking'), 'the thinking budget only appears once thinking is on')
  await capture('1-stopped')

  // Inline validation: a styled message, no native bubble, and nothing is saved.
  await setNumber('Context size', 100)
  await wait(
    async () => (await text()).includes('Enter a number from 2048 to 131072.'),
    'context error'
  )
  assert.equal(
    await evaluate(`(${row('Context size')}).querySelector('input').getAttribute('aria-invalid')`),
    'true'
  )
  assert.equal((await llama()).config.options.contextSize, 4096)

  // A conflicting pair of options is explained and blocks Start.
  await choose('Context memory', 'Compressed (q8_0)')
  await choose('Flash attention', 'Off')
  await wait(async () => (await text()).includes('needs flash attention'), 'cache conflict')
  assert.equal(await evaluate(`(${button('Start')}).disabled`), true)
  await capture('2-conflict')
  await choose('Flash attention', 'Automatic')
  await choose('Context memory', 'Full precision (f16)')
  await wait(async () => !(await text()).includes('needs flash attention'), 'conflict cleared')

  // Start from the screen: the real program loads the real model, and Sophon follows it.
  await click('Start')
  await wait(async () => (await text()).includes('Loading the model'), 'loading state')
  await wait(async () => (await text()).includes(`Running on port ${PORT}`), 'running')
  try {
    await wait(
      async () => (await text()).includes('Model connected'),
      'sidebar shows the model connected'
    )
  } catch (error) {
    console.error('llm status:', JSON.stringify(await evaluate('window.api.llmStatus()')))
    console.error('model choices:', JSON.stringify(await evaluate('window.api.llmModelChoices()')))
    console.error(
      'model settings:',
      JSON.stringify((await evaluate('window.api.getSettings()')).model)
    )
    throw error
  }
  await evaluate(`(${row('Status')}).scrollIntoView({ block: 'center' })`)
  await capture('3-running')
  const settings = await evaluate('window.api.getSettings()')
  assert.equal(settings.model.endpoint, `http://127.0.0.1:${PORT}/v1`)
  assert.equal(settings.model.contextWindow, 4096)
  assert.equal(settings.model.provider, 'local')
  // The page's content policy blocks arbitrary ports, so the test asks the server from outside.
  const models = await (await fetch(`http://127.0.0.1:${PORT}/v1/models`)).json()
  assert(models.data.length > 0)

  // A start-time option changed while running is held back and offered as a restart.
  await setNumber('Context size', 8192)
  await wait(
    async () => (await text()).includes('Some changes apply the next time the model starts'),
    'restart notice'
  )
  assert.equal((await llama()).applied.contextSize, 4096)
  await evaluate(`(${row('Status')}).scrollIntoView({ block: 'center' })`)
  await capture('4-restart-offered')
  await click('Restart now')
  await wait(
    async () =>
      (await llama()).applied?.contextSize === 8192 && (await llama()).status.state === 'running',
    'restarted'
  )
  assert.equal((await evaluate('window.api.getSettings()')).model.contextWindow, 8192)

  // Stop, then go back to another app: the address field returns and points at the usual server.
  await click('Stop')
  await wait(async () => (await llama()).status.state === 'stopped', 'stopped')
  await assert.rejects(fetch(`http://127.0.0.1:${PORT}/health`), 'the port is closed after Stop')
  await choose('Runtime', 'Another app (LM Studio, etc.)')
  await wait(async () => (await text()).includes('Server address'), 'address row returns')
  assert.equal(
    (await evaluate('window.api.getSettings()')).model.endpoint,
    'http://127.0.0.1:1234/v1'
  )
  assert(!(await text()).includes('Memory-map the model'))
  await capture('5-external')

  assert.deepEqual(
    errors.filter((message) => !message.startsWith("Loading the font 'data:font/woff2;base64,")),
    []
  )
  assert(
    BrowserWindow.getAllWindows().every((win) => !win.isVisible()),
    'Test windows stay hidden'
  )
  console.log(
    'PASS production llama.cpp UI: saved choices, inline validation, option conflicts, start, Sophon follows the server, restart offer, stop, switch back'
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
