const { app, BrowserWindow, globalShortcut, dialog, ipcMain, clipboard } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/popup-review')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)

if (!process.env.ELECTRON_ENTRY) delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let nativePrompts = 0
dialog.showMessageBox = async () => {
  nativePrompts++
  return { response: 0 }
}

const http = require('node:http')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const originalRequest = http.request
let releaseReply
let held = false
let replyContent = 'BACKGROUND_REPLY_COMPLETE'
let streamingFixture = false
let finishStream
let visualCreates = 0
http.request = (url, options, callback) => {
  if (!held || !url.pathname.endsWith('/chat/completions'))
    return originalRequest(url, options, callback)
  const request = new EventEmitter()
  request.end = (body) => {
    if (streamingFixture) assert.equal(JSON.parse(body).stream, true)
    releaseReply = () => {
      const response = new PassThrough()
      response.statusCode = 200
      response.headers = {
        'content-type': streamingFixture ? 'text/event-stream' : 'application/json'
      }
      callback(response)
      if (streamingFixture) {
        const chunk = (content, finish_reason = null) =>
          'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason }] }) + '\n\n'
        const first = Buffer.from(chunk('A streamed response '))
        response.write(first.subarray(0, 9))
        response.write(first.subarray(9))
        finishStream = () => {
          response.write(chunk('arrives before completion.'))
          response.end(chunk('', 'stop') + 'data: [DONE]\n\n')
        }
        return
      }
      response.end(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: replyContent },
              finish_reason: 'stop'
            }
          ]
        })
      )
    }
    options.signal.addEventListener('abort', () => request.emit('error', new Error('Aborted')), {
      once: true
    })
  }
  request.destroy = (error) => {
    if (error) request.emit('error', error)
    return request
  }
  return request
}

let rejectDeletion = false
let deleteCalls = 0
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel === 'visuals:create') visualCreates++
    if (channel === 'chats:delete') {
      deleteCalls++
      await delay(350)
      if (rejectDeletion) throw new Error('Deletion test failure. Please retry.')
    }
    return listener(...args)
  })
