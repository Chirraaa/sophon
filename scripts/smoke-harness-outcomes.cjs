const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/harness-outcomes-'))
let execute = async () => JSON.stringify({ result: 3 })
const python = { pythonExpression: (...args) => execute(...args) }
const restart = () =>
  load('src/main/harness/store.ts', {
    electron: { app: { getPath: () => directory } },
    path,
    fs,
    crypto,
    './python': python
  })
let store = restart()
const category = 'script-tools'
const content =
  '# Outcome recipe\nSource: deterministic fixture.\nApplies to: run aggregation.\nLimits: fixture only.\n\n```python\n1 + 2\n```\n'
async function compose(name, text = content) {
  await store.manageHarness({ category, name, action: 'propose', content: text })
  await store.manageHarness({ category, name, action: 'probe', expected: '3' })
  await store.manageHarness({ category, name, action: 'compose' })
  return store.harnessLifecycle(category, name).version
}
const entry = (name) => store.harnessLifecycle(category, name)
const record = (name, run, success, version = entry(name).version) =>
  store.recordHarnessUse(category, name, run, success, success ? 'Passed' : 'Failed', version)
function tools() {
  const dependencies = Object.fromEntries(
    [
      './wait',
      './files',
      './npm',
      './command',
      './openApp',
      './app-catalog',
      './windows',
      './screen',
      './interact',
      './automation/controls',
      '../network/search-provider',
      '../network/public-page',
      '../network/public-image'
    ].map((name) => [name, {}])
  )
  return load('src/main/tools/index.ts', {
    ...dependencies,
    './schemas': { toolSchemas: [] },
    '../settings': { getSettings: () => ({ memory: { enabled: true } }) },
    '../harness/store': store,
    '../harness/python': python,
    '../permissions': {},
    '../security/policy': { authorizeTool: () => {} },
    '../security/run-manager': {},
    '../security/tool-contracts': { validateToolArguments: (_, args) => args }
  })
}
async function main() {
  await compose('same-run')
  const runner = tools()
  const run = { id: 'first-run', signal: new AbortController().signal }
  await runner.executeTool('python_calculate', { recipe: 'same-run' }, run)
  execute = async () => {
    throw new Error('Recipe failed')
  }
  await assert.rejects(
    runner.executeTool('python_calculate', { recipe: 'same-run' }, run),
    /Recipe failed/
  )
  execute = async () => JSON.stringify({ result: 3 })
  store = restart()
  record('same-run', run.id, true)
  record('same-run', run.id, false)
  record('same-run', 'second-run', true)
  record('same-run', 'third-run', true)
  assert.equal(entry('same-run').state, 'candidate')
  assert.equal(entry('same-run').successes, 0)
  assert.equal(entry('same-run').failures, 1)
  assert.equal(entry('same-run').uses, 1)
  assert.match(entry('same-run').evidence.join('\n'), /fail first-run/)
  assert(!entry('same-run').evidence.some((item) => item.startsWith('pass first-run:')))
  await compose('late-failure')
  for (let i = 0; i < 3; i++) record('late-failure', `run-${i}`, true)
  assert.equal(entry('late-failure').state, 'trial', 'Successful runs do not measure usefulness')
  store = restart()
  record('late-failure', 'run-2', false)
  assert.equal(entry('late-failure').state, 'candidate')
  assert.equal(entry('late-failure').successes, 2)
  assert.equal(entry('late-failure').failures, 1)
  assert.equal(entry('late-failure').uses, 3)
  await compose('failure-first')
  record('failure-first', 'run-1', false)
  record('failure-first', 'run-1', true)
  assert.equal(entry('failure-first').successes, 0)
  assert.equal(entry('failure-first').failures, 1)
  const oldVersion = await compose('versioned')
  record('versioned', 'shared-run', true, oldVersion)
  const newVersion = await compose('versioned', content + '\nRevised recipe.\n')
  record('versioned', 'shared-run', false, oldVersion)
  assert.equal(entry('versioned').uses, 0)
  record('versioned', 'shared-run', true, newVersion)
  assert.equal(entry('versioned').successes, 1)
  // An execution of v1 finishes after compose has installed v2.
  await compose('in-flight')
  let finish
  execute = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const pending = tools().executeTool('python_calculate', { recipe: 'in-flight' }, run)
  execute = async () => JSON.stringify({ result: 3 })
  await compose('in-flight', content + '\nNew version.\n')
  finish(JSON.stringify({ result: 3 }))
  await pending
  assert.equal(entry('in-flight').uses, 0)
  let reject
  execute = () =>
    new Promise((_, fail) => {
      reject = fail
    })
  const pendingFailure = tools().executeTool('python_calculate', { recipe: 'in-flight' }, run)
  const failed = assert.rejects(pendingFailure, /Old execution failed/)
  execute = async () => JSON.stringify({ result: 3 })
  await compose('in-flight', content + '\nThird version.\n')
  reject(new Error('Old execution failed'))
  await failed
  assert.equal(entry('in-flight').failures, 0)
  // A correction arriving after archive must also govern the state restored by rollback.
  await compose('archived')
  for (let i = 0; i < 3; i++) record('archived', `run-${i}`, true)
  await store.manageHarness({ category, name: 'archived', action: 'archive' })
  record('archived', 'run-2', false)
  assert.equal(entry('archived').state, 'deprecated')
  await store.manageHarness({ category, name: 'archived', action: 'rollback' })
  assert.equal(entry('archived').state, 'candidate')
  // Outcome IDs outlive the twelve-line recent-evidence window.
  await compose('retention')
  for (let i = 0; i < 20; i++) record('retention', `run-${i}`, true)
  store = restart()
  record('retention', 'run-0', true)
  assert.equal(entry('retention').uses, 20)
  record('retention', 'run-0', false)
  assert.equal(entry('retention').successes, 19)
  assert.equal(entry('retention').failures, 1)
  record('retention', 'run-1', false)
  assert.equal(entry('retention').state, 'candidate')
  await compose('capacity')
  for (let i = 0; i < 65; i++) record('capacity', `run-${i}`, true)
  assert.equal(entry('capacity').state, 'revised')
  record('capacity', 'run-0', false)
  assert.equal(entry('capacity').successes, 63)
  assert.equal(entry('capacity').failures, 1)
  await compose('old-counters')
  for (let i = 0; i < 3; i++) record('old-counters', `run-${i}`, true)
  const manifest = path.join(directory, 'harness/lifecycle/script-tools-old-counters.json')
  const old = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  delete old.outcomes
  fs.writeFileSync(manifest, JSON.stringify(old))
  store = restart()
  assert.equal(entry('old-counters').state, 'trial')
  assert.equal(entry('old-counters').successes, 0)
  record('old-counters', 'new-run', true)
  const valid = fs.readFileSync(manifest, 'utf8')
  const malformed = JSON.parse(valid)
  malformed.outcomes[0].version++
  fs.writeFileSync(manifest, JSON.stringify(malformed))
  assert.throws(() => restart().harnessLifecycle(category, 'old-counters'), /metadata/)
  malformed.outcomes[0].version--
  malformed.successes++
  fs.writeFileSync(manifest, JSON.stringify(malformed))
  assert.throws(() => restart().harnessLifecycle(category, 'old-counters'), /metadata/)
  fs.writeFileSync(manifest, valid)
  console.log(
    'PASS failure-dominant per-run outcomes, recipe execution, restart persistence, promotion reversal, version isolation, in-flight replacement and bounded retention'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
