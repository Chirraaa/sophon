const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/dock-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let hides = 0
const on = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, listener) =>
  on(channel, (...args) => {
    if (channel === 'compact:hide' || channel === 'compact:dismiss') hides++
    return listener(...args)
  })
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => errors.push(details))
  contents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes("Loading the font 'data:"))
      errors.push(details.message)
  })
})
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const until = Date.now() + 15000
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
  const mainEval = (code) => main.webContents.executeJavaScript(code, true)
  const compactEval = (code) => compact.webContents.executeJavaScript(code, true)
  compact.webContents.setBackgroundThrottling(false)
  await wait(() => mainEval('!!document.querySelector("textarea")'), 'main ready')
  await wait(() => compactEval('!!document.querySelector("textarea")'), 'compact ready')
  const barText = () =>
    compactEval(`(() => {
      const bar = document.querySelector('button[aria-label^="Sophon:"]')
      return bar ? bar.textContent : null
    })()`)
  const area = () => screen.getDisplayMatching(compact.getBounds()).workArea
  const capture = async (file) => {
    await compact.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(100)
    const shot = await compact.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true
    })
    fs.writeFileSync(path.join(output, file + '.png'), shot.toPNG())
  }
  assert.equal(main.isVisible(), false, 'main starts hidden')
  assert.equal(compact.isVisible(), false, 'no dock before the setting is on')

  // Persistent dock: a slim bar rests at the top while the full app is away.
  await mainEval('window.api.updateSettings({motion:"reduced",profile:{onboardingComplete:true}})')
  const saved = await mainEval('window.api.updateSettings({dockAlwaysVisible:true})')
  assert.equal(saved.ok, true)
  await wait(() => compact.isVisible(), 'rest dock visible')
  await wait(() => compact.getBounds().y === area().y, 'rest dock at top')
  assert.equal(compact.isFocused(), false, 'the rest dock never takes focus')
  await wait(async () => /Ready/.test((await barText()) ?? ''), 'rest bar label')
  await capture('rest')

  // Hovering opens the shortcut window; leaving returns to the bar.
  await compactEval(`document.querySelector('[data-compact-size], button[aria-label^="Sophon:"]')
    .parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await wait(() => compactEval('!!document.querySelector("[data-compact-size]")'), 'hover opens')
  await capture('hover')
  await compactEval(`document.querySelector('[data-compact-size]').closest('.grid')
    .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`)
  await wait(async () => (await barText()) !== null, 'returns to bar')
  assert.equal(compact.isVisible(), true, 'the bar stays on screen')

  // A finished task flags the bar while the full app is hidden.
  await mainEval('window.api.updateSettings({dockAlwaysVisible:false})')
  await wait(() => !compact.isVisible(), 'dock removed when the setting is off')
  await mainEval('window.api.send("hello").catch(() => {})')
  await wait(() => compact.isVisible(), 'dock appears when a task ends')
  await wait(async () => /Task finished/.test((await barText()) ?? ''), 'finished sign')
  assert.equal(compact.isFocused(), false, 'the alert never takes focus')
  assert.equal(compact.getBounds().y, area().y, 'alert docks at the top')
  await capture('finished')

  // Seeing the sign and moving away dismisses it.
  const before = hides
  await compactEval(`document.querySelector('button[aria-label^="Sophon:"]')
    .parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await wait(() => compactEval('!!document.querySelector("[data-compact-size]")'), 'sign opens')
  await compactEval(`document.querySelector('[data-compact-size]').closest('.grid')
    .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`)
  await wait(() => hides > before, 'dismissed after being seen')
  await wait(() => !compact.isVisible(), 'dock hides after dismissal')

  // A task waiting for approval opens the docked window instead of a bar.
  const waiting = {
    chatId: 'dock-fixture',
    mode: 'assistant',
    busy: true,
    runningChatId: 'dock-fixture',
    chats: [{ id: 'dock-fixture', title: 'Dock', updatedAt: Date.now() }],
    items: [
      {
        id: 'a',
        from: 'agent',
        text: '',
        pending: true,
        actions: [
          {
            id: 'w',
            name: 'run_command',
            label: 'Run command',
            status: 'waiting',
            canAlwaysAllow: true,
            preview: '{}'
          }
        ]
      }
    ]
  }
  compact.webContents.send('session:update', waiting)
  compact.webContents.send('compact:shown', { mode: 'command', token: 99, docked: true })
  await wait(() => compactEval('!!document.querySelector("[data-compact-size]")'), 'approval opens')
  assert.equal(await barText(), null, 'a waiting approval is never hidden behind the bar')
  compact.webContents.send('session:update', { ...waiting, busy: false, items: [] })
  await delay(300)

  // With the alert setting off, nothing appears.
  await mainEval('window.api.updateSettings({dockNotify:false})')
  await mainEval('window.api.send("again").catch(() => {})')
  await delay(2500)
  assert.equal(compact.isVisible(), false, 'no alert when disabled')
  assert.deepEqual(errors, [])
  console.log(
    'PASS dock UI: persistent rest bar, hover to open, finished alert without stealing focus, dismissal once seen, and both settings'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
