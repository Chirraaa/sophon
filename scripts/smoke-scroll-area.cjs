const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/scroll-review')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
const state = {
  chatId: 'scroll-fixture',
  mode: 'assistant',
  busy: false,
  chats: Array.from({ length: 50 }, (_, n) => ({
    id: n ? `chat-${n}` : 'scroll-fixture',
    title: `Conversation ${n}`,
    updatedAt: Date.now() - n
  })),
  items: [
    {
      id: 'attachment-prompt',
      from: 'you',
      pending: false,
      actions: [],
      text: 'Read this note.',
      attachments: [
        { id: 'scroll-note', name: 'scroll-note.txt', mimeType: 'text/plain', size: 24 }
      ]
    },
    {
      id: 'reply',
      from: 'agent',
      pending: false,
      actions: [],
      text:
        '```text\n' +
        Array.from({ length: 80 }, (_, n) => `${n}: ${'wide code '.repeat(40)}`).join('\n') +
        '\n```\n\n$$x^2 + y^2 = z^2$$'
    }
  ]
}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) =>
    channel === 'session:get'
      ? state
      : channel === 'attachments:preview'
        ? { text: 'Attachment preview fixture' }
        : listener(...args)
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
async function wait(check, label) {
  const until = Date.now() + 12000
  while (Date.now() < until) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  main.webContents.setBackgroundThrottling(false)
  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  await wait(() => evaluate('!!document.querySelector("[data-code-block] pre")'), 'code fixture')
  await evaluate('window.api.updateSettings({motion:"reduced"})')
  await evaluate(`document.querySelector('[data-code-block]').scrollIntoView({block:'start'})`)
  assert(
    await evaluate(`(() => {
    const pre = document.querySelector('[data-code-block] pre');
    const area = pre.closest('[data-slot="scroll-area"]');
    const viewport = pre.closest('[data-slot="scroll-area-viewport"]');
    return area.clientHeight <= 512 && viewport.scrollHeight > viewport.clientHeight && viewport.scrollWidth > viewport.clientWidth && getComputedStyle(viewport).scrollbarWidth === 'none' && area.querySelectorAll('[data-slot="scroll-area-scrollbar"]').length === 2;
  })()`),
    'code has capped height and shadcn scrollbars on both axes'
  )
  await evaluate(
    `document.querySelector('[data-code-block] [data-slot="scroll-area-viewport"]').focus()`
  )
  main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PageDown' })
  main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'PageDown' })
  await wait(
    () =>
      evaluate(
        `document.querySelector('[data-code-block] [data-slot="scroll-area-viewport"]').scrollTop > 0`
      ),
    'keyboard scroll'
  )
  await evaluate(`(() => {
    const viewport = document.querySelector('[data-code-block] [data-slot="scroll-area-viewport"]');
    viewport.scrollLeft = 400;
  })()`)
  assert(
    await evaluate(
      `document.querySelector('[data-code-block] [data-slot="scroll-area-viewport"]').scrollLeft > 0`
    ),
    'horizontal scroll'
  )
  const track = await evaluate(
    `document.querySelector('[data-code-block] [data-orientation="vertical"]').getBoundingClientRect().toJSON()`
  )
  main.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(track.x + track.width / 2),
    y: Math.round(track.y + 40)
  })
  await delay(200)
  fs.writeFileSync(
    path.join(output, 'code-scrollbars.png'),
    (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
  )
  const thumbBefore = await evaluate(
    `document.querySelector('[data-code-block] [data-orientation="vertical"] [data-slot="scroll-area-thumb"]').offsetHeight`
  )
  await evaluate(
    `document.querySelector('[data-code-block] pre').append(document.createTextNode('\\n' + 'growing output\\n'.repeat(200)))`
  )
  await wait(
    () =>
      evaluate(
        `document.querySelector('[data-code-block] [data-orientation="vertical"] [data-slot="scroll-area-thumb"]').offsetHeight < ${thumbBefore}`
      ),
    'thumb responds to growing content'
  )
  await evaluate(`(() => {
    const textarea = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Long draft\\n'.repeat(60));
    textarea.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await wait(
    () => evaluate(`document.querySelector('textarea').offsetHeight > 140`),
    'composer grows inside scroll area'
  )
  assert(
    await evaluate(`(() => {
    const textarea = document.querySelector('textarea');
    const viewport = textarea.closest('[data-slot="scroll-area-viewport"]');
    return viewport.clientHeight <= 140 && viewport.scrollHeight > viewport.clientHeight && getComputedStyle(textarea).overflowY === 'hidden';
  })()`),
    'composer uses shadcn scrolling'
  )
  await evaluate(
    `{ const textarea = document.querySelector('textarea'); textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); }`
  )
  await main.webContents.insertText('Draft tail')
  await wait(
    () =>
      evaluate(
        `(() => { const viewport = document.querySelector('textarea').closest('[data-slot="scroll-area-viewport"]'); return viewport.scrollTop > 0; })()`
      ),
    'typing keeps the composer caret in view'
  )
  main.setSize(780, 650)
  await delay(250)
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no page overflow')
  await evaluate(
    `{ const trigger = document.querySelector('[aria-label="Preview scroll-note.txt"]'); trigger.focus(); trigger.click() }`
  )
  await wait(
    () =>
      evaluate(
        `document.querySelector('[role="dialog"]')?.textContent.includes('Attachment preview fixture')`
      ),
    'attachment uses shared dialog'
  )
  await wait(
    () => evaluate(`document.activeElement.getAttribute('aria-label') === 'Close preview'`),
    'attachment starts with close action focused'
  )
  main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait(
    () =>
      evaluate(
        `!document.querySelector('[role="dialog"]') && document.activeElement.getAttribute('aria-label') === 'Preview scroll-note.txt'`
      ),
    'attachment Escape and focus return'
  )
  await evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
  await wait(
    () => evaluate('!!document.querySelector("[data-slot=select-trigger]")'),
    'settings select'
  )
  await evaluate(
    `{ const trigger = document.querySelector('[data-slot="select-trigger"]'); trigger.focus(); trigger.click() }`
  )
  await wait(() => evaluate('!!document.querySelector("[role=listbox]")'), 'select open')
  assert(
    await evaluate(
      `document.querySelector('[role="listbox"]').matches('[data-slot="scroll-area-viewport"]')`
    ),
    'select list is the scroll viewport'
  )
  main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' })
  main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' })
  await delay(100)
  main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait(
    () =>
      evaluate(
        `document.querySelector('[data-slot="select-trigger"]').getAttribute('aria-expanded') === 'false' && document.activeElement.matches('[data-slot="select-trigger"]')`
      ),
    'select keyboard dismissal and restored focus'
  )
  assert.deepEqual(errors, [])
  assert.equal(main.isVisible(), false)
  console.log(
    'PASS shadcn scroll areas: capped code, both axes, keyboard scrolling, growing-content thumb, long composer, narrow layout and select keyboard navigation; hidden isolated profile'
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
