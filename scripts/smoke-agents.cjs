// Parallel agents: concurrent runs, desktop turn-taking, pointer paths, and the session's
// agent threads (routing a message to a busy chat, relays between agents, spawned agents,
// stopping). The model is scripted; no desktop input or model calls happen.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, label, ms = 4000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${label}`)
    await sleep(5)
  }
}
const identity = (handle, chatId = crypto.randomUUID()) => ({
  handle,
  title: handle === 'main' ? 'Sophon' : `Agent ${handle}`,
  color: '#7c6cf2',
  chatId,
  rootChatId: chatId,
  depth: handle === 'main' ? 0 : 1,
  kind: 'worker'
})

async function runManager() {
  const runs = load('src/main/security/run-manager.ts', { crypto })
  runs.setRunLimit(3)
  const finished = []
  runs.onRunFinished((run) => finished.push(run.id))
  const a = runs.startRun('assistant', 'e', '', undefined, identity('main'))
  assert.equal(runs.currentRun(), a, 'Outside any run scope the only active run is current')
  const b = runs.startRun('assistant', 'e', '', undefined, identity('a1'))
  assert.equal(runs.currentRun(), undefined, 'With several runs, unscoped code has no run')
  await Promise.all(
    [a, b].map((run) =>
      runs.withRun(run, async () => {
        await sleep(Math.random() * 10)
        assert.equal(runs.currentRun(), run, 'Each async chain keeps its own run')
        await Promise.resolve()
        assert.equal(runs.currentRun(), run)
      })
    )
  )
  const c = runs.startRun('assistant', 'e', '', undefined, identity('a2'))
  assert.throws(() => runs.startRun('assistant', 'e', ''), /already running 3 tasks/)
  runs.stopRun(b.id)
  assert(b.signal.aborted && !a.signal.aborted, 'Stopping one run leaves the others running')
  runs.finishRun(b)
  assert(finished.includes(b.id), 'Finishing a run notifies per-run state')
  assert.throws(() => runs.assertRun(b), /no longer authorized|Stopped/)
  runs.revokePolicy()
  assert(a.signal.aborted && c.signal.aborted, 'A policy change stops every run')
  runs.finishRun(a)
  runs.finishRun(c)
  runs.setRunLimit(1)
  const solo = runs.startRun('assistant', 'e', '')
  assert.throws(() => runs.startRun('assistant', 'e', ''), /A task is already running/)
  runs.finishRun(solo)
  console.log('PASS run manager: concurrent scoped runs, limit, per-run stop and policy revocation')
}

async function arbiterTurns() {
  const runs = load('src/main/security/run-manager.ts', { crypto })
  runs.setRunLimit(4)
  const arbiter = load('src/main/desktop/arbiter.ts', { '../security/run-manager': runs })
  const r1 = runs.startRun('assistant', 'e', '', undefined, identity('main'))
  const r2 = runs.startRun('assistant', 'e', '', undefined, identity('a1'))
  const order = []
  let releaseFirst
  const first = arbiter.withDesktop(
    r1,
    { hwnd: 10, input: true },
    () =>
      new Promise((resolve) => {
        order.push('r1 start')
        releaseFirst = () => {
          order.push('r1 end')
          resolve('one')
        }
      })
  )
  await sleep(5)
  let waitedFor
  const second = arbiter.withDesktop(
    r2,
    { hwnd: 20, input: true, onWait: (busy) => (waitedFor = busy) },
    async () => {
      order.push('r2 start')
      return 'two'
    }
  )
  await sleep(10)
  assert.deepEqual(order, ['r1 start'], 'Input waits for the agent holding the desktop')
  assert.equal(waitedFor?.handle, 'main', 'The waiting agent learns who holds the desktop')
  assert.equal(arbiter.desktopHolder()?.runId, r1.id)
  releaseFirst()
  assert.equal(await first, 'one')
  assert.equal(await second, 'two')
  assert.deepEqual(order, ['r1 start', 'r1 end', 'r2 start'], 'Turns are first come, first served')

  assert.equal(arbiter.windowClaim(10, r2)?.runId, r1.id, 'Acting in a window claims it')
  assert.equal(arbiter.windowClaim(10, r1), null, 'A run never waits for its own claim')
  let claimedLater = false
  const third = arbiter.withDesktop(r2, { hwnd: 10, input: false }, async () => {
    claimedLater = true
    return 'three'
  })
  await sleep(20)
  assert(!claimedLater, "Another agent's window waits until it is free")
  runs.finishRun(r1)
  assert.equal(await third, 'three', 'A finished run releases its windows')

  assert.equal(
    await arbiter.withDesktop(r2, { input: true }, () =>
      arbiter.withDesktop(r2, { input: true }, async () => 'nested')
    ),
    'nested',
    'A run holding the desktop can nest its own input'
  )

  const r3 = runs.startRun('assistant', 'e', '', undefined, identity('a2'))
  let releaseHolder
  const holding = arbiter.withDesktop(
    r3,
    { input: true },
    () => new Promise((resolve) => (releaseHolder = resolve))
  )
  await sleep(5)
  const queued = arbiter.withDesktop(r2, { input: true }, async () => 'never')
  await sleep(5)
  runs.stopRun(r2.id)
  await assert.rejects(queued, /Stopped/, 'Stop interrupts a wait for the desktop')
  releaseHolder('done')
  await holding
  assert.equal(arbiter.desktopHolder(), null, 'The desktop is free after the last turn')
  runs.finishRun(r2)
  runs.finishRun(r3)
  console.log('PASS desktop arbiter: input turns, window claims, nesting, stop while waiting')
}

