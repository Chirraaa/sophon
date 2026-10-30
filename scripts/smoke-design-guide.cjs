const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/design-guide')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let state = {
  chatId: 'design-fixture',
  mode: 'assistant',
  busy: false,
  chats: [{ id: 'design-fixture', title: 'Design a project', updatedAt: Date.now() }],
  items: []
}
const suggestion = {
  id: 'design-offer',
  from: 'agent',
  pending: false,
  actions: [],
  text:
    '```sophon-design-guide\n' +
    JSON.stringify({
      reason: 'Choose colors and typography for your project before we build it.'
    }) +
    '\n```'
}
const sent = []
let rejectSend = false
let hides = 0
let fixtureSettings
let cancelModeChange = false
const modeChanges = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel === 'settings:get') {
      fixtureSettings ??= { ...(await listener(...args)), files: { workspace: root } }
      return fixtureSettings
    }
    if (channel === 'settings:update' && args[1]?.coding) {
      modeChanges.push(args[1].coding.mode)
      if (cancelModeChange)
        return { ok: false, error: 'Mode change cancelled', settings: fixtureSettings }
      fixtureSettings = { ...fixtureSettings, coding: args[1].coding }
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('settings:changed', fixtureSettings)
      return { ok: true, settings: fixtureSettings }
    }
    if (channel === 'session:get') return state
    if (channel === 'agent:send') {
      if (rejectSend) throw new Error('Fixture send failed')
      sent.push(args.slice(1))
      return
    }
    return listener(...args)
  })
