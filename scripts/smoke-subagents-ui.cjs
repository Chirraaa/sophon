const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/subagents-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let state
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) =>
    channel === 'session:get' && state ? state : listener(...args)
  )
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => errors.push(details))
  contents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes("Loading the font 'data:"))
      errors.push(details.message)
  })
})
require(path.join(root, 'out/main/index.js'))
const agents = (statuses) =>
  statuses.map((status, n) => ({
    id: 'agent-' + n,
    profile: n === 3 ? 'researcher' : 'simple',
    status,
    task: `Job ${n + 1}: summarize the long assignment text that must be truncated to one line`,
    modelCalls: status === 'running' ? 0 : 1,
    estimatedInputTokens: 145,
    ...(status === 'done' ? { summary: 'FINDING_' + n } : {}),
    ...(status === 'failed' ? { summary: 'The specialist reached its model-call limit.' } : {})
  }))
const fixture = (specialists) => ({
  chatId: 'subagents-fixture',
  mode: 'assistant',
  busy: false,
  runningChatId: null,
  chats: [{ id: 'subagents-fixture', title: 'Subagents', updatedAt: Date.now() }],
  items: [
    { id: 'u', from: 'you', text: 'Spawn ten agents.', actions: [], pending: false },
    { id: 'a', from: 'agent', text: 'Done.', actions: [], pending: false, specialists }
  ]
})
async function wait(check, label) {
  const until = Date.now() + 12000
  while (Date.now() < until) {
    if (await check()) return
    await delay(40)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  for (const [name, win] of [
    ['chat', main],
    ['shortcut', compact]
  ]) {
    win.webContents.setBackgroundThrottling(false)
    const evaluate = (code) => win.webContents.executeJavaScript(code, true)
    const publish = async (value) => {
      state = value
      win.webContents.send('session:update', state)
      await delay(300)
    }
    const capture = async (file) => {
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      await delay(100)
      const shot = await win.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true
      })
      fs.writeFileSync(path.join(output, `${name}-${file}.png`), shot.toPNG())
    }
    await wait(() => evaluate('!!document.querySelector("textarea")'), name + ' ready')
    await evaluate(
      'window.api.updateSettings({motion:"reduced",profile:{onboardingComplete:true}})'
    )
    const running = [...Array(6).fill('done'), ...Array(3).fill('running'), 'failed']
    await publish(fixture(agents(running)))
    await wait(
      () => evaluate('!!document.querySelector("[aria-label=Subagents]")'),
      name + ' panel'
    )
    const measure = () =>
      evaluate(`(() => {
        const regions = document.querySelectorAll('[aria-label="Subagents"]')
        const panel = regions[0].getBoundingClientRect()
        const view = document.querySelector('[data-chat-viewport]') ?? document.documentElement
        return {
          regions: regions.length,
          rows: regions[0].querySelectorAll('[data-slot="collapsible-trigger"]').length,
          height: panel.height,
          overflowX: view.scrollWidth > view.clientWidth + 1,
          text: regions[0].textContent
        }
      })()`)
    let shape = await measure()
    assert.equal(shape.regions, 1, name + ': one grouped panel, not ten cards')
    assert.match(shape.text, /7 of 10 done/, name + ': progress summary')
    assert(shape.height < 400, name + ': panel height stays bounded, got ' + shape.height)
    assert(!shape.overflowX, name + ': no horizontal overflow')
    await capture('working')
    await evaluate(`(() => {
      const row = document.querySelectorAll('[aria-label="Subagents"] [data-slot="collapsible-trigger"]')[1]
      row.click()
    })()`)
    await wait(() => evaluate('document.body.textContent.includes("FINDING_0")'), name + ' expand')
    await capture('expanded')
    await publish(fixture(agents(Array(10).fill('done'))))
    shape = await measure()
    assert.match(shape.text, /10 returned/, name + ': completion summary')
    assert(shape.height < 400, name + ': finished panel height bounded')
    await capture('done')
    await publish(fixture(agents(['running'])))
    shape = await measure()
    assert.equal(shape.rows, 1, name + ': single agent shows no group header')
    assert(!/Subagents/.test(shape.text) || shape.text.length < 200)
    await capture('single')
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS subagents UI: ten agents group into one bounded panel with progress, per-row details, completion and single-agent states in chat and shortcut windows'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