function pointerPath() {
  const path = load('src/shared/pointer-path.ts')
  const from = { x: 100, y: 100 }
  const far = { x: 1300, y: 700 }
  assert.equal(path.glideDuration(from, { x: 101, y: 101 }, 'natural'), 0)
  const natural = path.glideDuration(from, far, 'natural')
  assert(natural >= 160 && natural <= 480, 'Natural glides stay short')
  assert(
    path.glideDuration(from, { x: 200, y: 100 }, 'natural') < natural,
    'Longer moves take longer'
  )
  assert(path.glideDuration(from, far, 'fast') < natural)
  assert.equal(path.glideDuration(from, far, 'instant'), 0)
  const curve = path.glideCurve(from, far)
  assert(Math.abs(curve) >= 0.04 && Math.abs(curve) <= 0.16, 'A gentle bow, never a loop')
  assert.equal(path.glideCurve(from, far), curve, 'The same move bends the same way')
  assert.deepEqual(path.glidePoint(from, far, curve, 0), from)
  const end = path.glidePoint(from, far, curve, 1)
  assert(Math.abs(end.x - far.x) < 1e-9 && Math.abs(end.y - far.y) < 1e-9)
  const middle = path.glidePoint(from, far, curve, 0.5)
  const straight = { x: (from.x + far.x) / 2, y: (from.y + far.y) / 2 }
  assert(Math.hypot(middle.x - straight.x, middle.y - straight.y) > 5, 'The path curves')
  const early = path.glidePoint(from, far, 0, 0.1)
  assert(
    Math.hypot(early.x - from.x, early.y - from.y) <
      0.05 * Math.hypot(far.x - from.x, far.y - from.y),
    'Starts slowly'
  )
  console.log('PASS pointer path: bounded durations, speeds, curved eased path with exact ends')
}

