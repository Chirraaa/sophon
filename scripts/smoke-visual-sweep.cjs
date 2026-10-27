const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/visual-sweep')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = globalShortcut.unregisterAll = () => {}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (channel === 'llm:status') return { online: false }
    if (channel === 'plugins:list' || channel === 'github:accounts')
      return {
        plugins: [],
        servers: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'github-account-with-an-extremely-long-organization-name',
            configuration: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
            status: 'disconnected',
            credentialNames: []
          }
        ]
      }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().some((w) => w.isResizable()), 'window')
  const window = BrowserWindow.getAllWindows().find((w) => w.isResizable())
  window.webContents.setBackgroundThrottling(false)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  const evaluate = (code) => window.webContents.executeJavaScript(code, true)
  await window.webContents.insertCSS(
    '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }'
  )
  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await delay(150)
  }
  const escape = async () => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await delay(200)
  }
  const capture = async (name) => {
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(200)
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).toPNG()
    )
  }
  await wait(() => evaluate(`!!document.querySelector('[aria-label="GitHub"]')`), 'navigation')
  await evaluate(`document.documentElement.dataset.reducedMotion = 'true'`)
  let checked = 0
  async function checkSelect(index, name) {
    await evaluate(
      `document.querySelectorAll('[data-slot="select-trigger"]')[${index}].scrollIntoView({block:'center'})`
    )
    await delay(100)
    await evaluate(`document.querySelectorAll('[data-slot="select-trigger"]')[${index}].click()`)
    await wait(() => evaluate(`!!document.querySelector('[data-slot="select-content"]')`), name)
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(200)
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    const bounds = await evaluate(`(() => {
      const popup = document.querySelector('[data-slot="select-content"]');
      const p = popup.getBoundingClientRect(); const t = document.querySelectorAll('[data-slot="select-trigger"]')[${index}].getBoundingClientRect();
      return { within: p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight, separate: p.top >= t.bottom - 1 || p.bottom <= t.top + 1, padded: parseFloat(getComputedStyle(popup).paddingTop) >= 4, overflow: popup.scrollWidth > popup.clientWidth + 1, p: p.toJSON(), t: t.toJSON(), align: popup.dataset.alignTrigger };
    })()`)
    if (!bounds.separate) await capture('failure')
    assert(
      bounds.within && bounds.separate && bounds.padded && !bounds.overflow,
      name + ': ' + JSON.stringify(bounds)
    )
    checked++
    await escape()
  }
  for (const width of [780, 1120, 1440]) {
    window.setSize(width, 800)
    await click('[aria-label="GitHub"]')
    await wait(
      () => evaluate(`!!document.querySelector('[aria-label="GitHub account connection"]')`),
      'account'
    )
    await checkSelect(0, 'GitHub ' + width)
    await click('[aria-label="GitHub account connection"]')
    await capture('github-dropdown-' + width)
    await escape()
    await click('[aria-label="Settings"]')
    for (const tab of [
      'General',
      'Model',
      'Behavior',
      'Permissions',
      'Memory',
      'Voice',
      'Files',
      'Hardware',
      'Plugins'
    ]) {
      await evaluate(
        `Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.textContent === ${JSON.stringify(tab)}).click()`
      )
      await delay(200)
      const overflow = await evaluate(
        `(() => { const panel = document.querySelector('[role="tabpanel"]'); return panel ? panel.scrollWidth > panel.clientWidth + 1 : false })()`
      )
      assert(!overflow, tab + ' panel horizontal overflow at ' + width)
      const count = await evaluate(
        `document.querySelectorAll('[data-slot="select-trigger"]:not(:disabled)').length`
      )

      for (let i = 0; i < count; i++) await checkSelect(i, tab + ' select ' + i + ' at ' + width)
      if (width === 780) await capture('settings-' + tab.toLowerCase())
    }
  }
  assert(BrowserWindow.getAllWindows().every((w) => !w.isVisible()))
  console.log(
    `PASS visual sweep: ${checked} dropdown checks, nine settings panels at 780/1120/1440px, long account names, popup separation, padding and viewport containment.`
  )
}
main()
  .then(() => app.quit())
  .catch((e) => {
    console.error(e)
    app.exit(1)
  })
