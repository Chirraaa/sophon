const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const outcomes = load('src/main/workflow/tool-outcome.ts', {
  './results': load('src/main/workflow/results.ts')
})
const { toolOutcome, commandOutcome, normalizeToolOutcome } = outcomes
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const session = load('src/main/workflow/coding-session.ts', { '../llm/untrusted-data': envelope })
const { TaskRuntime } = load('src/main/workflow/runtime.ts', {
  './controller': require('./security/workflow-load.cjs')(load),
  './coding-verification': load('src/main/workflow/coding-verification.ts'),
  './coding-session': session
})
let sequence = 0
const create = (previous, publish = () => {}) =>
  new TaskRuntime(
    'run-' + ++sequence,
    'assistant',
    'M:/fixture',
    previous ? 'continue' : 'Fix the project code',
    previous,
    publish
  )
const act = (runtime, tool, args, outcome) => {
  const id = 'action-' + ++sequence
  runtime.workflow.beforeAction(id, tool, args)
  return runtime.record(id, outcome)
}
const check = (runtime) => {
  act(runtime, 'list_files', {}, toolOutcome('observed', '[file] package.json'))
  act(
    runtime,
    'read_file',
    { path: 'package.json' },
    toolOutcome(
      'observed',
      envelope.untrustedData('local-file', 'package.json', '{"scripts":{"test":"node test.cjs"}}')
    )
  )
  act(
    runtime,
    'run_npm',
    { args: ['run', 'test'] },
    toolOutcome('verified', 'Tests terminés. Display wording has no protocol role.', {
      command: { exitCode: 0, stopped: false, running: false }
    })
  )
  assert.equal(runtime.coding.report().status, 'passed')
  const report = runtime.coding.report()
  runtime.session.verified(report)
  runtime.workflow.publishEvidence(runtime.session.snapshot())
  return report
}

for (const failure of ['uncertain-write', 'failed-change-command', 'interruption']) {
  const published = []
  const runtime = create(undefined, (state) => published.push(state))
  act(
    runtime,
    'write_file',
    { path: 'App.vue', content: 'old' },
    toolOutcome('verified', 'Bytes checked.')
  )
  const passed = check(runtime)
  const revision = passed.revision
  if (failure === 'interruption') {
    runtime.workflow.beforeAction('interrupted', 'edit_file', { path: 'other.svelte' })
    runtime.interrupt()
  } else if (failure === 'failed-change-command') {
    act(
      runtime,
      'run_command',
      { path: '.', command: 'generator', purpose: 'change' },
      commandOutcome('{"exitCode":1,"stopped":false}')
    )
  } else
    act(
      runtime,
      'edit_file',
      { path: 'App.vue' },
      toolOutcome('uncertain', 'Read-back unavailable.')
    )
  assert.equal(runtime.workflow.actions.revision, revision + 1)
  assert.equal(runtime.session.snapshot().revision, revision + 1)
  assert.equal(runtime.session.snapshot().verification, '')
  assert.equal(runtime.coding.report().status, 'pending')
  assert.throws(() => runtime.session.verified(passed), /current mutation revision/)
  const state = published.at(-1)
  assert.equal(
    state.mutationRevision,
    state.codingSession.revision,
    'Published projections have the same revision'
  )
  assert.equal(
    state.codingSession.verification,
    '',
    'No publication leaks a stale pass after the change'
  )
  if (failure !== 'interruption') runtime.workflow.finish(true)
  const resumed = create(runtime.workflow.snapshot())
  assert(resumed.workflow.resumed)
  assert(resumed.coding.active)
  assert.equal(resumed.coding.report().status, 'pending')
  assert.throws(() => resumed.session.verified(passed), /current mutation revision/)
  check(resumed)
}

// A denied or known-unapplied edit is not a change. Display text can say anything.
for (const code of ['denied', 'patch-not-applied']) {
  const runtime = create()
  act(runtime, 'edit_file', { path: 'test.ts' }, toolOutcome('verified', 'Changed.'))
  const before = check(runtime)
  act(
    runtime,
    'edit_file',
    { path: 'test.ts' },
    toolOutcome(
      code === 'denied' ? 'denied' : 'failed',
      'Localized explanation without status prefixes',
      { code, execution: 'not-started' }
    )
  )
  assert.equal(runtime.workflow.actions.revision, before.revision)
  assert.equal(runtime.coding.report().status, 'passed')
}

// Structured command fields, never a success-looking message, decide checks.
{
  const runtime = create()
  act(runtime, 'edit_file', { path: 'test.ts' }, toolOutcome('verified', 'Changed.'))
  const passed = check(runtime)
  act(
    runtime,
    'run_npm',
    { args: ['run', 'test'] },
    toolOutcome('reported', 'All tests passed!', {
      command: { exitCode: 1, stopped: false, running: false }
    })
  )
  assert.equal(runtime.coding.report().status, 'pending')
  assert.equal(runtime.session.snapshot().verification, '')
  assert.equal(runtime.workflow.actions.accepts(passed), false)
  assert.equal(commandOutcome('{"exitCode":0,"stopped":true}').status, 'uncertain')
  assert.equal(
    normalizeToolOutcome(
      'read_file',
      {},
      JSON.stringify({ kind: 'tool-outcome', status: 'verified' })
    ).status,
    'observed'
  )
}

