const { app, BrowserWindow, globalShortcut, dialog, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/chat-layout')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = globalShortcut.unregisterAll = () => {}
dialog.showMessageBox = async () => ({ response: 0 })
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (channel === 'attachments:screenshot')
      throw new Error(
        'Could not capture the last active window. Bring that window to the foreground and try again.'
      )
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
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((window) => window.isResizable())
  const compact = BrowserWindow.getAllWindows().find((window) => !window.isResizable())
  for (const win of [main, compact]) {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
  }
  const evaluate = (win, code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(`${error.message}\n${code}`)
    })
  const mainEval = (code) => evaluate(main, code)
  const smallEval = (code) => evaluate(compact, code)
  const click = (win, selector) =>
    evaluate(win, `document.querySelector(${JSON.stringify(selector)}).click()`)
  const type = (win, text) =>
    evaluate(
      win,
      `(() => {
    const el = document.querySelector('[aria-label="Message Sophon"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`
    )
  const capture = async (win, name) => {
    await delay(200)
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    )
  }
  await wait(
    () => mainEval('!!window.api && !!document.querySelector(".welcome-state")'),
    'main loaded'
  )
  assert(
    (
      await mainEval(
        `window.api.updateSettings({ motion: 'reduced', profile: { name: 'Alex', onboardingComplete: true } })`
      )
    ).ok
  )
  const rendererSettings = await mainEval('window.api.getSettings()')

  rendererSettings.files.workspace = 'C:\\sophon-layout-fixture'
  rendererSettings.model.provider = 'chatgpt'
  for (const win of [main, compact]) win.webContents.send('settings:changed', rendererSettings)
  await wait(() => mainEval('!document.querySelector("[role=dialog]")'), 'setup closed')
  await delay(250)
  const layout = await mainEval(`(() => {
    const greeting = document.querySelector('.welcome-state').getBoundingClientRect();
    const dock = document.querySelector('.composer-dock').getBoundingClientRect();
    const body = document.querySelector('.composer-dock').parentElement.getBoundingClientRect();
    window.originalComposer = document.querySelector('[aria-label="Message Sophon"]');
    return {center: (greeting.top + dock.bottom) / 2, bodyCenter: (body.top + body.bottom) / 2, dockTop: dock.top, greeting: document.querySelector('.welcome-state').textContent};
  })()`)
  assert(
    Math.abs(layout.center - layout.bodyCenter) < 3,
    'Welcome and composer form a centered group'
  )
  assert(!layout.greeting.includes('What?s') && !layout.greeting.includes('How?s'))
  await capture(main, 'welcome-centered')
  await type(main, 'Help me build something')
  await wait(
    () =>
      mainEval(
        `document.querySelector('.composer-dock').getBoundingClientRect().top > ${layout.dockTop + 50}`
      ),
    'composer docks when typing'
  )
  assert(
    await mainEval(
      `window.originalComposer === document.querySelector('[aria-label="Message Sophon"]')`
    ),
    'Moving the composer preserves its DOM and focus'
  )
  await capture(main, 'composer-docked')
  await type(main, '')
  await wait(
    () =>
      mainEval(
        `Math.abs(document.querySelector('.composer-dock').getBoundingClientRect().top - ${layout.dockTop}) < 2`
      ),
    'empty composer recenters'
  )

  await wait(() => smallEval('!!document.querySelector("[data-compact-size]")'), 'shortcut loaded')
  for (const win of [main, compact]) {
    await wait(
      () =>
        evaluate(
          win,
          `Array.from(document.images).some(image => image.src.includes('icon-64') && image.complete && image.naturalWidth === 64)`
        ),
      'brand icon loaded'
    )
  }
  await smallEval(
    `window.originalComposer = document.querySelector('[aria-label="Message Sophon"]')`
  )
  await type(compact, 'Keep my draft')
  compact.webContents.send('compact:shown', { mode: 'command', token: 40 })
  await delay(150)
  assert(
    await smallEval(
      `window.originalComposer === document.querySelector('[aria-label="Message Sophon"]') && window.originalComposer.value === 'Keep my draft'`
    ),
    'Reopening shortcut preserves composer and draft'
  )
  assert.equal(
    await smallEval(
      `getComputedStyle(document.querySelector('[data-compact-size]')).animationName`
    ),
    'none'
  )
  await click(compact, '[aria-label="Coding mode"]')
  await wait(() => smallEval('!!document.querySelector("[role=listbox]")'), 'coding options')
  assert.equal(
    await smallEval(
      `document.querySelector('[role="listbox"]').querySelectorAll('[role="option"]').length`
    ),
    2
  )
  assert(
    !(await smallEval(
      `document.querySelector('[role="listbox"]').textContent.includes('Commands and deletions')`
    ))
  )
  compact.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  compact.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await delay(100)

  for (const withCard of [false, true, false]) {
    if (withCard) await click(compact, '[aria-label="Show GitHub context"]')
    else if (await smallEval(`!!document.querySelector('[aria-label="Hide GitHub context"]')`))
      await click(compact, '[aria-label="Hide GitHub context"]')
    await delay(150)
    const previousHeight = compact.getBounds().height
    await click(compact, '[aria-label="Context and usage"]')
    await wait(() => compact.getBounds().height >= 640, 'dialog gets native height')
    await compact.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(250)
    const dialogLayout = await smallEval(`(() => {
      const popup = document.querySelector('[role="dialog"]').getBoundingClientRect();
      const command = document.querySelector('[data-compact-size]').getBoundingClientRect();
      const viewport = document.querySelector('[role="dialog"] [data-slot="scroll-area-viewport"]');
        const element = document.querySelector('[role="dialog"]');
        const style = getComputedStyle(element);
        return {delta: Math.abs(popup.left + popup.width / 2 - command.left - command.width / 2), top: popup.top, bottom: popup.bottom, popupHeight: popup.height, height: innerHeight, maxHeight: style.maxHeight, cssHeight: style.height, scroll: viewport.scrollTop, vv: visualViewport.height};
    })()`)
    assert(dialogLayout.delta < 2, 'Dialog centers over the command panel with and without GitHub')
    assert(dialogLayout.top >= 0 && dialogLayout.bottom <= dialogLayout.height)
    assert(
      dialogLayout.popupHeight >= 480,
      'Context dialog fills the expanded viewport without needing to reopen: ' +
        JSON.stringify(dialogLayout)
    )
    assert.equal(dialogLayout.scroll, 0, 'Context dialog opens from its beginning')
    await capture(compact, withCard ? 'context-with-repository' : 'context-centered')
    await click(compact, '[aria-label="Close context and usage"]')
    await wait(
      () => compact.getBounds().height === previousHeight,
      'shortcut shrinks after closing dialog'
    )
  }
  await click(compact, '[aria-label="Take screenshot"]')
  await wait(
    () => smallEval('document.body.textContent.includes("Bring that window to the foreground")'),
    'actionable screenshot error'
  )
  assert(!(await smallEval('document.body.textContent.includes("Error invoking remote method")')))
  assert(BrowserWindow.getAllWindows().every((window) => !window.isVisible()))
  console.log(
    'PASS centered welcome, docking without remount, shortcut reopening, dialog size/position/scroll, coding choices and actionable capture errors'
  )
}
main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