const on = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, listener) =>
  on(channel, (...args) => {
    if (channel === 'compact:hide' || channel === 'compact:dismiss') hides++
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  const evaluate = (win, code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error('Renderer evaluation failed: ' + code, { cause: error })
    })
  const click = (win, label) =>
    evaluate(win, `document.querySelector('[aria-label="${label}"]').click()`)
  const choose = (win, label) =>
    evaluate(
      win,
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`
    )
  const preview = (win) =>
    evaluate(
      win,
      `(() => {const p = document.querySelector('[data-design-preview]'); const s = getComputedStyle(p); return {background:s.backgroundColor,font:s.fontFamily,padding:s.padding,radius:s.borderRadius}})()`
    )
  const capture = async (win, name) => {
    assert(
      await evaluate(
        win,
        `(() => { const d = document.querySelector('[role="dialog"]'); return getComputedStyle(d).opacity === '1' && d.getAnimations().length === 0 })()`
      ),
      'Reduced-motion dialog is fully visible without entrance animations'
    )
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(600)
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    )
  }
  for (const win of [main, compact]) {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })

    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await wait(
      () => evaluate(win, `!!document.querySelector('[aria-label="Message Sophon"]')`),
      'composer'
    )
    assert.equal(
      await evaluate(win, `!!document.querySelector('[aria-label="Open design guide"]')`),
      false,
      'No permanent design guide control'
    )
  }
  state = { ...state, items: [suggestion] }
  for (const win of [main, compact]) win.webContents.send('session:update', state)
  await wait(
    () =>
      evaluate(main, `!!document.querySelector('[aria-label="Open design guide"]:not(:disabled)')`),
    'contextual suggestion'
  )
  await click(main, 'Open design guide')
  await wait(
    () => evaluate(main, '!!document.querySelector("[data-design-preview]")'),
    'main guide'
  )
  const initial = await preview(main)
  assert(
    await evaluate(main, `!!document.querySelector('[role="dialog"] [data-slot="textarea"]')`),
    'Guide notes use the shared shadcn textarea'
  )
  assert(
    await evaluate(
      main,
      `!document.querySelector('[role="dialog"] button:not([data-slot="button"])')`
    ),
    'Guide buttons use the shared shadcn button'
  )
  await choose(main, 'Warm earth')
  await choose(main, 'Editorial serif')
  await choose(main, 'Dark')
  await choose(main, 'Crisp & sharp')
  await choose(main, 'Compact')
  const changed = await preview(main)
  assert.notEqual(changed.background, initial.background)
  assert(changed.font.includes('Georgia'))
  assert.equal(changed.padding, '14px')
  assert.equal(changed.radius, '3px')
  assert.deepEqual(
    await evaluate(
      main,
      `(() => { const s = getComputedStyle(document.querySelector('[data-design-preview] button')); return [s.backgroundColor, s.borderRadius] })()`
    ),
    ['rgb(154, 52, 18)', '3px'],
    'Preview button follows the selected accent and corners'
  )
  await choose(main, 'Try this button')
  await wait(
    () => evaluate(main, 'document.body.innerText.includes("Added to your workspace")'),
    'preview interaction'
  )
  await capture(main, 'full-app')
  await choose(main, 'Attach design brief')
  await wait(
    () => evaluate(compact, 'document.body.innerText.includes("Design brief attached")'),
    'brief shared with shortcut'
  )
  await click(compact, 'Open design guide')
  await wait(
    () => evaluate(compact, '!!document.querySelector("[data-compact-size=expanded]")'),
    'shortcut expands'
  )
  await wait(async () => compact.getSize()[0] >= 900, 'native shortcut width')
  assert.deepEqual(await preview(compact), changed)
  assert(
    await evaluate(
      compact,
      `(() => { const d = document.querySelector('[role="dialog"]').getBoundingClientRect(); return d.top >= 0 && d.bottom <= innerHeight && d.left >= 0 && d.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth })()`
    ),
    'Guide fits shortcut'
  )
  await capture(compact, 'shortcut')

  const displayMatching = screen.getDisplayMatching.bind(screen)
  screen.getDisplayMatching = (bounds) => {
    const display = displayMatching(bounds)
    return { ...display, workArea: { ...display.workArea, width: 680, height: 500 } }
  }
  screen.emit('display-metrics-changed')
  await wait(() => evaluate(compact, 'innerHeight <= 500'), 'short display')
  await delay(300)
  assert(
    await evaluate(
      compact,
      `(() => { const d = document.querySelector('[role="dialog"]'); const b = Array.from(d.querySelectorAll('button')).find(b => b.textContent === 'Attach design brief').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight })()`
    ),
    'Attach remains visible on short displays'
  )
  const beforeEscape = hides
  compact.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  compact.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait(
    () => evaluate(compact, '!document.querySelector("[role=dialog]")'),
    'Escape closes guide'
  )
  assert.equal(hides, beforeEscape, 'Escape does not hide shortcut while closing guide')
  await wait(
    () => evaluate(compact, '!!document.querySelector("[data-compact-size=small]")'),
    'shortcut restores'
  )
  screen.getDisplayMatching = displayMatching
  screen.emit('display-metrics-changed')
  await evaluate(
    compact,
    `(() => { const t = document.querySelector('[aria-label="Message Sophon"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Build my project'); t.dispatchEvent(new Event('input', {bubbles:true})); })()`
  )
  await wait(
    () => evaluate(compact, `!document.querySelector('[aria-label="Send message"]').disabled`),
    'ready to send'
  )
  rejectSend = true
  await click(compact, 'Send message')
  await wait(
    () => evaluate(compact, 'document.body.innerText.includes("Fixture send failed")'),
    'failed send'
  )
  assert(
    await evaluate(
      compact,
      'document.querySelector("textarea").value === "Build my project" && document.body.innerText.includes("Design brief attached")'
    ),
    'Failed send retains draft and brief'
  )
  rejectSend = false
  await click(compact, 'Send message')
  await wait(() => sent.length === 1, 'send with design brief')
  assert(sent[0][0].startsWith('Build my project\n\nDesign guide preferences:'))
  assert(sent[0][0].includes('Warm earth; accent #9a3412'))
  assert(sent[0][0].includes('Editorial serif'))
  assert(
    sent[0][0].includes('reuse its design system and components (including shadcn/ui when present)')
  )
  await wait(
    () => evaluate(main, '!document.body.innerText.includes("Design brief attached")'),
    'successful send clears attachment across views'
  )
  await click(main, 'Open design guide')
  assert.deepEqual(await preview(main), changed, 'Choices persist after sending')
  await click(main, 'Close design guide')
  state = { ...state, chatId: 'another-chat', items: [suggestion] }
  main.webContents.send('session:update', state)
  await delay(200)
  await click(main, 'Open design guide')
  assert.deepEqual(await preview(main), initial, 'New chat has independent preferences')
  await choose(main, 'Ocean blue')
  await click(main, 'Close design guide')
  state = { ...state, chatId: 'design-fixture' }
  main.webContents.send('session:update', state)
  await delay(200)
  await click(main, 'Open design guide')
  assert.deepEqual(await preview(main), changed, 'Returning to a chat restores its own preferences')
  state = { ...state, chatId: 'another-chat' }
  await click(compact, 'Open design guide')
  await wait(
    () => evaluate(compact, '!!document.querySelector("[data-compact-size=expanded]")'),
    'reopen guide'
  )
  compact.webContents.send('session:update', state)
  await wait(
    () =>
      evaluate(
        compact,
        '!document.querySelector("[role=dialog]") && !!document.querySelector("[data-compact-size=small]")'
      ),
    'chat switch releases guide expansion'
  )
  assert.equal(main.isVisible(), false)
  assert.equal(compact.isVisible(), false)
  main.webContents.send('session:update', state)
  await delay(200)
  await click(main, 'Open design guide')
  await choose(main, 'Customize the whole palette')
  const setInput = async (label, value) => {
    await evaluate(
      main,
      `(() => { const input = document.querySelector('[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
  }
  await setInput('Background hex', '#202030')
  await setInput('Surface hex', '#303040')
  await setInput('Text hex', '#ffffff')
  await setInput('Secondary hex', '#ff8800')
  await setInput('Custom font family', 'Arial, sans-serif')
  await choose(main, 'Elevated')
  await choose(main, 'Extra rounded')
  assert.equal((await preview(main)).background, 'rgb(32, 32, 48)')
  assert.equal((await preview(main)).radius, '28px')
  assert((await preview(main)).font.includes('Arial'))
  await setInput('Background hex', '#oops')
  assert.equal(
    (await preview(main)).background,
    'rgb(32, 32, 48)',
    'Invalid hex leaves the valid palette intact'
  )
  assert.equal(
    await evaluate(
      main,
      `document.querySelector('[aria-label="Background hex"]').getAttribute('aria-invalid')`
    ),
    'true'
  )
  await setInput('Background hex', '#202030')
  await setInput('Text hex', '#202030')
  assert(
    await evaluate(main, `document.body.innerText.includes('Below 4.5:1')`),
    'Low contrast is explained'
  )
  await setInput('Text hex', '#ffffff')
  await capture(main, 'custom-palette')
  await choose(main, 'Attach design brief')
  assert.equal(
    await evaluate(main, `document.querySelector('[aria-label="Message Sophon"]').value`),
    'Continue the previous task; use this design direction.'
  )
  await click(main, 'Send message')
  await wait(() => sent.length === 2, 'custom brief sent')
  for (const token of [
    'Custom palette',
    '#202030',
    '#303040',
    '#ffffff',
    '#ff8800',
    'Arial, sans-serif',
    'elevated',
    'round'
  ])
    assert(sent[1][0].includes(token), token)
  const selectMode = async (value) => {
    await click(main, 'Coding mode')
    await wait(() => evaluate(main, `!!document.querySelector('[role="option"]')`), 'mode choices')
    await evaluate(
      main,
      `Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent.trim() === ${JSON.stringify(value)}).click()`
    )
  }
  cancelModeChange = true
  await selectMode('Auto')
  await wait(
    () => evaluate(main, `document.body.innerText.includes('Mode change cancelled')`),
    'cancelled mode change'
  )
  assert.equal(fixtureSettings.coding.mode, 'ask-before-edit')
  cancelModeChange = false
  await selectMode('Auto')
  await wait(
    () =>
      evaluate(
        compact,
        `document.querySelector('[aria-label="Coding mode"]').textContent.includes('Auto')`
      ),
    'mode shared with shortcut'
  )
  await selectMode('Ask before edit')
  await wait(
    () =>
      evaluate(
        compact,
        `document.querySelector('[aria-label="Coding mode"]').textContent.includes('Ask before edit')`
      ),
    'strict mode shared'
  )
  assert.deepEqual(modeChanges, ['auto', 'auto', 'ask-before-edit'])
  state = { ...state, busy: true }
  main.webContents.send('session:update', state)
  await wait(
    () => evaluate(main, `document.querySelector('[aria-label="Coding mode"]').disabled`),
    'mode locked during run'
  )
  console.log(
    'PASS design guide: live styles, sample interaction, cross-window preferences, attached brief, send recovery, per-chat isolation, shortcut resizing, short displays and Escape. Screenshots: ' +
      output
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
