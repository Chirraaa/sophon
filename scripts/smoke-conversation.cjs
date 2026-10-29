const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const makeChat = () => ({
  id: crypto.randomUUID(),
  title: 'Original',
  updatedAt: 0,
  mode: 'assistant',
  items: [],
  history: []
})
const user = (text) => ({ id: crypto.randomUUID(), from: 'you', text, actions: [], pending: false })
const agent = (text) => ({ ...user(text), from: 'agent' })
const original = makeChat()
original.items = [
  user('Repeated prompt'),
  agent('First answer'),
  user('Repeated prompt'),
  agent('Second answer'),
  user('Later prompt'),
  agent('Later answer')
]
original.items[2].attachments = [{ id: crypto.randomUUID(), name: 'Notes.txt', kind: 'text' }]
original.history = [
  [
    { role: 'user', content: 'Later prompt' },
    { role: 'assistant', content: 'Later answer' }
  ]
]
original.workflow = { goal: 'A later goal that must not leak' }
const store = { chats: [original], activeId: original.id }
let received
let deferred
let run
let startFailure = false
const clearRequest = load('src/main/chat/clear-request.ts')
let chatBehavior
let attachmentFailure = false
let attachmentGate
let modelCalls = 0
let titleCalls = 0
let titleBehavior
let cleaned = []
const referencedAttachments = (value) =>
  new Set(
    value.chats.flatMap((chat) =>
      chat.items.flatMap((item) => (item.attachments ?? []).map((attachment) => attachment.id))
    )
  )
