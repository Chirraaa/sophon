const { app, BrowserWindow, globalShortcut, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/memory-review')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
dialog.showMessageBox = async () => ({ response: 1 })

require('./security/consent-fixture.cjs')(
  app,
  async () => (await dialog.showMessageBox(null, {})).response === 1
)
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    motion: 'reduced',
    showResponseDiagnostics: true,
    model: { endpoint: 'http://127.0.0.1:19094/v1', modelId: 'offline-fixture' }
  })
)
let lastRequest
let failNextRequest = false
let fixtureReply = 'Offline harness fixture answer.'
require('node:http').request = (url, options, callback) => {
  assert.equal(url.origin, 'http://127.0.0.1:19094', 'Unexpected outbound destination')
  const request = new EventEmitter()
  request.end = (body) =>
    queueMicrotask(() => {
      if (options.signal?.aborted) return request.emit('error', new Error('Aborted'))
      let data = { data: [] }
      if (body) {
        lastRequest = JSON.parse(body)
        data = {
          choices: [
            {
              message: { role: 'assistant', content: fixtureReply },
              finish_reason: 'stop'
            }
          ]
        }
      }
      const response = new PassThrough()
      response.statusCode = body && failNextRequest ? 503 : 200
      if (body) failNextRequest = false
      response.headers = { 'content-type': 'application/json' }
      callback(response)
      response.end(JSON.stringify(data))
    })
  request.destroy = (error) => {
    if (error) request.emit('error', error)
    return request
  }
  return request
}
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_e, _path, error) => errors.push(error.message))
  contents.on('render-process-gone', (_e, details) => errors.push(details.reason))
  contents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes('Content Security Policy'))
      errors.push(details.message)
  })
})
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  main.webContents.setBackgroundThrottling(false)
  await wait(() => !main.webContents.isLoading(), 'renderer')
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  const capture = async (name) => {
    const frame = async () => {
      try {
        return await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      } catch {
        await delay(300)
        return main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      }
    }
    await frame()
    await delay(500)
    fs.writeFileSync(path.join(output, name), (await frame()).toPNG())
  }
  const click = (label, selector = 'button') =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b => b.textContent === ${JSON.stringify(label)}).click()`
    )
  const field = (label, value, tag = 'input') =>
    evaluate(`(() => {
    const element = document.querySelector('[aria-label="${label}"]')
    Object.getOwnPropertyDescriptor(${tag === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('input', {bubbles:true}))
  })()`)
  await wait(() => evaluate('!!window.api && !!document.querySelector("nav")'), 'app bridge')
  assert.equal((await evaluate('window.api.getSettings()')).model.contextWindow, 16384)
  await click('Settings', 'nav button')
  await click('Memory', '[role=tab]')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Memory title"]')`),
    'memory editor'
  )
  await field('Memory title', 'Harness fixture')
  await field(
    'Memory content',
    'MEMORY_UI_CANARY: use npm run typecheck for harness checks.',
    'textarea'
  )
  await click('Save memory')
  await wait(async () => (await evaluate('window.api.memory.list()')).length === 1, 'saved memory')
  let saved = (await evaluate('window.api.memory.list()'))[0]
  const id = saved.id
  await wait(() => evaluate('document.querySelectorAll("article").length === 1'), 'memory card')
  await click('Edit')
  await field(
    'Memory content',
    'MEMORY_UI_CANARY: run typecheck, then the harness smoke check.',
    'textarea'
  )
  await click('Save changes')
  await wait(
    async () => (await evaluate('window.api.memory.list()'))[0].content.includes('then'),
    'updated memory'
  )
  saved = (await evaluate('window.api.memory.list()'))[0]
  assert.equal(saved.id, id)
  const bytes = fs.readFileSync(path.join(profile, 'memories.json'))
  assert.equal(bytes.subarray(0, 8).toString(), 'SOPHON2\0')
  assert(!bytes.includes(Buffer.from('MEMORY_UI_CANARY')))
  await evaluate('document.fonts.ready')
  await evaluate(
    `document.querySelector('[aria-label="Memory title"]').scrollIntoView({block:'center'})`
  )
  await capture('memory-settings.png')
  await click('Assistant', 'nav button')
  await evaluate('window.api.send("Harness fixture checks")')
  assert(JSON.stringify(lastRequest).includes('MEMORY_UI_CANARY'))
  const reply = (await evaluate('window.api.getSession()')).items.at(-1)
  assert(reply.context.memories.some((memory) => memory.id === id))
  await wait(() => evaluate('document.body.innerText.includes("Context used")'), 'context report')
  await click('Context used', 'summary')
  await capture('memory-context.png')
  assert.equal(reply.workflow.outcome, 'answered')
  await wait(
    () => evaluate('document.body.innerText.includes("Task evidence")'),
    'task evidence panel'
  )
  await evaluate(
    `Array.from(document.querySelectorAll('summary')).find(s => s.textContent.startsWith('Task evidence')).click()`
  )
  await capture('workflow-evidence.png')
  await evaluate('window.api.updateSettings({model:{historyTurns:0}})')
  failNextRequest = true
  await evaluate(
    'window.api.send("WORKFLOW_GOAL_CANARY: inspect the fixture; preserve existing files.")'
  )
  const interrupted = (await evaluate('window.api.getSession()')).items.at(-1).workflow
  assert.equal(interrupted.outcome, 'interrupted')

  main.webContents.reload()
  await wait(() => !main.webContents.isLoading(), 'renderer reload')
  await wait(() => evaluate('!!window.api && !!document.querySelector("nav")'), 'reloaded app')
  assert.equal((await evaluate('window.api.memory.list()'))[0].id, id)
  await wait(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Continue task")'
      ),
    'resume control'
  )
  fixtureReply = 'Continued fixture answer.'
  await click('Continue task')
  await wait(
    async () =>
      !(await evaluate('window.api.getSession()')).busy &&
      lastRequest.messages.at(-1).content === 'Continue the previous task.',
    'resumed task'
  )
  assert(JSON.stringify(lastRequest).includes('WORKFLOW_GOAL_CANARY'))
  assert.equal((await evaluate('window.api.getSession()')).items.at(-1).workflow.id, interrupted.id)
  await evaluate(
    'window.api.memory.save({title:"Task handoff",content:"Resume checks",kind:"task",scope:"chat",pinned:true})'
  )
  await evaluate('window.api.clearSession()')
  await evaluate('window.api.send("Continue the previous task.")')
  assert(!JSON.stringify(lastRequest).includes('WORKFLOW_GOAL_CANARY'))
  assert.equal((await evaluate('window.api.memory.list()')).length, 1)
  await evaluate('window.api.updateSettings({research:{enabled:true}})')
  await evaluate('window.api.chats.create()')
  await evaluate('window.api.send("What are the harness typecheck preferences?")')
  assert.equal((await evaluate('window.api.getSession()')).mode, 'assistant')
  assert(
    JSON.stringify(lastRequest).includes('MEMORY_UI_CANARY'),
    'Enabling search must preserve assistant memory'
  )
  await click('Settings', 'nav button')
  await click('Memory', '[role=tab]')
  await wait(
    () => evaluate('document.querySelectorAll("article").length === 1'),
    'reloaded memory card'
  )
  await click('Delete')
  await wait(
    async () => (await evaluate('window.api.memory.list()')).length === 0,
    'memory deletion'
  )
  await click('Assistant', 'nav button')

  const actualSession = await evaluate('window.api.getSession()')
  const preview =
    'Use one inspected app control.\n\n' +
    JSON.stringify({
      window: { title: 'Fixture editor', exe: 'fixture.exe' },
      control: {
        control: 'Draft message',
        role: 'Edit',
        action: 'set_value',
        currentValue: 'Old draft',
        replacement: 'Bonjour — <not HTML>\nA second line.'
      }
    })
  main.webContents.send('session:update', {
    ...actualSession,
    items: [
      {
        id: 'control-preview-fixture',
        from: 'assistant',
        text: '',
        pending: false,
        actions: [
          {
            id: 'fixture-action',
            name: 'act_on_control',
            label: 'Replace field text',
            status: 'waiting',
            preview
          }
        ]
      }
    ]
  })
  await wait(() => evaluate('document.body.innerText.includes("Draft message")'), 'control preview')
  assert(await evaluate('document.body.innerText.includes("Replaces the whole field")'))
  assert(await evaluate('document.body.innerText.includes("<not HTML>")'))
  assert.equal(await evaluate('document.querySelectorAll("not").length'), 0)
  await capture('control-preview.png')
  main.webContents.send('session:update', actualSession)
  assert.deepEqual(errors, [])
  assert.equal(main.isVisible(), false)
  console.log(
    'PASS Memory UI save/edit/delete, encrypted persistence, reload, task evidence and resume with zero history, checkpoint clearing, context inspector, control preview and recall with unified web search enabled; no model or sockets'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
