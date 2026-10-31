// Parallel agents in the chat and shortcut windows: the agent strip, live and finished agent
// cards, a relayed message, an approval waiting in another agent's thread, the route choice
// while busy, and an agent's own thread. Fixture sessions only; no model or desktop input.
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/agents-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let state
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) =>
    channel === 'session:get' && state ? state : listener(...args)
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

const ROOT = '11111111-1111-4111-8111-111111111111'
const A1 = '22222222-2222-4222-8222-222222222222'
const A2 = '33333333-3333-4333-8333-333333333333'
const A3 = '44444444-4444-4444-8444-444444444444'
const now = Date.now()
const info = (chatId, handle, title, color, extra) => ({
  chatId,
  parentId: ROOT,
  handle,
  title,
  color,
  kind: 'worker',
  task: `${title}: the full task the agent was given`,
  status: 'running',
  startedAt: now,
  ...extra
})
const agents = [
  info(A1, 'a1', 'Actually make the colour scheme green', '#f97316', {
    kind: 'router',
    status: 'done',
    finishedAt: now,
    summary: 'Passed on'
  }),
  info(A2, 'a2', 'Spotify playlist', '#10b981', { activity: 'Click' }),
  info(A3, 'a3', 'Discord message', '#ec4899', {
    activity: 'Waiting for your approval: Type text',
    waiting: true
  })
]
const waitingAction = {
  id: 'waiting-action',
  name: 'type_text',
  label: 'Type text',
  status: 'waiting',
  preview: JSON.stringify({ arguments: { text: "On my way, grabbing coffee — I'll join the VC." } })
}
const mainChat = {
  chatId: ROOT,
  mode: 'assistant',
  busy: true,
  runningChatId: ROOT,
  runningChatIds: [ROOT, A2, A3],
  rootChatId: ROOT,
  agents,
  approvals: [
    { chatId: A3, handle: 'a3', title: 'Discord message', color: '#ec4899', action: waitingAction }
  ],
  chats: [{ id: ROOT, title: 'Bakery landing page', updatedAt: now, running: true }],
  items: [
    { id: 'u1', from: 'you', text: 'Build my bakery landing page', actions: [], pending: false },
    {
      id: 'r1',
      from: 'agent',
      text: '',
      pending: true,
      actions: [{ id: 'w1', name: 'write_file', label: 'Write file', status: 'done' }]
    },
    {
      id: 'u2',
      from: 'you',
      text: 'Actually make the colour scheme green',
      actions: [],
      pending: false,
      agentRef: A1
    },
    {
      id: 'c1',
      from: 'agent',
      text: 'I passed your change to the main task. It replied: **switching the palette to green now.**',
      actions: [],
      pending: false,
      agentRef: A1
    },
    {
      id: 'p1',
      from: 'you',
      text: 'The user asks: actually make the colour scheme green',
      actions: [],
      pending: false,
      sender: {
        chatId: A1,
        handle: 'a1',
        title: 'Actually make the colour scheme green',
        color: '#f97316'
      }
    },
    { id: 'c2', from: 'agent', text: '', actions: [], pending: true, agentRef: A2 },
    { id: 'c3', from: 'agent', text: '', actions: [], pending: true, agentRef: A3 }
  ]
}
const thread = {
  ...mainChat,
  chatId: A2,
  busy: true,
  runningChatId: A2,
  agent: agents[1],
  approvals: [],
  items: [
    {
      id: 't1',
      from: 'you',
      text: 'Set up my focus playlist in Spotify',
      actions: [],
      pending: false,
      sender: { chatId: ROOT, handle: 'main', title: 'Main task', color: '#7c6cf2' }
    },
    {
      id: 't2',
      from: 'agent',
      text: '',
      pending: true,
      actions: [{ id: 's1', name: 'inspect_app', label: 'Read app controls', status: 'running' }]
    }
  ]
}
async function wait(check, label) {
  const until = Date.now() + 12000
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
  for (const [name, win] of [
    ['chat', main],
    ['shortcut', compact]
  ]) {
    win.webContents.setBackgroundThrottling(false)
    const evaluate = (code) => win.webContents.executeJavaScript(code, true)
    const publish = async (value) => {
      state = value
      win.webContents.send('session:update', state)
      await delay(400)
    }
    const capture = async (file) => {
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      await delay(100)
      const shot = await win.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true
      })
      fs.writeFileSync(path.join(output, `${name}-${file}.png`), shot.toPNG())
    }
    await wait(() => evaluate('!!document.querySelector("textarea")'), name + ' ready')
    await evaluate(
      'window.api.updateSettings({motion:"reduced",profile:{onboardingComplete:true}})'
    )
    await publish(mainChat)
    await wait(
      () => evaluate('!!document.querySelector("[aria-label=\\"Chat and its agents\\"]")'),
      name + ' agent strip'
    )
    const shape = await evaluate(`(() => {
      const strip = document.querySelector('[aria-label="Chat and its agents"]')
      const view = document.querySelector('[data-chat-viewport]') ?? document.documentElement
      return {
        tabs: strip.querySelectorAll('[role=tab]').length,
        selected: strip.querySelector('[aria-selected=true]')?.textContent,
        cards: [...document.querySelectorAll('[aria-label^="Agent a"]')].map((el) => el.textContent),
        text: document.body.textContent,
        route: !!document.querySelector('[aria-label="Where this message goes while Sophon is working"]'),
        placeholder: document.querySelector('textarea')?.placeholder,
        overflowX: view.scrollWidth > view.clientWidth + 1
      }
    })()`)
    assert.equal(shape.tabs, 4, name + ': main plus three agents in the strip')
    assert.match(shape.selected, /Main/, name + ': the chat itself is selected')
    assert(shape.cards.length >= 3, name + ': a card per agent, got ' + shape.cards.length)
    assert(
      shape.cards.some((text) => /switching the palette to green/.test(text)),
      name + ': finished card shows the answer'
    )
    assert(
      shape.cards.some((text) => /Spotify playlist.*Working.*Click/s.test(text)),
      name + ': live card shows activity'
    )
    assert.match(
      shape.text,
      /Agent a1 · Actually make the colour scheme green/,
      name + ': relayed message names its sender'
    )
    assert.match(
      shape.text,
      /Agent a3 · Discord message is\s*asking/,
      name + ': another agent approval is answerable here'
    )
    assert(shape.route, name + ': a busy chat offers where the message goes')
    assert.match(shape.placeholder, /something else, or change the running task/)
    assert(!shape.overflowX, name + ': no horizontal overflow')
    await capture('chat')

    await publish(thread)
    await wait(() => evaluate('document.body.textContent.includes("Main task")'), name + ' thread')
    const inThread = await evaluate(`(() => ({
      text: document.body.textContent,
      placeholder: document.querySelector('textarea')?.placeholder,
      route: !!document.querySelector('[aria-label="Where this message goes while Sophon is working"]'),
      selected: document.querySelector('[aria-label="Chat and its agents"] [aria-selected=true]')?.textContent
    }))()`)
    assert.match(inThread.selected, /Spotify playlist/, name + ': the open agent is selected')
    assert.equal(
      inThread.placeholder,
      'Message this agent…',
      name + ': the composer talks to this agent'
    )
    assert(!inThread.route, name + ': no routing inside an agent thread')
    if (name === 'chat') {
      assert.match(inThread.text, /Stop agent/, 'An agent thread can be stopped on its own')
      assert.match(inThread.text, /Agent a2/)
    }
    await capture('thread')
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS agents UI: agent strip, live and finished cards, relayed message, cross-thread approval, route choice and agent thread in chat and shortcut windows'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
