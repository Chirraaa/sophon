const { record } = require('./security/action-fixture.cjs')
const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const quality = load('src/shared/coding-quality.ts')
const examples = load('src/shared/coding-examples.ts')
const vm = require('node:vm')
const sessions = load('src/main/workflow/coding-session.ts', {
  '../llm/untrusted-data': { untrustedData: (_kind, _name, text) => text }
})
const ids = (goal, state) => quality.codingQualityTopics(goal, state).map((t) => t.id)
assert.deepEqual(ids('Implement a numeric helper'), [])
assert.deepEqual(ids('Build a Next.js app with login'), ['auth', 'nextjs', 'react'])
assert(
  ids('Continue', { tasks: [{ title: 'Enforce tenant ownership in queries' }] }).includes('auth')
)
assert(
  ids('Continue', { docs: 'nextjs 16 installed', plan: 'Optimize SQL queries' }).includes('nextjs')
)
assert(ids('Optimize deduplication for a million strings').includes('performance'))
assert(!ids('Fix a CSS spacing issue').includes('auth'))
assert(ids('Improve responsive CSS layout and typography').includes('ui-design'))
const designExamples = examples.retrieveCodingExamples('responsive mobile layout spacing')
assert.match(designExamples, /Example responsive-layout/)
assert(designExamples.length <= 1800)
assert.equal(examples.retrieveCodingExamples('authentication authorization'), '')
assert.equal(examples.retrieveCodingExamples('Implement Python JSON storage'), '')
assert.equal(examples.retrieveCodingExamples('responsive layout', 20), '')
const reactExamples = examples.retrieveCodingExamples(
  'Next.js React form input label validation error'
)
assert.match(reactExamples, /Example react-form/)
assert(
  !reactExamples.includes('Example accessible-form ['),
  'Do not feed HTML-only form patterns into React work'
)
assert(
  !examples.retrieveCodingExamples('HTML form input validation').includes('Example react-form')
)
const fullDesignGuide = quality.codingQualityGuide(
  'Build a responsive React todo app with dark theme and localStorage'
)
assert.match(fullDesignGuide, /UI DESIGN:/)
assert.match(fullDesignGuide, /TEACHING EXAMPLES/)
assert(fullDesignGuide.length <= 6500)

const storageCode = examples.CODING_EXAMPLES.find((example) => example.id === 'safe-storage').code
const storageContext = vm.createContext({})
vm.runInContext(storageCode, storageContext)
const todo = { id: 'a', title: '<img onerror=bad()>', done: false }
let saved = null
const storage = {
  getItem: () => saved,
  setItem: (_key, value) => {
    saved = value
  }
}
assert.equal(storageContext.saveTodos(storage, [todo]), true)
assert.equal(JSON.stringify(storageContext.loadTodos(storage)), JSON.stringify([todo]))
saved = 'not json'
assert.equal(storageContext.loadTodos(storage).length, 0)
saved = JSON.stringify([todo, { id: 1, title: 'bad', done: false }, null])
assert.equal(storageContext.loadTodos(storage).length, 1)
assert.equal(
  storageContext.saveTodos(
    {
      setItem: () => {
        throw Error('Quota')
      }
    },
    [todo]
  ),
  false
)

const all =
  'Implement a Next.js React login dashboard with SQL query pagination and large-array optimization'
const topics = quality.codingQualityTopics(all)
assert.equal(topics.length, 4, 'Bound optional topic overhead for small local models')
assert.equal(topics[0].id, 'auth', 'Security guidance takes priority when many topics match')
assert(quality.codingQualityGuide(all).length < 6500)

const session = new sessions.CodingSession(true)
record(session, 'list_files', {}, 'This folder is empty.', 'observed')
session.checkpoint(
  {
    plan: 'Implement a helper',
    docs: '',
    tasks: [
      {
        id: 'helper',
        title: 'Implement and test helper',
        dependsOn: [],
        tools: ['write_file'],
        skill: 'none',
        profile: 'main',
        status: 'active'
      }
    ]
  },
  ['write_file'],
  false
)
assert.match(session.snapshot().docs, /No stack\/version or external documentation evidence/)
const state = session.snapshot()
Object.assign(state, {
  plan: 'Implement owner-scoped Next.js authentication',
  docs: 'Installed next 16; docs lookup unavailable',
  decisions: 'Reject direct cross-user mutation',
  tasks: [
    {
      id: 'auth',
      title: 'Implement auth',
      dependsOn: [],
      tools: ['edit_file'],
      skill: 'none',
      profile: 'main',
      status: 'active'
    }
  ],
  changes: [
    '\\"'.repeat(400),
    'EDIT-EVIDENCE-SECOND\\"'.repeat(30),
    'EDIT-EVIDENCE-THIRD\\"'.repeat(30)
  ],
  trace: ['TRACE-ONE\\"'.repeat(30), 'TRACE-TWO\\"'.repeat(30)],
  verification: 'test: pass\\"'.repeat(100)
})
const resumed = new sessions.CodingSession(true, state)
const context = resumed.context(['edit_file'], false, 'Continue')
assert.match(context, /CODING TEACHER/)
assert.match(context, /AUTH:/)
assert.match(context, /NEXT.JS:/)
assert.match(context, /Server Actions as directly reachable endpoints/)
assert.match(resumed.data(), /Installed next 16/)
assert.equal(new sessions.CodingSession(false).context([], false), '')
const npmResult = (exitCode, content, stopped = false) =>
  JSON.stringify({ exitCode, stopped, output: { content } })
assert.match(
  quality.codingToolFeedback(
    'run_npm',
    { args: ['init', '-y'] },
    npmResult(0, 'Wrote package.json')
  ),
  /do not run initialization again/
)
assert.match(
  quality.codingToolFeedback(
    'run_npm',
    { args: ['run', 'test'] },
    npmResult(1, 'Error: no test specified')
  ),
  /edit_file/
)
assert.equal(quality.codingToolFeedback('run_npm', {}, 'Denied by the user.'), '')
assert.equal(quality.codingToolFeedback('run_npm', {}, npmResult(1, 'no test specified', true)), '')
record(resumed, 'run_npm', { args: ['init', '-y'] }, npmResult(0, 'Wrote package.json'), 'verified')
assert.match(resumed.feedback(), /do not run initialization again/)
record(resumed, 'run_npm', { args: ['run', 'test'] }, npmResult(0, 'pass'), 'verified')
assert.equal(resumed.feedback(), '', 'Successful checks clear obsolete scaffold repair advice')
console.log(
  'PASS coding teacher: bounded relevant guides, auth/version/scaling priorities, checkpoint continuity, bounded checkpoint evidence and ordinary-chat isolation'
)
