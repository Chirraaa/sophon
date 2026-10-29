const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')

let stored
const privateStore = {
  readPrivate: () => {
    if (!stored) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return Buffer.from(stored)
  },
  writePrivate: (_path, bytes) => {
    stored = Buffer.from(bytes)
  }
}
const store = load('src/main/services/notes.ts', {
  electron: { app: { getPath: () => 'profile' } },
  path: require('node:path'),
  crypto,
  '../security/private-store': privateStore
})
const results = load('src/main/workflow/results.ts')
const registry = load('src/main/tools/registry.ts')
const schemas = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const { validateToolArguments } = load('src/main/security/tool-contracts.ts', {
  '../tools/schemas': schemas
})
const tools = load('src/main/tools/notes.ts', {
  '../workflow/tool-outcome': load('src/main/workflow/tool-outcome.ts', { './results': results }),
  '../services/notes': store
})
const run = (name, args) => {
  const out = tools.executeNotesTool(name, validateToolArguments(name, args))
  return typeof out === 'string' ? JSON.parse(out) : out
}

for (const name of ['notes_list', 'notes_read', 'notes_create', 'notes_edit', 'notes_delete']) {
  assert(registry.isKnownTool(name), name)
  assert.equal(registry.defaultToolPermissions()[name], 'ask')
}
for (const name of ['notes_create', 'notes_edit', 'notes_delete'])
  assert(results.MUTATIONS.has(name))
assert(!results.MUTATIONS.has('notes_list') && !results.MUTATIONS.has('notes_read'))

// Argument contracts
for (const [name, args] of [
  ['notes_create', {}],
  ['notes_create', { title: 'x'.repeat(121) }],
  ['notes_create', { title: 'a', extra: 1 }],
  ['notes_read', { id: 'note-xyz' }],
  ['notes_edit', { id: 'note-0123456789ab' }],
  ['notes_delete', { id: 'note-0123456789ab' }],
  ['notes_list', { limit: 'ten' }]
])
  assert.throws(() => validateToolArguments(name, args), name)

// Empty store
assert.deepEqual(run('notes_list', {}).notes, [])

// Create with read-back
const created = run('notes_create', { title: '  Groceries ', body: 'milk\r\neggs' })
assert.equal(created.operation, 'create')
assert.equal(created.verified, true)
assert.equal(created.note.title, 'Groceries')
assert.equal(created.note.body, 'milk\neggs')
assert.equal(created.note.revision, 1)
assert.equal(results.assessResult('notes_create', {}, JSON.stringify(created)).status, 'verified')
const id = created.note.id

// List / search / read
run('notes_create', { title: 'Meeting', body: 'Budget review with Alex' })
assert.equal(run('notes_list', {}).notes.length, 2)
assert.deepEqual(
  run('notes_list', { query: 'ALEX' }).notes.map((n) => n.title),
  ['Meeting']
)
assert.equal(run('notes_list', { limit: 1 }).notes.length, 1)
assert.equal(run('notes_read', { id }).note.body, 'milk\neggs')
assert.equal(run('notes_read', { id: 'note-000000000000' }).code, 'target-missing')

// Edit: append, replace, stale revision, both body+append
let edited = run('notes_edit', { id, revision: 1, append: 'bread' })
assert.equal(edited.note.body, 'milk\neggs\nbread')
assert.equal(edited.note.revision, 2)
assert.equal(edited.verified, true)
const stale = run('notes_edit', { id, revision: 1, body: 'lost update' })
assert.equal(stale.status, 'failed')
assert.equal(stale.execution, 'not-started')
assert.match(stale.text, /changed since it was read/)
assert.equal(run('notes_read', { id }).note.body, 'milk\neggs\nbread')
assert.equal(run('notes_edit', { id, revision: 2, body: 'a', append: 'b' }).status, 'failed')
assert.equal(run('notes_edit', { id, revision: 2 }).status, 'failed')
edited = run('notes_edit', { id, revision: 2, title: 'Shopping', body: 'tea' })
assert.equal(edited.note.title, 'Shopping')
assert.equal(edited.note.body, 'tea')
assert.throws(() => validateToolArguments('notes_edit', { id, revision: 3, title: '   ' }), /Empty/)
assert.throws(() => store.editNote(id, 3, { title: '   ' }), /Title must be/)

// Approval preview shows exact before/after and rejects stale targets before asking
const edit = tools.bindNotesAction('notes_edit', { id, revision: 3, append: 'honey' })
assert.deepEqual(edit.preview.before, { title: 'Shopping', body: 'tea' })
assert.deepEqual(edit.preview.after, { title: 'Shopping', body: 'tea\nhoney' })
assert.throws(
  () => tools.bindNotesAction('notes_edit', { id, revision: 1, append: 'x' }),
  /changed/
)
const del = tools.bindNotesAction('notes_delete', { id, revision: 3 })
assert.equal(del.preview.operation, 'delete')
run('notes_edit', { id, revision: 3, append: 'changed after approval' })
assert.throws(() => del.revalidate(), /changed/)
assert.deepEqual(tools.bindNotesAction('notes_create', { title: 'T' }).preview, {
  operation: 'create',
  title: 'T',
  body: ''
})

// Delete
assert.equal(run('notes_delete', { id, revision: 3 }).status, 'failed')
const removed = run('notes_delete', { id, revision: 4 })
assert.equal(removed.verified, true)
assert.equal(results.assessResult('notes_delete', {}, JSON.stringify(removed)).status, 'verified')
assert.equal(run('notes_read', { id }).code, 'target-missing')
assert.equal(run('notes_list', {}).notes.length, 1)
assert.equal(
  results.assessResult('notes_edit', {}, JSON.stringify({ kind: 'note-change', verified: false }))
    .status,
  'uncertain'
)

// Limits and corruption
stored = undefined
for (let i = 0; i < store.NOTE_LIMIT; i++) store.createNote('n' + i)
assert.throws(() => store.createNote('over'), /limited to/)
assert.throws(() => store.createNote('big', 'x'.repeat(store.NOTE_BODY_MAX + 1)), /limited/)
const before = Buffer.from(stored)
stored = Buffer.from('{"version":2,"notes":[]}')
assert.throws(() => store.loadNotes(), /preserved/)
assert.equal(run('notes_create', { title: 'x' }).status, 'uncertain')
assert.equal(stored.toString(), '{"version":2,"notes":[]}')
assert(before.length > 0)
console.log('notes smoke passed')