async function sessionAgents() {
  const runs = load('src/main/security/run-manager.ts', { crypto })
  const settings = {
    privacy: {},
    model: { endpoint: 'http://localhost', historyTurns: 6 },
    files: { workspace: '' },
    memory: { enabled: false },
    agents: { enabled: true, maxConcurrent: 4, route: 'auto', cursors: true, pointer: 'natural' }
  }
  const settingsModule = {
    getSettings: () => structuredClone(settings),
    onSettingsChange: () => () => {}
  }
  const agents = load('src/main/chat/agents.ts', {
    '../settings': settingsModule,
    '../security/run-manager': runs,
    '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto })
  })
  const makeChat = () => ({
    id: crypto.randomUUID(),
    title: 'New chat',
    updatedAt: 0,
    mode: 'assistant',
    items: [],
    history: []
  })
  const root = makeChat()
  const store = { chats: [root], activeId: root.id }
  const seen = []
  const peerMessages = []
  let releaseMain = false
  let mainRun
  // The main task works until released, reading messages at each step and answering agents.
  async function mainTask(run) {
    mainRun = run
    while (!releaseMain) {
      run.signal.throwIfAborted()
      for (const message of run.followUps.take()) {
        if (!message.sender) continue
        peerMessages.push(message)
        const answer = await agents.runAgentTool(
          'message_agent',
          { to: message.sender.handle, message: 'Got it: switching the palette to green now.' },
          run
        )
        assert.match(answer, /Delivered|Reply/, 'The main task can answer an agent')
      }
      await sleep(5)
    }
    return 'The landing page is built in green.'
  }
  const chat = async (text, _onEvent, history) => {
    const run = runs.currentRun()
    assert(run, 'Each task runs inside its own run scope')
    seen.push({
      text,
      handle: run.agent.handle,
      kind: run.agent.kind,
      role: agents.agentRolePrompt(run),
      tools: agents.agentToolNames(run),
      roster: agents.agentRoster(run),
      history: structuredClone(history)
    })
    if (run.agent.kind === 'router') {
      const reply = await agents.runAgentTool(
        'message_agent',
        { to: 'main', message: `The user asks: ${text}`, await_reply: true, timeout_seconds: 5 },
        run
      )
      return `I passed your change to the main task. ${reply}`
    }
    if (text.startsWith('Build')) return mainTask(run)
    if (text.startsWith('Slow')) {
      while (!run.signal.aborted) await sleep(5)
      run.signal.throwIfAborted()
    }
    return `${text.split('\n')[0]} - done.`
  }
  const session = load('src/main/chat/session.ts', {
    crypto,
    '../plugins/store': { serverRecord: () => ({ config: {} }) },
    '../llm': {
      chat,
      generateChatTitle: async () => null,
      saveTurn: (turns, turn) => turns.push(turn)
    },
    '../services/attachments': {
      attachmentInfo: async (id) => ({ id, name: 'Notes.txt', kind: 'text' }),
      storeImage: async () => ({ id: crypto.randomUUID(), name: 'Screenshot.jpg', kind: 'image' })
    },
    '../tools/registry': { TOOL_INFO: [] },
    '../../shared/action-label': load('src/shared/action-label.ts'),
    './store': {
      loadConversations: () => store,
      newConversation: makeChat,
      persistConversations: () => {},
      releaseConversations: () => {},
      conversationTotal: (value) => value.items.length,
      conversationPage: () => ({ items: [], start: 0, total: 0 }),
      expandConversation: () => {},
      clearConversation: (value) => {
        value.items = []
        value.history = []
      },
      attachmentIds: () => new Set(),
      cleanAttachments: () => {}
    },
    '../settings': settingsModule,
    '../security/run-manager': runs,
    '../security/audit': { securityEvent: () => {} },
    '../memory/store': { pruneChatMemories: () => {}, clearChatMemories: () => {} },
    '../network/search-provider': { searchProviderLabel: () => 'fixture' },
    './action-details': { archiveAction: () => {}, readActionDetails: () => ({}) },
    './agents': agents
  })
  session.loadSession()
  const thread = (handle) => store.chats.find((value) => value.agent?.handle === handle)

  // Task A starts in a clean chat.
  const mainDone = session.send('Build my bakery landing page')
  await until(() => session.snapshot().busy && mainRun, 'main task running')
  assert.deepEqual(seen[0].tools, ['spawn_agent'], 'Alone, the main task can only start agents')

  // Minutes later, a change to task A without cancelling it: a router agent relays it.
  await session.send('Actually make the colour scheme green')
  let state = session.snapshot()
  assert.equal(state.agents.length, 1, 'A message to a busy chat starts an agent')
  assert.equal(state.agents[0].kind, 'router')
  assert.equal(state.agents[0].handle, 'a1')
  const card = root.items.find((item) => item.from === 'agent' && item.agentRef)
  assert(card?.pending, 'The agent shows as a live card in the chat')
  assert(
    root.items.some((item) => item.from === 'you' && item.agentRef === card.agentRef),
    "The user's message stays in the chat, linked to its agent"
  )
  await until(() => thread('a1').agent.status === 'done', 'router finished')
  const router = seen.find((entry) => entry.kind === 'router')
  assert.match(router.role, /the user sent this message while other agents/i)
  assert(router.tools.includes('message_agent') && router.tools.includes('stop_agent') === false)
  assert.equal(router.roster[0].handle, 'main', 'The router sees the running main task')
  assert.equal(router.roster[0].status, 'running')
  assert.equal(peerMessages.length, 1, 'The main task receives the relayed change')
  assert.match(peerMessages[0].text, /colour scheme green/)
  assert.equal(peerMessages[0].sender.handle, 'a1')
  assert(
    root.items.some((item) => item.sender?.handle === 'a1' && !item.followUp),
    'The relayed message is visible in the chat and marked read'
  )
  assert.match(card.text, /passed your change.*switching the palette to green/is)
  assert(!card.pending, 'The card shows the agent answer when it finishes')
  assert(
    root.history.some((turn) => /agent a1/.test(turn[0].content)),
    "The chat's history records what the agent handled"
  )
  assert(!runs.activeRuns().some((run) => run.agent?.handle === 'a1'), 'The router terminated')

  // Something unrelated, explicitly in parallel: a worker agent does it on its own.
  await session.send('Text my usual friends that I am on my way', [], undefined, 'parallel')
  await until(() => thread('a2')?.agent.status === 'done', 'parallel worker finished')
  assert.equal(thread('a2').agent.kind, 'worker')
  assert.match(thread('a2').agent.summary, /on my way - done/)

  // The main task starts its own agent, then waits for its result.
  const started = await agents.runAgentTool(
    'spawn_agent',
    { title: 'Spotify playlist', task: 'Set up my focus playlist in Spotify' },
    mainRun
  )
  assert.match(started, /Started agent a3 \("Spotify playlist"\)/)
  const spotify = thread('a3')
  assert.equal(spotify.agent.spawnedBy, root.id)
  assert.equal(spotify.items[0].sender?.handle, 'main', 'The task shows who handed it over')
  const checked = await agents.runAgentTool('check_agents', { wait_seconds: 5 }, mainRun)
  assert.match(
    checked,
    /Set up my focus playlist in Spotify - done/,
    'check_agents waits for results'
  )
  await sleep(20)
  assert(!mainRun.followUps.pending(), 'A result the parent waited for needs no separate notice')

  // Add to the task explicitly: an ordinary follow-up, no agent.
  await session.send('Use a serif font too', [], undefined, 'steer')
  assert(
    root.items.some((item) => item.text === 'Use a serif font too' && item.followUp === 'queued'),
    'Add to task queues the message for the running task'
  )

  // An agent thread's own composer talks to that agent; its Stop stops only it.
  await session.send('Slow inventory check', [], undefined, 'parallel')
  await until(() => runs.activeRuns().some((run) => run.agent?.handle === 'a4'), 'a4 running')
  session.selectChat(thread('a4').id)
  state = session.snapshot()
  assert.equal(state.agent.handle, 'a4', 'An agent thread can be opened')
  assert.equal(state.rootChatId, root.id)
  assert(
    !state.chats.some((value) => value.id === thread('a4').id),
    'Agent threads stay out of the sidebar'
  )
  assert(state.chats.find((value) => value.id === root.id).running, 'Its chat shows as working')
  await session.send('Only check the pantry')
  assert(
    thread('a4').items.some(
      (item) => item.text === 'Only check the pantry' && item.followUp === 'queued'
    )
  )
  session.stopChat(thread('a4').id)
  await until(() => thread('a4').agent.status === 'stopped', 'a4 stopped')
  assert(!mainRun.signal.aborted, "Stopping an agent leaves the chat's task running")
  session.selectChat(root.id)

  // Messages to a finished agent are not delivered.
  const late = await agents.runAgentTool('message_agent', { to: 'a2', message: 'hi' }, mainRun)
  assert.match(late, /Not sent: agent a2 \("Text my usual friends/)

  // With parallel agents off, a busy chat queues messages as before.
  settings.agents.enabled = false
  await session.send('Add a contact form')
  assert(
    root.items.some((item) => item.text === 'Add a contact form' && item.followUp === 'queued')
  )
  assert.deepEqual(agents.agentToolNames(mainRun), [], 'Agent tools disappear when switched off')
  settings.agents.enabled = true

  // The chat's Stop ends its task and every agent.
  await session.send('Slow photo shoot plan', [], undefined, 'parallel')
  await until(() => runs.activeRuns().some((run) => run.agent?.handle === 'a5'), 'a5 running')
  session.stopChat(root.id)
  await mainDone
  await until(() => !runs.anyRunActive(), 'every run stopped')
  assert.equal(thread('a5').agent.status, 'stopped')
  assert(!session.snapshot().busy)
  session.deleteChat(root.id)
  assert(
    !store.chats.some((value) => value.parentId === root.id),
    'Deleting a chat removes its agents'
  )
  console.log(
    'PASS session agents: router relay with reply and termination, parallel worker, spawned agent with check, steer, agent thread follow-up and stop, off switch, chat-wide stop, deletion'
  )
}

async function cursorOverlay() {
  const { EventEmitter } = require('node:events')
  const windows = []
  const settings = { agents: { cursors: true }, motion: 'full' }
  let game = null
  class Window extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.scripts = []
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: () => {},
        executeJavaScript: async (code) => this.scripts.push(code)
      })
      windows.push(this)
    }
    setIgnoreMouseEvents(value) {
      this.clickThrough = value
    }
    setAlwaysOnTop(value, level) {
      this.level = level
    }
    setContentProtection(value) {
      this.protected = value
    }
    loadURL(url) {
      this.url = decodeURIComponent(url)
      return Promise.resolve()
    }
    showInactive() {
      this.shown = true
    }
    isDestroyed() {
      return !!this.destroyed
    }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 } }
  ]
  const screen = Object.assign(new EventEmitter(), {
    screenToDipPoint: (point) => point,
    getDisplayNearestPoint: (point) =>
      displays.find((d) => point.x >= d.bounds.x && point.x < d.bounds.x + d.bounds.width) ??
      displays[0]
  })
  const finished = []
  const cursors = load('src/main/desktop/cursors.ts', {
    electron: { BrowserWindow: Window, screen },
    '../settings': { getSettings: () => settings, onSettingsChange: () => () => {} },
    '../services/fullscreen': { fullscreenApp: () => game },
    '../security/run-manager': { onRunFinished: (listener) => finished.push(listener) }
  })
  const run = { id: 'r1', agent: { chatId: 'c1', title: 'Spotify playlist', color: '#f97316' } }
  const other = { id: 'r2', agent: { chatId: 'c2', title: 'Discord', color: '#10b981' } }
  cursors.cursorMove(run, { x: 400, y: 300 }, { duration: 200, curve: 0.08 })
  const overlay = windows[0]
  assert(overlay, 'An agent acting on screen gets a cursor overlay')
  assert.equal(overlay.options.focusable, false)
  assert.equal(overlay.clickThrough, true, 'The overlay never takes clicks')
  assert.equal(overlay.protected, true, 'Screenshots and settle probes never see cursors')
  assert.equal(overlay.level, 'screen-saver')
  assert.match(overlay.url, /window\.cursors/)
  assert.doesNotMatch(overlay.url, /Spotify/, 'Labels go through data, never into the page source')
  overlay.webContents.emit('did-finish-load')
  await sleep(0)
  assert(overlay.shown)
  const sent = overlay.scripts.join('\n')
  assert.match(sent, /"label":"Spotify playlist"/)
  assert.match(sent, /"color":"#f97316"/)
  cursors.cursorMove(other, { x: 600, y: 500 }, { duration: 150 })
  cursors.cursorPulse(other)
  cursors.cursorState(run, 'waiting')
  assert.equal(windows.length, 1, 'Agents on one monitor share its overlay')
  assert.match(overlay.scripts.at(-1), /"op":"state".*"state":"waiting"/)
  cursors.cursorMove(run, { x: 2200, y: 400 })
  assert.equal(windows.length, 2, 'Each monitor gets its own overlay')
  assert.match(
    overlay.scripts.at(-1),
    /"op":"remove","id":"c1"/,
    'A cursor leaves the monitor it left'
  )
  game = { exclusive: true, displayId: 1 }
  const before = windows.length
  overlay.destroy()
  cursors.cursorMove(other, { x: 700, y: 500 })
  assert.equal(windows.length, before, 'No topmost overlay over an exclusive fullscreen game')
  game = null
  settings.agents.cursors = false
  cursors.cursorMove(
    { id: 'r3', agent: { chatId: 'c3', title: 'x', color: '#000000' } },
    { x: 50, y: 50 }
  )
  assert.equal(windows.length, before, 'Cursors can be switched off')
  settings.agents.cursors = true
  for (const listener of finished) {
    listener(run)
    listener(other)
  }
  assert.equal(cursors.cursorPosition(run), undefined, 'A finished run drops its cursor')
  console.log(
    'PASS agent cursors: protected click-through overlays per monitor, labels as data, monitor changes, fullscreen games, off switch, cleanup'
  )
}

async function main() {
  await cursorOverlay()
  await runManager()
  await arbiterTurns()
  pointerPath()
  await sessionAgents()
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
