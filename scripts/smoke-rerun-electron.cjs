const { app, BrowserWindow, globalShortcut } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache', 'rerun-live', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'profile'))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
const requests = []
const request = http.request
http.request = function (url, ...args) {
  const result = request.call(this, url, ...args)
  if (url.pathname.endsWith('/chat/completions')) {
    const end = result.end
    result.end = function (body, ...rest) {
      requests.push(JSON.parse(body))
      return end.call(this, body, ...rest)
    }
  }
  return result
}
require(path.join(root, 'out/main/index.js'))
async function wait(check, label, timeout = 120000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}
async function main() {
  const models = await fetch('http://127.0.0.1:1234/api/v0/models').then((r) => r.json())
  const model = models.data.find((entry) => entry.state === 'loaded' && entry.type !== 'embeddings')
  assert(model, 'Load a local model before running this test')
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().some((win) => win.isResizable()), 'app window')
  const win = BrowserWindow.getAllWindows().find((entry) => entry.isResizable())
  win.webContents.setBackgroundThrottling(false)
  const evaluate = (code) => win.webContents.executeJavaScript(code, true)
  await wait(() => evaluate('!!window.api && !!document.querySelector("textarea")'), 'renderer')
  const settings = await evaluate(
    `window.api.updateSettings(${JSON.stringify({
      model: { modelId: model.id, maxTokens: 512, specialists: false, thinking: false },
      memory: { enabled: false }
    })})`
  )
  assert(settings.ok)
  const state = () => evaluate('window.api.getSession()')
  const replies = []
  const send = async (text) => {
    await evaluate(`window.api.send(${JSON.stringify(text)})`)
    const next = await state()
    assert(!next.busy)
    assert.doesNotMatch(next.items.at(-1).text, /^Error:/)
    assert(next.items.at(-1).text.length)
    replies.push(next.items.at(-1).text)
    return next
  }
  const first = await send('For this conversation the code word is ORCHID. Reply with ORCHID only.')
  const prompt = 'What is the code word? Reply with the word only.'
  const second = await send(prompt)
  await send('A later message has the marker FUTURE_73921. Reply OK only.')
  const before = requests.length
  const oldReplyId = second.items[3].id
  await evaluate(`document.querySelectorAll('button[aria-label="Rerun prompt"]')[1].click()`)
  await wait(async () => {
    const next = await state()
    return !next.busy && next.items.length === 4 && next.items[3].id !== oldReplyId
  }, 'rerun response')
  const regenerated = await state()
  assert.equal(regenerated.chatId, first.chatId)
  assert.equal(regenerated.chats.length, first.chats.length)
  assert.equal(regenerated.items[2].id, second.items[2].id)
  assert.deepEqual(regenerated.items.slice(0, 2), first.items)
  assert.match(regenerated.items[3].text, /ORCHID/i)
  assert.equal(requests.length, before + 1, 'Exactly one model request per simple rerun')
  const payload = JSON.stringify(requests.at(-1).messages)
  assert(!payload.includes('FUTURE_73921'), 'Later messages must not enter model context')
  assert.equal(
    requests.at(-1).messages.filter((m) => m.role === 'user' && m.content === prompt).length,
    1
  )
  console.log(
    'PASS live rerun: one chat, stable prompt, preserved prefix, one request, no future context'
  )

  await evaluate(`document.querySelector('button[aria-label="Edit prompt"]').click()`)
  await wait(
    () => evaluate(`!!document.querySelector('textarea[aria-label="Edit prompt"]')`),
    'editor'
  )
  const edited = 'Reply with exactly COBALT. No other text.'
  await evaluate(`(() => {
    const input = document.querySelector('textarea[aria-label="Edit prompt"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(edited)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await delay(100)
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save and rerun').click()`
  )
  await wait(async () => {
    const next = await state()
    return !next.busy && next.items.length === 2 && next.items[0].text === edited
  }, 'edited response')
  const editedState = await state()
  assert.equal(editedState.chatId, first.chatId)
  assert.equal(editedState.items[0].id, first.items[0].id)
  assert.match(editedState.items[1].text, /COBALT/i)
  assert(!JSON.stringify(requests.at(-1).messages).includes('ORCHID'))
  await wait(
    () => evaluate(`!document.querySelector('button[aria-label="Rerun prompt"]').disabled`),
    'rerun enabled'
  )
  await evaluate(`document.querySelector('button[aria-label="Rerun prompt"]').click()`)
  await wait(async () => {
    const next = await state()
    return !next.busy && next.items[1].id !== editedState.items[1].id
  }, 'repeat rerun')
  const final = await state()
  assert.equal(final.chats.length, first.chats.length)
  assert.equal(final.items.length, 2)
  assert.match(final.items[1].text, /COBALT/i)
  assert.equal(final.chats[0].title, first.chats[0].title)
  await wait(
    () =>
      evaluate(`document.querySelectorAll('button[aria-label="Rerun prompt"]').length === 1 &&
      !document.querySelector('button[aria-label="Rerun prompt"]').disabled &&
      document.body.innerText.includes('COBALT') &&
      !document.body.innerText.includes('What is the code word?')`),
    'final rendered conversation'
  )
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify({ model: model.id, requests, replies, final }, null, 2)
  )
  console.log('PASS live edit and repeat rerun; evidence: ' + output)
}
main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    fs.writeFileSync(
      path.join(output, 'failure.json'),
      JSON.stringify({ error: String(error.stack), requests }, null, 2)
    )
    app.exit(1)
  })
