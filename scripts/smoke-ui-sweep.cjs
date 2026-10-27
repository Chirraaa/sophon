const { app, BrowserWindow, globalShortcut } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(
  process.env.UI_SWEEP_OUTPUT || path.join(root, '.cache/ui-sweep'),
  process.env.UI_SWEEP_PHASE || 'after'
)
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
require(path.join(root, 'out/main/index.js'))
async function wait(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('UI did not become ready')
}
async function run() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2)
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => win !== main)
  main.webContents.setBackgroundThrottling(false)
  compact.webContents.setBackgroundThrottling(false)
  const evaluate = (win, code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Evaluation failed:', code)
      throw error
    })
  await wait(() => evaluate(main, '!!document.querySelector("textarea")'))
  await evaluate(main, 'window.api.updateSettings({ motion: "reduced" })')
  await wait(() => evaluate(main, 'document.documentElement.dataset.reducedMotion === "true"'))
  async function capture(win, name) {
    const frame = async () => {
      try {
        return await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      } catch {
        await delay(300)
        return win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      }
    }
    await frame()
    await delay(500)
    fs.writeFileSync(path.join(output, name + '.png'), (await frame()).toPNG())
    assert(
      await evaluate(win, 'document.documentElement.scrollWidth <= innerWidth'),
      name + ' horizontal overflow'
    )
  }
  for (const [width, height] of [
    [780, 540],
    [1120, 760]
  ]) {
    main.setSize(width, height)
    await capture(main, `chat-${width}x${height}`)
    await evaluate(main, 'document.querySelector("[aria-label=Settings]").click()')
    await wait(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Settings categories"]')`)
    )
    await capture(main, `settings-${width}x${height}`)
    const tabs = await evaluate(
      main,
      `Array.from(document.querySelectorAll('[role=tab]')).map(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth })`
    )
    assert.equal(tabs.length, 9)
    assert(tabs.every(Boolean), 'all settings tabs fit')
    await evaluate(main, 'document.querySelector("[aria-label=Assistant]").click()')
  }
  await wait(() => evaluate(compact, '!!document.querySelector("textarea")'))
  await capture(compact, 'compact')
  console.log('UI sweep layout and screenshots passed:', output)
}
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