const session = load('src/main/chat/session.ts', {
  '../plugins/store': {
    serverRecord: () => ({
      githubLogin: 'octocat',
      config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' }
    })
  },
  crypto,
  '../llm': {
    generateChatTitle: async () => {
      titleCalls++
      if (titleBehavior) return titleBehavior()
      return 'Generated chat title'
    },
    chat: async (text, _event, history, attachments, chatId, workflow, githubContext) => {
      modelCalls++
      received = structuredClone({ text, history, attachments, chatId, workflow, githubContext })
      if (chatBehavior) return chatBehavior(_event)
      if (deferred) await deferred
      history.push([
        { role: 'user', content: text },
        { role: 'assistant', content: 'New answer' }
      ])
      return 'New answer'
    }
  },
  '../services/attachments': {
    attachmentInfo: async (id) => {
      if (attachmentGate) await attachmentGate
      if (attachmentFailure) throw new Error('Missing attachment')
      return { id, name: 'Notes.txt', kind: 'text' }
    }
  },
  '../tools/registry': { TOOL_INFO: [] },
  '../../shared/action-label': load('src/shared/action-label.ts'),
  './store': {
    loadConversations: () => store,
    newConversation: makeChat,
    persistConversations: () => {},
    releaseConversations: () => {},
    conversationTotal: (chat) => chat.items.length,
    conversationPage: (chat, before) => ({
      items: chat.items.slice(Math.max(0, before - 60), before),
      start: Math.max(0, before - 60),
      total: chat.items.length
    }),
    expandConversation: () => {},
    clearConversation: (chat) => {
      chat.items = []
      chat.history = []
      delete chat.workflow
    },
    attachmentIds: referencedAttachments,
    cleanAttachments: (value, previous) => {
      const retained = referencedAttachments(value)
      cleaned = [...previous].filter((id) => !retained.has(id))
    }
  },
  '../settings': {
    getSettings: () => ({
      privacy: {},
      model: { endpoint: 'http://localhost', historyTurns: 4 },
      files: { workspace: '' }
    })
  },
  '../security/run-manager': {
    startRun: () => {
      if (startFailure) throw new Error('Synthetic run creation failure')
      const controller = new AbortController()
      return (run = { id: crypto.randomUUID(), sources: [], signal: controller.signal, controller })
    },
    // Like the real run manager, finishing a run aborts its signal.
    finishRun: (finished) => finished.controller.abort(),
    assertRun: () => {
      if (run.signal.aborted) throw new Error('Stopped')
    }
  },
  '../security/audit': { securityEvent: () => {} },
  './clear-request': clearRequest,
  '../memory/store': { pruneChatMemories: () => {}, clearChatMemories: () => {} },
  '../workflow/results': { resultFailure: () => false },
  '../network/search-provider': { searchProviderLabel: () => 'fixture' },
  './action-details': { archiveAction: () => {}, readActionDetails: () => ({}) }
})
async function main() {
  session.loadSession()
  const context = {
    serverId: crypto.randomUUID(),
    account: 'octocat',
    repository: 'octocat/hello',
    branch: 'feature/chat-context'
  }
  assert.throws(
    () => session.setGithubContext(original.id, { ...context, repository: 'someone/hello' }),
    /owned repository/
  )
  assert.throws(
    () =>
      session.setGithubContext(original.id, {
        ...context,
        account: 'someone',
        repository: 'someone/hello'
      }),
    /identity changed/
  )
  session.setGithubContext(original.id, context)
  assert.deepEqual(session.snapshot().githubContext, context)
  session.setGithubContext(original.id, null)
  assert.equal(session.snapshot().githubContext, undefined)
  session.setGithubContext(original.id, context)
  original.items[5].attachments = [{ id: crypto.randomUUID(), name: 'Discarded.png' }]
  const before = structuredClone(original)
  const promptId = original.items[2].id
  const attachmentId = original.items[2].attachments[0].id
  attachmentFailure = true
  await assert.rejects(session.rerun(original.id, promptId, 'Edited prompt'), /Missing attachment/)
  assert.deepEqual(original, before, 'Attachment failure preserves the complete conversation')
  attachmentFailure = false
  startFailure = true
  await assert.rejects(
    session.rerun(original.id, promptId, 'Edited prompt'),
    /run creation failure/
  )
  assert.deepEqual(original, before, 'Startup failure preserves the complete conversation')
  assert(!session.snapshot().busy)
  startFailure = false
  await session.rerun(original.id, original.items[2].id, 'Edited prompt')
  assert.equal(store.chats.length, 1, 'Rerun must not create a chat')
  assert.equal(session.snapshot().chatId, original.id)
  assert.equal(received.chatId, original.id)
  assert.deepEqual(
    received.githubContext,
    context,
    'The model receives the current repository and branch'
  )
  assert.equal(original.title, before.title, 'Preserve the existing title')
  assert.deepEqual(original.items.slice(0, 2), before.items.slice(0, 2))
  assert.equal(original.items[2].id, promptId, 'Keep the selected prompt identity')
  assert.equal(modelCalls, 1, 'Only the selected prompt is executed')
  assert.deepEqual(cleaned, [before.items[5].attachments[0].id])
  assert.equal(received.text, 'Edited prompt')
  assert.deepEqual(received.history, [
    [
      { role: 'user', content: 'Repeated prompt' },
      { role: 'assistant', content: 'First answer' }
    ]
  ])
  assert.deepEqual(received.attachments, [attachmentId])
  assert.equal(received.workflow, undefined)
  assert.deepEqual(
    session.snapshot().items.map((item) => item.text),
    ['Repeated prompt', 'First answer', 'Edited prompt', 'New answer']
  )
  await session.rerun(original.id, promptId, 'Edited prompt')
  assert.equal(original.items.length, 4, 'Repeated reruns replace rather than append')
  assert.equal(store.chats.length, 1)
  assert.equal(received.history.length, 1, 'Previous regeneration is excluded from context')
  await session.rerun(original.id, promptId, '')
  assert.deepEqual(received.attachments, [attachmentId], 'Attachment-only reruns are supported')
  assert.equal(original.items[2].id, promptId)

  let releaseAttachment
  attachmentGate = new Promise((resolve) => {
    releaseAttachment = resolve
  })
  const backgroundRerun = session.rerun(original.id, promptId, 'Background rerun')
  session.createChat()
  const other = store.chats[0]
  releaseAttachment()
  await backgroundRerun
  attachmentGate = undefined
  assert.equal(received.chatId, original.id)
  assert.equal(session.snapshot().chatId, other.id, 'Keep the user-selected chat active')
  assert.equal(other.items.length, 0)
  session.selectChat(original.id)

  attachmentGate = new Promise((resolve) => {
    releaseAttachment = resolve
  })
  const staleRerun = session.rerun(original.id, promptId, 'Stale rerun')
  session.clear()
  releaseAttachment()
  await assert.rejects(staleRerun, /conversation changed/)
  attachmentGate = undefined
  assert.equal(
    original.items.length,
    0,
    'Do not restore a prompt cleared while loading attachments'
  )
  chatBehavior = () => {
    clearRequest.requestChatClear()
    return 'Done'
  }
  await session.send('Clear this chat')
  chatBehavior = undefined
  assert.equal(
    original.items.length,
    0,
    'A clear_chat request empties the chat once the reply ends'
  )
  await session.send('Repeated prompt')
  await session.rerun(original.id, original.items[0].id, 'Repeated prompt')
  assert.deepEqual(received.history, [], 'First prompt has no future context')
  const count = store.chats.length
  await assert.rejects(
    session.rerun(original.id, original.items[1].id, 'invalid'),
    /no longer exists/
  )
  await assert.rejects(session.rerun(original.id, original.items[0].id, ''), /Enter a prompt/)
  assert.equal(store.chats.length, count)
  let release
  deferred = new Promise((resolve) => {
    release = resolve
  })
  const pending = session.send('Wait')
  await new Promise((resolve) => setImmediate(resolve))
  assert(session.snapshot().busy)
  await assert.rejects(
    session.rerun(original.id, original.items[0].id, 'Retry'),
    /Stop the current response/
  )
  release()
  await pending
  assert(!session.snapshot().busy)
  deferred = undefined
  startFailure = true
  await assert.rejects(session.send('Cannot start'), /run creation failure/)
  assert.equal(session.snapshot().busy, false, 'A failed run must not leave the composer busy')
  startFailure = false
  chatBehavior = async (emit) => {
    emit({ type: 'text', text: 'Partial answer' })
    emit({ type: 'tool_start', id: 'unfinished', name: 'list_windows', args: {} })
    throw new Error('Synthetic stream interruption')
  }
  await session.send('Interrupted response')
  const interrupted = session.snapshot().items.at(-1)
  assert.match(interrupted.text, /^Partial answer\n\nError: Synthetic stream interruption$/)
  assert.equal(interrupted.pending, false)
  assert.equal(interrupted.actions[0].status, 'failed')
  assert.equal(session.snapshot().busy, false)
  chatBehavior = async (emit) => {
    for (const [id, name] of [
      'discover_tools',
      'coding_resources',
      'coding_checkpoint',
      'future_tool'
    ].entries()) {
      emit({ type: 'tool_start', id: String(id), name, args: {} })
      emit({ type: 'tool_end', id: String(id), result: 'Done' })
    }
    return 'Actions complete'
  }
  await session.send('Action labels')
  assert.deepEqual(
    session
      .snapshot()
      .items.at(-1)
      .actions.map((action) => action.label),
    ['Load tool instructions', 'Adjust coding working sizes', 'Save coding progress', 'Future tool']
  )
  chatBehavior = async (emit) => {
    emit({ type: 'text', text: 'Draft' })
    return 'Final answer'
  }
  await session.send('Recover after interruption')
  assert.equal(session.snapshot().items.at(-1).text, 'Final answer')
  assert.equal(session.snapshot().items.at(-1).pending, false)
  chatBehavior = undefined
  let snapshots = 0
  const textUpdates = []
  const offSnapshot = session.onSession(() => snapshots++)
  const offText = session.onSessionText((update) => textUpdates.push(update))
  chatBehavior = async (emit) => {
    const before = snapshots
    for (let n = 0; n < 100; n++) emit({ type: 'text', text: 'Streaming ' + n })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(snapshots, before, 'Streaming never rebroadcasts the conversation')
    assert.equal(textUpdates.length, 1, 'Text updates are coalesced')
    assert.equal(textUpdates[0].text, 'Streaming 99')
    assert.deepEqual(Object.keys(textUpdates[0]).sort(), ['chatId', 'itemId', 'text'])
    return 'Finished streaming'
  }
  await session.send('Streaming retention')
  offSnapshot()
  offText()
  chatBehavior = undefined
  session.clear()
  for (let turn = 0; turn < 7; turn++) await session.send('Turn ' + turn)
  await session.rerun(original.id, original.items[12].id, 'Turn 6')
  assert.deepEqual(
    received.history.map((turn) => turn[0].content),
    ['Turn 2', 'Turn 3', 'Turn 4', 'Turn 5'],
    'Rerun includes only the configured number of recent preceding exchanges'
  )

  session.createChat()
  const titled = store.chats[0]
  titled.title = 'New chat'
  await session.send('Please explain how a rainbow forms')
  assert.equal(titled.title, 'Generated chat title')
  assert.equal(titleCalls, 1)
  await session.send('And a second question')
  assert.equal(titleCalls, 1, 'Name a new chat only once')
  session.createChat()
  const renamed = store.chats[0]
  renamed.title = 'New chat'
  titleBehavior = () => {
    session.renameChat(renamed.id, 'My chosen title')
    return 'Generated title should not overwrite this'
  }
  await session.send('Another first question')
  assert.equal(renamed.title, 'My chosen title')
  session.createChat()
  const unavailable = store.chats[0]
  unavailable.title = 'New chat'
  titleBehavior = () => null
  await session.send('Keep a useful fallback if naming fails')
  assert.equal(unavailable.title, 'Keep a useful fallback if naming fails')
  assert.equal(unavailable.items.at(-1).text, 'New answer')
  titleBehavior = undefined

  session.createChatCategory('Work')
  const category = session.snapshot().categories[0]
  assert.throws(() => session.createChatCategory(' work '), /already exists/)
  assert.throws(() => session.createChatCategory(' '), /category name/)
  session.moveChat(titled.id, category.id)
  session.moveChat(renamed.id, category.id, titled.id)
  assert.deepEqual(
    session
      .snapshot()
      .chats.filter((chat) => chat.categoryId === category.id)
      .map((chat) => chat.id),
    [renamed.id, titled.id]
  )
  const order = session.snapshot().chats.map((chat) => chat.id)
  assert.throws(
    () => session.moveChat(unavailable.id, null, titled.id),
    /destination chat has moved/
  )
  assert.deepEqual(
    session.snapshot().chats.map((chat) => chat.id),
    order,
    'Invalid moves are atomic'
  )
  session.renameChatCategory(category.id, 'Projects')
  assert.equal(session.snapshot().categories[0].name, 'Projects')
  const countBeforeRemove = titled.items.length
  session.deleteChatCategory(category.id)
  assert.equal(session.snapshot().categories.length, 0)
  assert.equal(titled.categoryId, undefined)
  assert.equal(titled.items.length, countBeforeRemove, 'Removing a category keeps its chats')
  console.log(
    'PASS in-place edit/rerun, stable chat and prompt IDs, bounded preceding context, attachment reuse/cleanup, startup failures, navigation races, invalid IDs and active-run exclusion'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
