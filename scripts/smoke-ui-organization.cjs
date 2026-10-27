const { app, BrowserWindow, globalShortcut, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/ui-organization')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
dialog.showMessageBox = async () => ({ response: 1 })
require('./security/consent-fixture.cjs')(app, async () => true)
fs.writeFileSync(
  path.join(app.getPath('userData'), 'settings.json'),
  JSON.stringify({
    motion: 'reduced',
    memory: { enabled: false },
    model: { endpoint: 'http://127.0.0.1:19094/v1', modelId: 'offline-fixture', specialists: false }
  })
)
let titleCalls = 0
require('node:http').request = (url, options, callback) => {
  assert.equal(url.origin, 'http://127.0.0.1:19094')
  const request = new EventEmitter()
  request.end = (body) =>
    queueMicrotask(() => {
      if (options.signal?.aborted) return request.emit('error', new Error('Aborted'))
      const payload = body ? JSON.parse(body) : null
      const title = payload?.messages?.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.includes('Write a short, specific chat title')
      )
      if (title) titleCalls++
      const response = new PassThrough()
      response.statusCode = 200
      response.headers = { 'content-type': 'application/json' }
      callback(response)
      response.end(
        JSON.stringify(
          payload
            ? {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: title
                        ? 'Understanding Rainbow Formation'
                        : 'Rainbows form when sunlight is refracted and reflected by water droplets.'
                    },
                    finish_reason: 'stop'
                  }
                ],
                usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
              }
            : { data: [] }
        )
      )
    })
  request.destroy = (error) => {
    if (error) request.emit('error', error)
    return request
  }
  return request
}
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, _path, error) => errors.push(error.message))
  contents.on('render-process-gone', (_event, details) => errors.push(details.reason))
  contents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes('Content Security Policy'))
      errors.push(details.message)
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
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((window) => window.isResizable())
  main.webContents.setBackgroundThrottling(false)
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  await wait(() => !main.webContents.isLoading(), 'renderer')
  await wait(() => evaluate('!!window.api && !!document.querySelector("nav")'), 'bridge')
  const click = (label) =>
    evaluate(`(() => {
    const button = [...document.querySelectorAll('button, [role=tab]')].find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)} || node.textContent.trim() === ${JSON.stringify(label)})
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)})
    if (button.disabled) throw new Error('Disabled button: ' + ${JSON.stringify(label)})
    button.click()
  })()`)
  const field = (label, value) =>
    evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)})
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const text = (value) => evaluate(`document.body.innerText.includes(${JSON.stringify(value)})`)
  const capture = async (name) => {
    await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    await delay(500)
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    )
  }

  await click('Dismiss shortcut reminder')
  assert.equal(await text('A shortcut to a little help.'), false)
  await click('Collapse sidebar')
  assert(await evaluate(`!!document.querySelector('[aria-label="Expand sidebar"]')`))
  await click('Expand sidebar')
  await evaluate('window.api.send("Explain how a rainbow forms")')
  await wait(() => text('Rainbows form'), 'answer')
  assert.equal(titleCalls, 1)
  assert.equal(
    (await evaluate('window.api.getSession()')).chats[0].title,
    'Understanding Rainbow Formation'
  )
  assert.equal(await text('Context used'), false)
  assert.equal(await text('Task evidence'), false)
  assert.equal(await text('tokens reported'), false)
  await capture('chat-clean')

  await click('New category')
  await field('Category name', 'Learning')
  await click('Add category')
  await wait(() => text('Learning'), 'category')
  let snapshot = await evaluate('window.api.getSession()')
  const first = snapshot.chatId
  const category = snapshot.categories[0].id
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[draggable=true]')].find((node) => node.textContent.includes('Understanding Rainbow Formation'))
    const destination = document.querySelector('section[aria-label=Learning]')
    const transfer = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }))
    destination.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
  })()`)
  await wait(
    async () =>
      (await evaluate('window.api.getSession()')).chats.find((chat) => chat.id === first)
        .categoryId === category,
    'drag to category'
  )
  await click('New chat')
  await evaluate(
    `window.api.chats.rename(${JSON.stringify((await evaluate('window.api.getSession()')).chatId)}, 'Second chat')`
  )
  snapshot = await evaluate('window.api.getSession()')
  const second = snapshot.chatId
  await wait(() => text('Second chat'), 'second chat')
  await click('Organize Second chat')
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="Category for Second chat"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(category)})
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(
    async () =>
      (await evaluate('window.api.getSession()')).chats.find((chat) => chat.id === second)
        .categoryId === category,
    'move without dragging'
  )
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[draggable=true]')]
    const source = rows.find((node) => node.textContent.includes('Second chat'))
    const target = rows.find((node) => node.textContent.includes('Understanding Rainbow Formation'))
    const transfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
  })()`)
  await wait(
    async () =>
      (await evaluate('window.api.getSession()')).chats.filter(
        (chat) => chat.categoryId === category
      )[0].id === second,
    'drag reorder'
  )
  await capture('chat-categories')

  await click('Settings')
  await click('Permissions')
  await wait(() => text('Files & coding'), 'permission categories')
  assert.equal(await text('Edit project files'), false, 'Tool rows start collapsed')
  await field('Search permissions', 'delete')
  await wait(() => text('Delete project files'), 'permission search')
  await capture('permissions-search')
  await click('Clear filters')
  await capture('permissions-overview')

  await click('Memory')
  await wait(() => text('Enable harness and recall'), 'harness enable')
  await click('Enable harness and recall')
  await wait(() => text('Harness and recall enabled'), 'harness enabled feedback')
  assert(
    await evaluate(
      `[...document.querySelectorAll('button')].find((node) => node.textContent === 'Harness and recall enabled').disabled`
    )
  )

  await evaluate(`(() => {
    window.__micCalls = 0; window.__stoppedTracks = 0
    navigator.mediaDevices.getUserMedia = async () => {
      window.__micCalls++
      return { getTracks: () => [{ stop: () => window.__stoppedTracks++ }] }
    }
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Studio Mic' },
      { kind: 'audioinput', deviceId: 'studio', label: 'Studio Mic' }
    ]
  })()`)
  await click('Voice')
  await wait(() => text('System default: Default - Studio Mic'), 'automatic default microphone')
  assert.equal(await evaluate('window.__micCalls'), 1)
  assert.equal(await evaluate('window.__stoppedTracks'), 1, 'Detection releases audio tracks')
  await capture('voice-auto-detection')
  await evaluate(
    `void (navigator.mediaDevices.getUserMedia = async () => { throw new Error('Microphone permission denied') })`
  )
  await click('Refresh microphones')
  await wait(() => text('Microphone permission denied'), 'microphone failure feedback')

  await click('General')
  await click('Custom accent color')
  await field('Custom accent color hex', '#1267ab')
  assert.equal(
    (await evaluate('window.api.getSettings()')).accent,
    'violet',
    'Editing does not save'
  )
  await click('Apply color')
  await wait(
    async () => (await evaluate('window.api.getSettings()')).accent === '#1267ab',
    'custom accent persisted'
  )
  assert.equal(
    await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--tint").trim()'),
    '#1267ab'
  )
  await click('Custom screen glow color')
  await field('Custom screen glow color hex', '#123456')
  await click('Cancel')
  assert.equal((await evaluate('window.api.getSettings()')).screenGlow.color, '#a78bfa')
  await evaluate(
    `document.querySelector('[role=switch][aria-labelledby="' + [...document.querySelectorAll('[data-setting-row]')].find((row) => row.textContent.includes('Show response diagnostics')).querySelector('[id]').id + '"]').click()`
  )
  await wait(
    async () => (await evaluate('window.api.getSettings()')).showResponseDiagnostics,
    'advanced diagnostics setting'
  )
  await click('Assistant')
  await evaluate(`window.api.chats.select(${JSON.stringify(first)})`)
  await wait(() => text('Task evidence'), 'advanced evidence visible')
  assert(await text('Context used'))
  assert(await text('tokens reported'))
  await capture('advanced-diagnostics')
  await click('Collapse sidebar')
  main.webContents.reload()
  await wait(() => !main.webContents.isLoading(), 'reload')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Expand sidebar"]')`),
    'collapsed preference restored'
  )
  await click('Expand sidebar')
  assert.equal(await text('A shortcut to a little help.'), false)
  snapshot = await evaluate('window.api.getSession()')
  assert.deepEqual(
    snapshot.chats.filter((chat) => chat.categoryId === category).map((chat) => chat.id),
    [second, first]
  )
  await evaluate(`window.api.chats.deleteCategory(${JSON.stringify(category)})`)
  snapshot = await evaluate('window.api.getSession()')
  assert.equal(snapshot.chats.length, 2)
  assert(snapshot.chats.every((chat) => !chat.categoryId))
  assert.deepEqual(errors, [])
  assert.equal(main.isVisible(), false)
  console.log(
    'PASS real UI: collapsed sidebar, dismissed reminder, generated titles, chat categories/dragging/order, permission search, harness feedback, auto microphone detection, apply/cancel colors, diagnostics and reload persistence'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
