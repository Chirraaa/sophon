const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const directory = path.join(root, '.cache', 'memory-retention')
fs.mkdirSync(directory, { recursive: true })
const profile = fs.mkdtempSync(path.join(directory, 'profile-'))
const electron = {
  app: { getPath: () => profile },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString()
  }
}
const privateStore = load('src/main/security/private-store.ts', { electron, fs, path, crypto })
const details = load('src/main/chat/action-details.ts', {
  electron,
  crypto,
  path,
  '../security/private-store': privateStore
})
let reads = []
let failIndex = false
const store = load('src/main/chat/store.ts', {
  electron,
  fs,
  path,
  crypto,
  './action-details': details,
  '../services/attachments': { purgeAttachments: () => {} },
  '../security/private-store': {
    readPrivate: (file) => {
      reads.push(file)
      return privateStore.readPrivate(file)
    },
    writePrivate: (file, bytes) => {
      if (failIndex && file.endsWith('index.json')) throw new Error('Synthetic commit failure')
      privateStore.writePrivate(file, bytes)
    }
  },
  '../workflow/controller': { validWorkflow: () => false }
})
const item = (n) => ({
  id: crypto.randomUUID(),
  from: n % 2 ? 'agent' : 'you',
  text: `Message ${n}`,
  actions: [],
  pending: false
})
const action = {
  id: crypto.randomUUID(),
  name: 'edit_file',
  label: 'Edit',
  status: 'waiting',
  preview: JSON.stringify({
    arguments: { path: 'main.ts', old_text: 'a'.repeat(50000), new_text: 'b'.repeat(50000) }
  }),
  detail: 'Verified by reading back identical bytes. ' + 'CANARY'.repeat(10000)
}
const exact = { preview: action.preview, detail: action.detail }
details.archiveAction(action)
assert.equal(action.detailsStored, undefined, 'Never abbreviate a waiting approval')
action.status = 'done'
details.archiveAction(action)
assert(action.detailsStored)
assert.equal(JSON.parse(action.preview).arguments.path, 'main.ts')
assert(action.preview.length + action.detail.length < 5000)
assert.deepEqual(details.readActionDetails(action.id), exact)
assert.throws(() => details.readActionDetails('../escape'), /Invalid/)
const providerAction = { ...action, id: 'call_chatgpt_123', detailsStored: false, ...exact }
details.archiveAction(providerAction)
assert.equal(providerAction.detailsStored, true)
assert.deepEqual(details.readActionDetails(providerAction.id), exact)
assert.match(details.actionDetailsFilename(providerAction.id), /^[a-f0-9]{64}\.json$/)
const legacy = store.newConversation()
legacy.items = Array.from({ length: 1000 }, (_, n) => item(n))
legacy.items[1].actions = [action, providerAction]
const allIds = legacy.items.map((message) => message.id)
privateStore.writePrivate(
  path.join(profile, 'chats.json'),
  Buffer.from(JSON.stringify({ activeId: legacy.id, chats: [legacy] }))
)
let state = store.loadConversations()
assert(!fs.existsSync(path.join(profile, 'chats.json')))
assert(state.chats[0].items.length <= 120)
assert.equal(store.conversationTotal(state.chats[0]), 1000)
assert.deepEqual(
  store.conversationPage(state.chats[0], 100).items.map((message) => message.id),
  allIds.slice(40, 100)
)
const other = store.newConversation()
state.chats.push(other)
const categoryId = crypto.randomUUID()
state.categories = [{ id: categoryId, name: 'Research' }]
state.chats[0].categoryId = categoryId
store.persistConversations(state)
reads = []
state = store.loadConversations()
assert.equal(reads.length, 1, 'Startup reads only the index')
assert.deepEqual(state.categories, [{ id: categoryId, name: 'Research' }])
assert.equal(
  state.chats[0].categoryId,
  categoryId,
  'Category membership survives reload without reading chat bodies'
)
assert.deepEqual(
  state.chats.map((chat) => chat.id),
  [legacy.id, other.id],
  'Manual order survives reload'
)
assert.equal(store.attachmentIds(state).size, 0)
assert.equal(reads.length, 1, 'Attachment cleanup does not hydrate conversations')
assert.equal(state.chats[0].items.at(-1).text, 'Message 999')
assert.equal(reads.length, 2)
store.releaseConversations(state, [other.id])
void state.chats[0].items
assert.equal(reads.length, 3, 'Inactive conversation bodies are evicted')

for (let n = 1000; n < 1400; n++) {
  state.chats[0].items.push(item(n))
  store.persistConversations(state)
  assert(state.chats[0].items.length <= 120)
}
assert.equal(store.conversationTotal(state.chats[0]), 1400)
store.cleanAttachments(state)
assert.equal(store.conversationPage(state.chats[0], 60).items[0].text, 'Message 0')
assert.deepEqual(details.readActionDetails(action.id), exact)

state.chats[0].items.push(item(1400))
failIndex = true
assert.throws(() => store.persistConversations(state), /commit failure/)
failIndex = false
state = store.loadConversations()
store.cleanAttachments(state)
assert.equal(store.conversationTotal(state.chats[0]), 1400)
assert.equal(state.chats[0].items.at(-1).text, 'Message 1399')
store.expandConversation(state.chats[0])
assert.equal(state.chats[0].items.length, 1400)
state.chats[0].items = state.chats[0].items.slice(0, 50)
store.persistConversations(state)
store.cleanAttachments(state)
assert.equal(store.conversationTotal(state.chats[0]), 50)
assert.equal(store.conversationPage(state.chats[0], 50).items[0].text, 'Message 0')
state.chats = state.chats.slice(1)
state.activeId = state.chats[0].id
store.persistConversations(state)
store.releaseConversations(state, [state.activeId])
store.cleanAttachments(state)
assert.throws(() => details.readActionDetails(action.id), /ENOENT/)

// Private data remains encrypted and a lost key cannot be silently replaced.
const index = path.join(profile, 'conversations', 'index.json')
assert(fs.readFileSync(index).subarray(0, 8).equals(Buffer.from('SOPHON2\0')))
fs.unlinkSync(path.join(profile, 'private-store.key.enc'))
assert.throws(
  () =>
    load('src/main/security/private-store.ts', {
      electron,
      fs,
      path,
      crypto
    }).initializePrivateStorage(),
  /key is missing/
)

const retention = load('src/main/llm/retention.ts')
const turn = [{ role: 'user', content: 'Original constraints' }]
for (let n = 0; n < 1000; n++) {
  turn.push(
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: String(n), type: 'function', function: { name: 'read_file', arguments: '{}' } }
      ]
    },
    { role: 'tool', tool_call_id: String(n), content: 'x'.repeat(10000) }
  )
  retention.releaseCheckpointedMessages(turn, 'Plan and verified progress')
  assert.equal(turn.length, 2)
}
assert.equal(turn[0].content, 'Original constraints')
const results = new retention.RecentResults()
for (let n = 0; n < 10000; n++) results.push('x'.repeat(10000))
assert.equal(results.length, 8)
assert(results.join(' ').length < 17000)
console.log(
  'PASS long-task retention: bounded live messages/results, encrypted lazy details, paged history, lazy startup/eviction, migration, interrupted commit, rerun prefix, deletion and lost-key protection'
)