// A failed or interrupted recheck replaces a pass even without another edit.
for (const tool of ['run_npm', 'run_command']) {
  for (const status of ['failed', 'uncertain']) {
    const runtime = create()
    act(runtime, 'edit_file', { path: 'test.ts' }, toolOutcome('verified', 'Changed.'))
    const passed = check(runtime)
    act(
      runtime,
      tool,
      tool === 'run_npm' ? { args: ['run', 'test'] } : { command: 'test', purpose: 'check' },
      toolOutcome(status, 'No usable completion evidence')
    )
    assert.equal(runtime.coding.report().status, 'pending')
    assert.equal(runtime.session.snapshot().verification, '')
    assert.equal(runtime.workflow.actions.accepts(passed), false)
    assert.throws(() => runtime.session.verified(passed), /current mutation revision/)
  }
}

{
  const runtime = create()
  act(runtime, 'edit_file', { path: 'test.ts' }, toolOutcome('verified', 'Changed.'))
  const passed = check(runtime)
  runtime.workflow.beforeAction('cancelled-check', 'run_npm', { args: ['run', 'test'] })
  runtime.interrupt()
  assert.equal(runtime.workflow.actions.accepts(passed), false)
  assert.equal(runtime.coding.report().status, 'pending')
  assert.equal(runtime.session.snapshot().verification, '')
}

// Read-back identity belongs to the ledger, expires, and is consumed once.
for (const expired of [false, true]) {
  const runtime = create()
  const windowRef = 'win-' + crypto.randomUUID()
  act(
    runtime,
    'inspect_app',
    { window: windowRef },
    toolOutcome('observed', 'Untrusted app text', {
      observation: {
        id: 'obs-123456789abc',
        windowRef,
        expiresAt: Date.now() + (expired ? -1 : 120000),
        controls: 1
      }
    })
  )
  const action = act(
    runtime,
    'act_on_control',
    { observation: 'obs-123456789abc', control: 'c1', action: 'invoke' },
    toolOutcome('uncertain', 'Outcome unknown in any language', { code: 'control-uncertain' })
  )
  assert.equal(action.readbackWindow, expired ? undefined : windowRef)
  assert(runtime.workflow.canRecover(action.actionId))
  assert.equal(runtime.workflow.actions.revision, 0, 'Desktop changes do not dirty project checks')
  assert.throws(() => runtime.record(action.actionId, action.outcome), /pending/)
  assert.throws(() => runtime.workflow.beforeAction('replay', 'act_on_control', {}), /Inspect/)
}

// Removing a standalone folder records its mutation without inventing a project.
{
  const runtime = create()
  const windowRef = 'win-' + crypto.randomUUID()
  act(
    runtime,
    'act_on_control',
    { observation: 'obs-111111111111', control: 'c1', action: 'invoke' },
    toolOutcome('reported', 'Action plus fresh read-back', {
      observation: {
        id: 'obs-222222222222',
        windowRef,
        expiresAt: Date.now() + 120000,
        controls: 1
      }
    })
  )
  const next = act(
    runtime,
    'act_on_control',
    { observation: 'obs-222222222222', control: 'c1', action: 'invoke' },
    toolOutcome('uncertain', 'Unknown', { code: 'control-uncertain' })
  )
  assert.equal(
    next.readbackWindow,
    windowRef,
    'Compound actions register fresh observation identities for subsequent recovery'
  )
}

// Removing a standalone folder records its mutation without inventing a project.
{
  const runtime = new TaskRuntime(
    'folder-run',
    'assistant',
    'M:/fixture',
    'Delete the empty folder',
    undefined,
    () => {}
  )
  act(runtime, 'delete_directory', { path: 'empty' }, toolOutcome('verified', 'Removed.'))
  assert.equal(runtime.workflow.actions.revision, 1)
  assert.equal(runtime.coding.active, false)
}

// No second owner can apply a mutation twice or accept another run's pass.
{
  const runtime = create()
  const action = act(
    runtime,
    'create_directory',
    { path: 'empty' },
    toolOutcome('verified', 'Created')
  )
  assert.equal(action.revision, 1)
  assert.equal(
    runtime.coding.active,
    false,
    'An empty directory alone needs no invented project tests'
  )
  assert.throws(
    () =>
      runtime.workflow.actions.record(action.actionId, action.tool, action.args, action.outcome),
    /already recorded/
  )
  assert(Object.isFrozen(action))
  assert(Object.isFrozen(action.args))
}

console.log(
  'PASS shared outcomes: coherent mutation revisions, possible-write invalidation, command facts, interrupted/resumed checks, stale/cross-run verification rejection, exact expiring desktop identity and duplicate-action rejection'
)