const errors = []
app.on('web-contents-created', (_, contents) => {
  contents.on('render-process-gone', (_, details) => errors.push(details))
  contents.on('console-message', (details) => {
    if (
      details.message.startsWith("Loading the font 'data:") &&
      details.message.includes('Content Security Policy')
    )
      return
    if (details.level === 'error') errors.push(details.message)
  })
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
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'app windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  main.webContents.setBackgroundThrottling(false)

  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  const evaluate = (code) =>
    main.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Evaluation failed:', code, errors)
      throw error
    })
  const key = (keyCode, modifiers = []) => {
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const click = (selector) =>
    evaluate(
      `{ const button = document.querySelector(${JSON.stringify(selector)}); button.focus(); button.click() }`
    )
  const capture = async (name) => {
    await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(200)
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    )
  }
  const opened = () =>
    wait(() => evaluate('!!document.querySelector("[role=alertdialog]")'), 'dialog open')
  const closed = () =>
    wait(() => evaluate('!document.querySelector("[role=alertdialog]")'), 'dialog close')
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'app ready')

  const attachmentButton = '[aria-label="Attach images or text files"]'
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(attachmentButton)}).hasAttribute('title')`
    ),
    false
  )
  await evaluate('document.querySelector("textarea").focus()')
  key('Tab')
  await wait(
    () =>
      evaluate(
        'document.querySelector("[data-slot=tooltip-content]")?.textContent === "Attach images or text files"'
      ),
    'keyboard tooltip'
  )
  key('Escape')
  await wait(
    () => evaluate('!document.querySelector("[data-slot=tooltip-content]")'),
    'tooltip dismissal'
  )
  await evaluate('document.querySelector("textarea").focus()')
  await evaluate('window.api.updateSettings({motion:"reduced"})')
  const original = await evaluate('window.api.getSession()')
  main.webContents.send('session:update', {
    ...original,
    items: [
      {
        id: 'hint-regression',
        from: 'agent',
        text: 'File inspected.',
        actions: [
          {
            id: 'file-hint',
            name: 'read_file',
            label: 'Read files and pictures',
            status: 'done',
            detail: JSON.stringify({
              sourceId: 'internal-source',
              trust: 'untrusted-data',
              content: '<main>Private file contents</main>'
            })
          }
        ]
      }
    ]
  })
  await wait(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("[data-slot=collapsible-trigger]")).some(n => n.textContent.includes("Actions (1)"))'
      ),
    'action history fixture'
  )
  await evaluate(
    'Array.from(document.querySelectorAll("[data-slot=collapsible-trigger]")).find(n => n.textContent.includes("Actions (1)")).click()'
  )
  const chip = '[aria-label="Read files and pictures · Complete"]'
  await wait(
    () => evaluate(`!!document.querySelector(${JSON.stringify(chip)})`),
    'readable action chip'
  )
  await evaluate(`document.querySelector(${JSON.stringify(chip)}).focus()`)
  await wait(
    () =>
      evaluate(
        'document.querySelector("[data-slot=tooltip-content]")?.textContent === "Read files and pictures · Complete"'
      ),
    'readable action hint'
  )
  assert.equal(
    await evaluate(
      'document.body.innerText.includes("internal-source") || document.body.innerText.includes("Private file contents")'
    ),
    false
  )
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(chip)}).hasAttribute('title')`),
    false
  )
  await capture('readable-action-hint')
  key('Escape')
  main.webContents.send('session:update', original)
  if (process.argv.includes('--hints-only')) {
    assert.deepEqual(errors, [])
    console.log(
      'PASS keyboard hints, Escape dismissal, readable file-action tooltip, and hidden raw payload; hidden isolated profile'
    )
    return
  }
  await evaluate('window.api.chats.create()')
  const selected = await evaluate('window.api.getSession()')
  const name = 'Popup review conversation'
  await evaluate(
    `window.api.chats.rename(${JSON.stringify(selected.chatId)}, ${JSON.stringify(name)})`
  )
  const trigger = '[aria-label="Delete ' + name + '"]'
  await wait(() => evaluate(`!!document.querySelector(${JSON.stringify(trigger)})`), 'chat row')
  await click(trigger)
  await opened()
  await wait(
    () => evaluate('document.activeElement.textContent === "Keep chat"'),
    'initial cancel focus'
  )
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("[role=alertdialog]")).backgroundColor'
    ),
    'rgb(32, 32, 35)'
  )
  assert(
    (await evaluate('document.querySelector("[role=alertdialog]").textContent')).includes(name)
  )
  await capture('delete-chat')
  const placement = await evaluate(`(() => {
    const popup = document.querySelector('[role=alertdialog]').getBoundingClientRect();
    const trigger = document.querySelector(${JSON.stringify(trigger)}).getBoundingClientRect();
    return { bottom: popup.bottom, top: popup.top, triggerTop: trigger.top, right: popup.right, triggerRight: trigger.right };
  })()`)

  assert(placement.bottom <= placement.triggerTop || placement.top < 20, JSON.stringify(placement))
  assert(
    Math.abs(placement.right - placement.triggerRight) < 120,
    'Popup must stay beside its trash icon'
  )
  key('Tab')
  await wait(
    () => evaluate('document.activeElement.textContent === "Delete chat"'),
    'tab to delete'
  )
  key('Tab')
  await wait(() => evaluate('document.activeElement.textContent === "Keep chat"'), 'focus trap')
  key('Escape')
  await closed()
  assert.equal(
    await evaluate('document.activeElement.getAttribute("aria-label")'),
    'Delete ' + name
  )
  assert.equal(deleteCalls, 0)
  await click(trigger)
  await opened()
  await click('[data-slot=alert-dialog-cancel]')
  await closed()
  assert.equal((await evaluate('window.api.getSession()')).chats.length, original.chats.length + 1)
  assert.equal(deleteCalls, 0)

  rejectDeletion = true
  await click(trigger)
  await opened()
  await evaluate(
    '{ const button = document.querySelector("[data-slot=alert-dialog-action]"); button.click(); button.click() }'
  )
  await wait(
    () =>
      evaluate('document.querySelector("[role=alertdialog]").getAttribute("aria-busy") === "true"'),
    'pending state'
  )
  key('Escape')
  assert(await evaluate('!!document.querySelector("[role=alertdialog]")'))
  await wait(
    () =>
      evaluate(
        'document.querySelector("[role=alertdialog] [role=alert]")?.textContent.includes("Deletion test failure")'
      ),
    'inline error'
  )
  assert.equal(deleteCalls, 1)
  await capture('delete-error')
  rejectDeletion = false
  await click('[data-slot=alert-dialog-action]')
  await closed()
  assert.equal(deleteCalls, 2)
  assert.equal((await evaluate('window.api.getSession()')).chats.length, original.chats.length)
  assert.equal(nativePrompts, 0, 'Routine deletion must not show a native message box')

  assert.equal(await evaluate('!!document.querySelector(\'[aria-label="Task mode"]\')'), false)

  const permissions = await evaluate('window.api.getSettings()')
  const grant = { tools: { list_windows: 'allow' } }
  const windowCount = BrowserWindow.getAllWindows().length
  await evaluate(
    'Array.from(document.querySelectorAll("nav button")).find(b => b.textContent === "Settings").click()'
  )
  await wait(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll("[role=tab]")).find(b => b.textContent === "Permissions")'
      ),
    'settings tabs'
  )
  await evaluate(
    'Array.from(document.querySelectorAll("[role=tab]")).find(b => b.textContent === "Permissions").click()'
  )
  const beginGrant = async () => {
    await evaluate(
      `window.__grantResult = null; void window.api.updateSettings(${JSON.stringify(grant)}).then(result => window.__grantResult = result)`
    )
    await opened()
    assert.equal(
      BrowserWindow.getAllWindows().length,
      windowCount,
      'Permission review must not create another window'
    )
  }
  await beginGrant()
  const staleDecision = await evaluate(
    "window.api.consent.resolve('00000000-0000-4000-8000-000000000000', true).then(() => 'accepted', error => error.message)"
  )
  assert.match(staleDecision, /Invalid or stale/)
  assert(await evaluate('!!document.querySelector("[data-slot=alert-dialog-content]")'))
  assert(
    (await evaluate('document.querySelector("[role=alertdialog]").textContent')).includes(
      'List windows'
    )
  )
  assert.equal(
    (await evaluate('window.api.getSettings()')).tools.list_windows,
    permissions.tools.list_windows
  )
  await wait(
    () => evaluate('document.activeElement.textContent === "Cancel"'),
    'initial permission cancel focus'
  )
  key('Escape')
  await closed()
  await wait(() => evaluate('window.__grantResult !== null'), 'cancelled settings result')
  assert.equal((await evaluate('window.__grantResult')).ok, false)
  assert.equal(
    (await evaluate('window.api.getSettings()')).tools.list_windows,
    permissions.tools.list_windows
  )
  await beginGrant()
  await capture('always-allow')
  await click('button[value=allow]')
  await closed()
  await wait(() => evaluate('window.__grantResult !== null'), 'saved settings result')
  assert.equal((await evaluate('window.__grantResult')).ok, true)
  assert.equal(nativePrompts, 0, 'Always allow stays inside the app')
  assert.equal((await evaluate('window.api.getSettings()')).tools.list_windows, 'allow')
  await evaluate(
    'Array.from(document.querySelectorAll("nav button")).find(b => b.textContent === "Assistant").click()'
  )

  await evaluate('window.api.updateSettings({model:{modelId:"background-fixture"}})')

  held = true
  replyContent =
    '```html\n<!doctype html><html><head><title>Approval fixture</title></head><body><h1>Ready</h1></body></html>\n```'
  await evaluate('void window.api.send("visual approval fixture")')
  await wait(() => !!releaseReply, 'visual response')
  releaseReply()
  await wait(() => evaluate('window.api.getSession().then(s => !s.busy)'), 'visual reply completes')
  const runVisual = () =>
    evaluate(
      'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Run visual").click()'
    )
  await runVisual()
  await opened()
  assert.equal(visualCreates, 1, 'One click sends exactly one visual request')
  for (const width of [1000, 360]) {
    await main.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false
    })
    await delay(100)
    assert(
      await evaluate(`(() => {
      const dialog = document.querySelector('[role=alertdialog]')
      const rect = dialog.getBoundingClientRect()
      return dialog.scrollWidth <= dialog.clientWidth + 1 &&
        Array.from(dialog.querySelectorAll('button')).every(button => {
          const bounds = button.getBoundingClientRect()
          return bounds.left >= rect.left && bounds.right <= rect.right &&
            bounds.top >= rect.top && bounds.bottom <= rect.bottom
        })
    })()`),
      'Permission text and buttons must fit at width ' + width
    )
    await capture('visual-approval-' + width)
  }
  await main.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  await click('button[value=cancel]')
  await closed()
  await wait(
    () => evaluate('document.body.innerText.includes("Untrusted visual code")'),
    'visual retry after cancel'
  )
  assert.equal(await evaluate('!!document.querySelector("iframe")'), false)
  assert.equal(
    await evaluate('document.body.innerText.includes("This visual needs a correction")'),
    false
  )
  assert.equal(await evaluate('document.body.innerText.includes("Stop visual")'), false)
  await runVisual()
  await opened()
  assert.equal(visualCreates, 2, 'Retry sends exactly one visual request')

  assert.equal(await evaluate('window.api.visuals.create("<p>Concurrent</p>")'), null)
  await click('button[value=allow]')
  await closed()
  await wait(() => evaluate('!!document.querySelector("iframe")'), 'approved visual iframe')
  await wait(
    () => main.webContents.mainFrame.frames.some((frame) => frame.url.startsWith('sophon-visual:')),
    'sandbox frame'
  )
  const visualFrame = main.webContents.mainFrame.frames.find((frame) =>
    frame.url.startsWith('sophon-visual:')
  )
  await wait(
    () => visualFrame.executeJavaScript('document.title === "Approval fixture"'),
    'sandbox document'
  )
  assert.equal(
    await visualFrame.executeJavaScript('typeof window.api + ":" + typeof require'),
    'undefined:undefined'
  )
  await evaluate(
    'Array.from(document.querySelectorAll(\'[aria-label="Copy response"]\')).at(-1).click()'
  )
  await wait(
    () => evaluate('!!document.querySelector(\'[aria-label="Copied"]\')'),
    'copy response feedback'
  )
  assert.equal((await clipboard.readText()).replace(/\r\n/g, '\n'), replyContent)
  await evaluate('document.querySelector(\'[aria-label="Copy visual source"]\').click()')
  await wait(
    async () => (await clipboard.readText()).includes('<title>Approval fixture</title>'),
    'copy visual source'
  )
  streamingFixture = true
  await evaluate('window.api.updateSettings({motion:"full"})')
  await evaluate(`window.__streamLengths = []; window.__streamObserver = new MutationObserver(() => {
    const text = Array.from(document.querySelectorAll('.chat-markdown')).at(-1)?.textContent ?? ''
    if (text.startsWith('A')) window.__streamLengths.push(text.length)
  }); window.__streamObserver.observe(document.body, {subtree:true, childList:true, characterData:true})`)
  releaseReply = null
  await evaluate('void window.api.send("streaming fixture")')
  await wait(() => !!releaseReply, 'stream request')
  releaseReply()
  await wait(
    () =>
      evaluate(
        'window.api.getSession().then(s => s.busy && s.items.at(-1).pending && s.items.at(-1).text === "A streamed response")'
      ),
    'partial reply while model is running'
  )
  await wait(
    () => evaluate('document.body.innerText.includes("A streamed response")'),
    'partial reply displayed'
  )
  finishStream()
  await wait(
    () =>
      evaluate(
        'window.api.getSession().then(s => !s.busy && s.items.at(-1).text === "A streamed response arrives before completion.")'
      ),
    'complete streamed reply'
  )
  await wait(
    () =>
      evaluate(
        'document.body.innerText.includes("A streamed response arrives before completion.")'
      ),
    'smooth reveal catches up'
  )
  assert(
    await evaluate(
      'window.__streamLengths.some(length => length > 0 && length < "A streamed response".length)'
    ),
    'Reply reveals in smaller increments'
  )
  await evaluate(
    'window.__streamObserver.disconnect(); window.api.updateSettings({motion:"reduced"})'
  )

  releaseReply = null
  await evaluate('void window.api.send("stop streaming fixture")')
  await wait(() => !!releaseReply, 'second stream request')
  releaseReply()
  await wait(
    () =>
      evaluate(
        'window.api.getSession().then(s => s.items.at(-1).text.includes("A streamed response"))'
      ),
    'second stream prefix'
  )
  await evaluate('window.api.stop()')
  await wait(
    () =>
      evaluate(
        'window.api.getSession().then(s => !s.busy && s.items.at(-1).text.includes("A streamed response") && s.items.at(-1).text.includes("Stopped."))'
      ),
    'stopped stream preserves partial answer'
  )
  streamingFixture = false
  replyContent = 'BACKGROUND_REPLY_COMPLETE'
  releaseReply = null
  const source = await evaluate('window.api.getSession()')
  held = true
  await evaluate('void window.api.send("background persistence fixture")')
  await wait(() => !!releaseReply, 'held response')
  await evaluate('window.api.chats.create()')
  const other = await evaluate('window.api.getSession()')
  assert.notEqual(other.chatId, source.chatId)
  assert.equal(other.runningChatId, source.chatId)
  assert(other.busy)
  assert.equal(other.items.length, 0)
  await wait(
    () => evaluate('document.body.innerText.includes("Return to request")'),
    'background status'
  )
  await evaluate(`window.api.chats.select(${JSON.stringify(source.chatId)})`)
  assert((await evaluate('window.api.getSession()')).items.at(-1).pending)
  await evaluate(`window.api.chats.select(${JSON.stringify(other.chatId)})`)
  releaseReply()
  await wait(
    () => evaluate('window.api.getSession().then(s => !s.busy)'),
    'background reply completes'
  )
  assert.equal((await evaluate('window.api.getSession()')).items.length, 0)
  await evaluate(`window.api.chats.select(${JSON.stringify(source.chatId)})`)
  assert.equal(
    (await evaluate('window.api.getSession()')).items.at(-1).text,
    'BACKGROUND_REPLY_COMPLETE'
  )

  releaseReply = null
  await evaluate('void window.api.send("stop background fixture")')
  await wait(() => !!releaseReply, 'second held response')
  await evaluate(`window.api.chats.select(${JSON.stringify(other.chatId)})`)
  await evaluate('window.api.stop()')
  await wait(
    () => evaluate('window.api.getSession().then(s => !s.busy)'),
    'explicit background stop'
  )
  await evaluate(`window.api.chats.select(${JSON.stringify(source.chatId)})`)
  assert.match((await evaluate('window.api.getSession()')).items.at(-1).text, /^Stopped/)
  held = false
  const expectedPrompts = nativePrompts
  await evaluate(
    'Array.from(document.querySelectorAll("nav button")).find(b => b.textContent === "Settings").click()'
  )
  await wait(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll("[role=tab]")).find(b => b.textContent === "General")'
      ),
    'general settings tab'
  )
  await evaluate(
    'Array.from(document.querySelectorAll("[role=tab]")).find(b => b.textContent === "General").click()'
  )
  await wait(() => evaluate('document.body.innerText.includes("Reset settings")'), 'settings')
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Reset settings").click()'
  )
  await opened()
  await wait(
    () => evaluate('document.activeElement.textContent === "Keep preferences"'),
    'reset cancel focus'
  )
  await capture('reset-settings')
  await click('[data-slot=alert-dialog-cancel]')
  await closed()
  assert.equal(nativePrompts, expectedPrompts)
  assert.deepEqual(errors, [])
  assert.equal(main.isVisible(), false)
  console.log(
    'PASS popup layout and focus, visual approval/cancel/retry, one request per click, response/source clipboard, live partial replies, stream Stop preservation, background chats and reset cancellation; hidden isolated profile'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
