const { record } = require('./security/action-fixture.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const sessions = load('src/main/workflow/coding-session.ts', { '../llm/untrusted-data': envelope })
const schemas = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schemas })
const discovery = load('src/main/llm/tool-discovery.ts')
const pinned = new discovery.ToolDiscovery('implement').select(
  schemas.toolSchemas,
  discovery.CODING_PINNED_TOOLS
)
for (const name of discovery.CODING_PINNED_TOOLS)
  assert(
    pinned.some((tool) => tool.function.name === name),
    name
  )
const contextModule = load('src/main/llm/context.ts', { './untrusted-data': envelope })
const schemaBudget = contextModule.contextBudget(
  { contextWindow: 8192, maxTokens: 512 },
  pinned,
  false
)
assert(schemaBudget.inputBudget > 0)
console.log('Coding pinned schema budget (8192 context):', JSON.stringify(schemaBudget))
const resourceModule = load('src/shared/coding-resources.ts')
contracts.validateToolArguments('coding_resources', {})
contracts.validateToolArguments('coding_resources', { edit_chars: 32000, reason: 'One component' })
for (const args of [
  { read_chars: 0, reason: 'test' },
  { edit_chars: 1.5, reason: 'test' },
  { read_chars: 60001, reason: 'test' },
  { edit_chars: 20000 },
  { maxSteps: 100 }
])
  assert.throws(() => contracts.validateToolArguments('coding_resources', args))
const directory = fs.mkdtempSync(path.join(root, '.cache/coding-harness-'))
const documents = load('src/main/workflow/coding-documents.ts', {
  electron: { app: { getPath: () => directory } },
  path,
  fs,
  crypto
})
const task = (status = 'active') => ({
  id: 'change',
  title: 'Implement the requested function',
  dependsOn: [],
  tools: ['read_file', 'write_file', 'edit_file', 'run_npm'],
  skill: 'none',
  profile: 'main',
  status
})
const plan = (status = 'active') => ({
  plan: 'Update the function, preserve inputs, and run project checks.',
  docs: 'Read package.json; no third-party API changes. Web lookup is unnecessary.',
  tasks: [task(status)]
})
const names = schemas.toolSchemas.map((t) => t.function.name)
const codingUi = load('src/renderer/src/lib/coding.ts', {
  './activity': load('src/renderer/src/lib/activity.ts', {
    '../../../shared/visuals': load('src/shared/visuals.ts')
  })
})
for (const plan of ['', 'Implement the feature']) {
  const stopped = codingUi.codingView({
    pending: false,
    text: 'Error: Argument too long: edit_file.old_text (65537 characters; maximum 65536).',
    actions: [],
    workflow: {
      outcome: 'interrupted',
      codingSession: { plan, tasks: [{ title: 'Implement the feature', status: 'active' }] }
    }
  })
  assert.equal(stopped.label, 'Paused')
  assert.match(stopped.current, /^Error: Argument too long/)
}
assert.equal(
  codingUi.codingView({
    pending: false,
    text: '',
    actions: [],
    workflow: {
      outcome: 'interrupted',
      nextStep: 'Inspect the last action before continuing.',
      codingSession: { plan: '', tasks: [] }
    }
  }).current,
  'Inspect the last action before continuing.'
)
assert.equal(
  codingUi.codingView({
    pending: false,
    actions: [],
    workflow: { outcome: 'answered', codingSession: { plan: '', tasks: [] } }
  }).label,
  'Finished'
)
assert.equal(
  codingUi.codingChecks({
    actions: [
      {
        name: 'run_npm',
        status: 'done',
        detail: JSON.stringify({
          exitCode: 1,
          stopped: false,
          output: { content: 'failed assertion' }
        })
      }
    ]
  })[0].status,
  'Failed (1)'
)
assert.equal(
  codingUi.codingChecks({
    actions: [
      { name: 'run_npm', status: 'done', detail: JSON.stringify({ exitCode: 0, stopped: true }) }
    ]
  })[0].status,
  'Stopped'
)

function controllerTests() {
  const deleting = new sessions.CodingSession(true)
  assert.equal(deleting.guard('delete_file', { path: 'index.ts' }), undefined)
  record(deleting, 'list_files', {}, '[file] index.ts', 'observed')
  deleting.checkpoint(plan(), names, true)
  assert.equal(deleting.guard('delete_file', { path: 'index.ts' }), undefined)
  deleting.checkpoint(
    { tasks: [{ ...task(), tools: [...task().tools, 'delete_file', 'delete_directory'] }] },
    names,
    true
  )
  assert.equal(deleting.guard('delete_directory', { path: 'old' }), undefined)
  record(
    deleting,
    'delete_file',
    { path: 'index.ts' },
    'Deleted file index.ts. Verified path is absent.',
    'verified'
  )
  assert.equal(deleting.snapshot().revision, 1)
  const verification = load('src/main/workflow/coding-verification.ts')
  const gate = new verification.CodingVerification()
  record(
    gate,
    'delete_file',
    { path: 'src/old.ts' },
    'Deleted file src/old.ts. Verified path is absent.',
    'verified'
  )
  assert.equal(gate.active, true, 'Deleting source code requires fresh project checks')
  record(
    gate,
    'delete_directory',
    { path: 'legacy' },
    'Deleted folder legacy. Verified path is absent.',
    'verified'
  )
  assert(gate.paths().includes('legacy'))
  assert.match(deleting.pendingIssue(), /active/)
  assert(sessions.wantsCodingSession('Implement a feature in this project', 'M:/project'))
  assert(!sessions.wantsCodingSession('Explain React functions', 'M:/project'))
  assert(!sessions.wantsCodingSession('Build a React app', ''))
  for (const args of [
    ['run', 'dev'],
    ['run', 'test'],
    ['run', 'typecheck'],
    ['run', 'build']
  ]) {
    const routine = new sessions.CodingSession(false)
    assert.equal(routine.guard('run_npm', { args }), undefined)
    assert.equal(routine.active, false)
  }
  for (const args of [
    ['install'],
    ['exec', 'generator'],
    ['run', 'generate'],
    ['run', 'lint', '--', '--fix']
  ]) {
    const mutation = new sessions.CodingSession(false)
    assert.equal(mutation.guard('run_npm', { args }), undefined)
    assert.equal(mutation.active, true)
  }
  const s = new sessions.CodingSession(true)
  assert.match(s.guard('write_file', { path: 'index.ts', overwrite: true }), /must be patched/)
  assert.equal(s.guard('write_file', { path: 'index.ts' }), undefined)
  assert.throws(() => s.checkpoint(plan(), names, true), /Inspect/)
  record(s, 'list_files', {}, '[file] package.json', 'observed')
  s.checkpoint(plan(), names, true)
  assert.equal(s.guard('write_file', { path: 'index.ts' }), undefined)
  assert.throws(
    () => s.checkpoint({ tasks: [{ ...task(), tools: ['invented_tool'] }] }, names, true),
    /unavailable tool/
  )
  assert.throws(
    () => s.checkpoint({ tasks: [{ ...task(), dependsOn: ['change'] }] }, names, true),
    /valid ordered tasks/
  )
  assert.throws(() => s.checkpoint({ tasks: [task('verified')] }, names, true), /Only actual/)
  assert.throws(
    () => s.checkpoint({ tasks: [{ ...task(), profile: 'reviewer' }] }, names, false),
    /unavailable/
  )
  record(s, 'write_file', { path: 'index.ts', content: 'export const n = 1' }, 'saved', 'verified')
  assert.equal(s.snapshot().revision, 1)
  s.checkpoint({ tasks: [task('implemented')] }, names, true)
  assert.equal(s.pendingIssue(), undefined)
  s.verified({
    runId: s.ledger.runId,
    revision: s.ledger.revision,
    checkRevision: s.ledger.checkRevision,
    status: 'passed',
    summary: 'npm run test passed'
  })
  s.checkpoint({ lesson: 'No reusable lesson found' }, names, true)
  const resumed = new sessions.CodingSession(true, {
    ...s.snapshot(),
    edgeReview: 'obsolete',
    review: 'obsolete',
    reviewPending: true,
    reviewRevision: 1
  })
  for (const key of ['edgeReview', 'review', 'reviewPending', 'reviewRevision'])
    assert(
      !Object.hasOwn(resumed.snapshot(), key),
      'Legacy review state must not enter the runtime'
    )
  assert.equal(resumed.snapshot().tasks[0].status, 'implemented')
  assert.equal(resumed.snapshot().verification, '')
  s.checkpoint({ tasks: [task()] }, names, true)
  record(s, 'write_file', { path: 'index.ts', content: 'changed again' }, 'saved', 'verified')
  assert.equal(s.needsReflection, true)
  assert.equal(s.snapshot().verification, '')
  s.compact()
  assert.equal(s.snapshot().checkpointRevision, s.snapshot().revision)
  assert.equal(s.snapshot().tasks[0].status, 'active')
  assert(sessions.validCodingSession(s.snapshot()))
  assert(!sessions.validCodingSession({ ...s.snapshot(), tasks: [null] }))
  const saved = documents.saveCodingDocuments('fixture-run', s.documents())
  assert.deepEqual(fs.readdirSync(saved).sort(), Object.keys(s.documents()).sort())
  assert.match(fs.readFileSync(path.join(saved, 'STATE.md'), 'utf8'), /"next": "change"/)
  assert.throws(() => documents.saveCodingDocuments('../escape', s.documents()), /Invalid/)
  const linked = path.join(directory, 'linked.txt')
  fs.linkSync(path.join(saved, 'PLAN.md'), linked)
  assert.throws(() => documents.saveCodingDocuments('fixture-run', s.documents()), /Unsafe/)
  console.log(
    'PASS coding state: routing, stage gates, dependencies, tool/profile gaps, host-only verification, stale evidence, resume and safe Markdown mirrors'
  )
}

let model = {
  contextWindow: 32000,
  maxTokens: 512,
  historyTurns: 0,
  maxSteps: 30,
  specialists: true
}
let run,
  queue,
  captured,
  executions,
  offeredTools,
  reviews,
  latest,
  checkExit,
  denied,
  largeRead,
  checkOutcomes,
  missingWrites,
  patchMismatches,
  listingResult,
  inlineVisual
let fixtureManifest
const workflow = require('./security/workflow-load.cjs')(load)
const chat = load('src/main/llm/chat.ts', {
  ...require('./security/harness-fixture.cjs')(load),
  '../../shared/coding-resources': resourceModule,
  '../workflow/coding-documents': documents,
  crypto,
  '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
  '../settings': { getSettings: () => ({ model }) },
  '../services/attachments': { attachmentContent: async () => [] },
  './prompt': { buildSystemPrompt: () => 'Fixture assistant' },
  './client': {
    getModel: async () => 'fixture',
    callLLM: async (_id, messages, options) => {
      captured.push(messages)
      offeredTools.push(options.tools.map((tool) => tool.function.name))
      assert(run.modelCalls < run.modelCallLimit, 'No request may exceed the run model-call limit')
      run.modelCalls++
      assert(queue.length, 'Unexpected model call')
      const response = queue.shift()
      if (response instanceof Error) throw response
      return response
    }
  },
  './run-tool': {
    runTool: async (name, args) => {
      executions.push({ name, args })
      run.tools++
      if (name === 'list_files')
        return args.path === 'missing-inspection'
          ? 'Missing workspace path: no action was executed. Inspect the existing parent.'
          : listingResult
      if (name === 'read_file')
        return envelope.untrustedData(
          'local-file',
          args.path,
          args.path === 'package.json'
            ? JSON.stringify(fixtureManifest)
            : largeRead
              ? 'FILE-CONTENT-CANARY\n' + 'line of source\n'.repeat(1100)
              : 'export const n = 0'
        )
      if (name === 'write_file' && missingWrites-- > 0)
        return 'Missing workspace path: no action was executed. Inspect the parent folder.'
      if (name === 'edit_file' && patchMismatches-- > 0)
        return 'Patch not applied: no file was changed. Read the current file.'
      if (name === 'write_file')
        return `Saved ${args.path} (${Buffer.byteLength(args.content)} bytes). Verified by reading back identical bytes.`
      if (name === 'edit_file') {
        if (args.path === 'package.json') fixtureManifest = JSON.parse(args.new_text)
        return `Edited ${args.path}. Verified by reading back identical bytes.`
      }
      if (name === 'run_command')
        return JSON.stringify({
          exitCode: checkOutcomes.length ? checkOutcomes.shift() : checkExit,
          stopped: false,
          output: 'command diagnostics'
        })
      if (name === 'run_npm') {
        if (args.action === 'stop')
          return JSON.stringify({ action: 'stop', stopped: true, running: false, verified: true })
        if (args.args[1] === 'dev')
          return JSON.stringify({ running: true, stopped: false, url: 'http://localhost:3000/' })
        if (checkOutcomes.length) checkExit = checkOutcomes.shift()
        return denied
          ? 'Denied by the user.'
          : JSON.stringify({
              exitCode: checkExit,
              stopped: false,
              output: checkExit ? 'Expected 1, got 0' : 'pass'
            })
      }
      throw new Error('Unexpected tool ' + name)
    }
  },
  './specialists': {
    SPECIALIST_INSTRUCTIONS: '',
    specialistLimits: () => ({ consultations: 2, handoffChars: 3200 }),
    coordinatorTools: () => schemas.toolSchemas,
    consultSpecialist: async ({ args, execute }) => {
      reviews.push(args)
      run.modelCalls++
      await assert.rejects(execute('write_file', {}), /no action tools/)
      if (reviewFailure && reviews.length === 1) return { calls: 1, ...reviewFailure }
      return {
        calls: 1,
        text: envelope.untrustedData(
          'specialist-findings',
          'reviewer',
          'Review complete; assess the edge cases and evidence limits.'
        )
      }
    }
  },
  './visuals': { wantsVisual: () => inlineVisual },
  './visual-reply': {
    correctVisualReply: async (_model, _messages, reply) => reply,
    correctVisualToolCall: async (_model, _messages, reply) => reply
  },
  './visual-routing': { needsVisualTools: () => false },
  '../security/run-manager': {
    currentRun: () => run,
    assertRun: () => {},
    consumeToolBudget: (r) => {
      r.tools++
    }
  },
  '../security/tool-contracts': contracts,
  './untrusted-data': envelope,
  './context': load('src/main/llm/context.ts', { './untrusted-data': envelope }),
  './playbooks': load('src/main/llm/playbooks.ts'),
  '../memory/store': {},
  '../memory/records': {},
  '../tools': { activeToolSchemas: () => schemas.toolSchemas },
  './environment': load('src/main/llm/environment.ts'),
  './desktop-reply': { correctDesktopReply: async (_id, _messages, reply) => reply },
  '../workflow/controller': workflow
}).chat
const tool = (name, args = {}) => ({
  tool_calls: [
    {
      id: crypto.randomUUID(),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) }
    }
  ]
})
const answer = (content = 'Implemented the function.') => ({ content })
const write = () => tool('write_file', { path: 'index.ts', content: 'export const n = 1' })
const checkpoint = (args) => tool('coding_checkpoint', args)
let reviewFailure
function reset(replies) {
  run = {
    id: crypto.randomUUID(),
    mode: 'assistant',
    workspace: 'M:\\Project',
    tools: 0,
    modelCalls: 0
  }
  queue = replies
  captured = []
  offeredTools = []
  executions = []
  reviews = []
  reviewFailure = undefined
  latest = undefined
  checkExit = 0
  checkOutcomes = []
  missingWrites = 0
  patchMismatches = 0
  inlineVisual = false
  denied = false
  largeRead = false
  listingResult = '[file] package.json\n[file] index.ts'
  fixtureManifest = { scripts: { test: 'node test.js' } }
}
const event = (e) => {
  if (e.type === 'workflow') latest = e.state
}
const happy = () => [
  tool('list_files'),
  checkpoint(plan()),
  write(),
  checkpoint({ tasks: [task('implemented')] }),
  answer()
]

async function integrationTests() {
  model.maxSteps = 1
  reset([write()])
  assert.match(await chat('Implement the function in this project', event, []), /model-step limit/)
  assert.equal(latest.outcome, 'needs_review')
  assert.equal(executions.length, 0, 'No tool may run from the reserved final response')
  assert(latest.codingSession)
  reset([])
  run.modelCalls = 1
  assert.match(await chat('Implement the function in this project', event, []), /model-step limit/)
  assert.equal(latest.outcome, 'needs_review')
  assert(latest.codingSession)

  model.maxSteps = 3
  reset([tool('list_files'), write(), answer('Partial implementation; checks pending.')])
  await chat('Implement the function in this project', event, [])
  assert.equal(run.modelCalls, 3)
  assert.equal(latest.outcome, 'needs_review')
  assert(latest.codingSession)
  const limited = structuredClone(latest)
  model.maxSteps = 30
  reset([answer('Continuing the previous implementation.')])
  await chat('continue', event, [], [], '', limited)
  assert.equal(latest.id, limited.id, 'Budget checkpoint must resume the same workflow')

  reset(happy())
  assert.match(await chat('Implement the function in this project', event, []), /Project checks:/)
  assert.equal(queue.length, 0)
  assert.equal(latest.outcome, 'actions_checked')
  assert.equal(latest.codingSession.tasks[0].status, 'verified')
  assert.equal(reviews.length, 0, 'A routine coding task needs no automatic reviewer')
  assert.equal(executions.filter((e) => e.name === 'run_npm').length, 1)
  const previous = structuredClone(latest)
  const mixed = { tool_calls: [...checkpoint(plan()).tool_calls, ...write().tool_calls] }
  reset([
    tool('list_files'),
    mixed,
    checkpoint(plan()),
    write(),
    checkpoint({ tasks: [task('implemented')] }),
    answer()
  ])
  assert.match(await chat('Implement the function in this project', event, []), /Project checks:/)
  assert.equal(
    executions.filter((e) => e.name === 'write_file').length,
    1,
    'Rejected mixed batch must have no side effects'
  )
  assert(
    captured.some((messages) =>
      messages.some(
        (message) =>
          message.role === 'tool' &&
          message.content.includes('No checkpoint or action was executed')
      )
    )
  )
  reset([tool('list_files'), mixed, mixed, mixed])
  await assert.rejects(
    chat('Implement the function in this project', event, []),
    /three rejected batches/
  )
  assert(
    !executions.some((e) => e.name === 'write_file'),
    'Repeated protocol failures never execute their actions'
  )
  for (const request of [
    'Continue',
    'try again',
    'go ahead',
    'My answers:\nKeep the existing behavior'
  ]) {
    reset([answer()])
    await chat(request, event, [], [], '', previous)
    assert.equal(latest.goal, previous.goal, 'Short follow-ups preserve the original request')
    assert.equal(executions.filter((e) => e.name === 'write_file').length, 0)
    assert.equal(executions.filter((e) => e.name === 'run_npm').length, 1)
    assert.equal(reviews.length, 0)
  }

  reset([tool('read_file', { path: 'index.ts' }), write(), answer()])
  assert.match(await chat('Fix the function in this project', event, []), /Project checks:/)
  assert.equal(queue.length, 0)
  assert.equal(latest.codingSession.plan, '')
  assert.equal(latest.outcome, 'actions_checked')
  assert(offeredTools[0].includes('write_file'))
  assert(offeredTools[0].includes('run_command'))
  assert.equal(reviews.length, 0)

  for (const request of [
    'take a look at the code base and say done when familiar',
    'Inspect this repository'
  ]) {
    reset([tool('list_files'), tool('read_file', { path: 'index.ts' }), answer('Done.')])
    assert.equal(await chat(request, event, []), 'Done.')
    assert.equal(latest.codingSession, undefined)
    assert.equal(executions.length, 2)
    assert.equal(reviews.length, 0)
  }
  reset([
    tool('list_files', { path: 'missing-inspection' }),
    tool('list_files'),
    tool('read_file', { path: 'index.ts' }),
    answer('Done.')
  ])
  assert.equal(await chat('Inspect this repository', event, []), 'Done.')
  assert.equal(latest.codingSession, undefined)
  assert.equal(latest.outcome, 'answered')
  assert.match(JSON.stringify(captured), /inspection-only request/)

  reset([
    tool('read_file', { path: 'index.ts' }),
    write(),
    tool('run_npm', { args: ['run', 'test'] }),
    answer()
  ])
  assert.match(await chat('Fix the function in this project', event, []), /Project checks:/)
  assert.equal(
    executions.filter((e) => e.name === 'run_npm').length,
    1,
    'A current model-run check is reused after manifest discovery'
  )
  for (const request of ['Run npm build', 'Start the server', 'Close the server']) {
    reset([
      tool('run_npm', {
        args: ['run', request.startsWith('Run') ? 'build' : 'dev'],
        ...(request.startsWith('Close') ? { action: 'stop' } : {})
      }),
      answer('Done.')
    ])
    assert.equal(await chat(request, event, []), 'Done.')
    assert.equal(queue.length, 0)
    assert.equal(reviews.length, 0)
  }
  reset([
    tool('run_command', { command: 'git status --short', purpose: 'inspect' }),
    answer('Working tree inspected.')
  ])
  assert.match(await chat('Check git status', event, []), /inspected/)
  assert.equal(executions[0].name, 'run_command')

  const edit = () => tool('edit_file', { path: 'index.ts', old_text: '0', new_text: '1' })
  reset([
    tool('read_file', { path: 'index.ts' }),
    edit(),
    tool('read_file', { path: 'index.ts' }),
    edit(),
    answer()
  ])
  patchMismatches = 1
  assert.match(await chat('Fix the function in this project', event, []), /Project checks:/)
  assert.equal(executions.filter((e) => e.name === 'edit_file').length, 2)
  assert.match(JSON.stringify(captured), /no file was changed/)
  assert.equal(
    latest.outcome,
    'actions_checked',
    'A corrected patch plus passing checks completes the task'
  )

  reset([tool('list_files'), write(), tool('list_files'), write(), answer()])
  missingWrites = 1
  assert.match(await chat('Fix the function in this project', event, []), /Project checks:/)
  assert.match(JSON.stringify(captured), /missing at preflight/)
  reset([write(), write(), write(), answer()])
  missingWrites = 3
  assert.match(
    await chat('Fix the function in this project', event, []),
    /Stopped after a failed action/
  )
  assert.equal(queue.length, 1)

  reset([
    tool('write_file', { path: 'index.ts', content: 'bad overwrite', overwrite: true }),
    tool('read_file', { path: 'index.ts' }),
    edit(),
    answer()
  ])
  await chat('Fix the function in this project', event, [])
  assert.equal(executions.filter((e) => e.name === 'write_file').length, 0)
  assert.match(JSON.stringify(captured), /must be patched/)

  reset(happy())
  denied = true
  assert.match(
    await chat('Implement the function in this project', event, []),
    /verification stopped.*Denied/
  )
  assert.equal(latest.outcome, 'blocked')
  assert.equal(reviews.length, 0)

  reset([tool('read_file', { path: 'index.ts' }), write(), answer(), edit(), answer()])
  checkOutcomes = [1, 0]
  assert.match(await chat('Fix the function in this project', event, []), /Project checks:/)
  assert.equal(executions.filter((e) => e.name === 'run_npm').length, 2)
  assert.match(JSON.stringify(captured), /Expected 1, got 0/)

  reset([
    tool('read_file', { path: 'index.ts' }),
    write(),
    answer(),
    edit(),
    answer(),
    edit(),
    answer()
  ])
  checkExit = 1
  assert.match(
    await chat('Fix the function in this project', event, []),
    /not verified|verification stopped/
  )
  assert.equal(executions.filter((e) => e.name === 'run_npm').length, 3)

  reset([
    tool('read_file', { path: 'Hello.java' }),
    tool('write_file', { path: 'Hello.java', content: 'class Hello {}' }),
    tool('run_command', { command: 'javac Hello.java', purpose: 'check' }),
    answer('Java compilation passed.')
  ])
  listingResult = '[file] Hello.java'
  assert.match(await chat('Fix this Java project', event, []), /javac Hello.java/)
  assert.equal(queue.length, 0)
  assert.equal(executions.filter((e) => e.name === 'run_npm').length, 0)
  assert.equal(latest.outcome, 'actions_checked')

  const invalid = () => ({
    tool_calls: [
      ...write().tool_calls,
      ...tool('edit_file', { path: 'index.ts', old_text: 'x'.repeat(65537), new_text: '1' })
        .tool_calls
    ]
  })
  reset([invalid(), tool('read_file', { path: 'index.ts' }), write(), answer()])
  await chat('Fix the function in this project', event, [])
  assert.equal(executions.filter((e) => e.name === 'write_file').length, 1)
  reset(Array.from({ length: 4 }, invalid))
  await assert.rejects(chat('Fix the function in this project', event, []), /maximum 65536/)
  assert.equal(executions.length, 0)

  reset([tool('list_files'), checkpoint(plan()), write(), new Error('Connection interrupted')])
  await assert.rejects(chat('Implement the function in this project', event, []), /interrupted/)
  assert.equal(latest.outcome, 'interrupted')
  assert.equal(latest.codingSession.revision, 1)

  reset([
    tool('list_files'),
    checkpoint(plan()),
    tool('read_file', { path: 'index.ts' }),
    tool('read_file', { path: 'other.ts' }),
    write(),
    checkpoint({ tasks: [task('implemented')] }),
    answer()
  ])
  largeRead = true
  await chat('Implement the function in this project', event, [])
  assert(latest.codingSession.compactions > 0)
  assert.match(JSON.stringify(captured.at(-1)), /Update the function/)

  const previousWindow = model.contextWindow
  model.contextWindow = 60000
  reset([
    tool('list_files'),
    tool('write_file', {
      path: 'index.html',
      content: 'WEBSITE-SOURCE-CANARY' + 'x'.repeat(60000)
    }),
    tool('write_file', { path: 'style.css', content: 'y'.repeat(60000) }),
    answer('Created the website files and checked the project.')
  ])
  await chat('Create a website in this project. Keep it accessible.', event, [])
  assert.equal(latest.codingSession.plan, '')
  assert(latest.codingSession.compactions > 0, 'Plan-free coding must compact under pressure')
  assert.equal(executions.filter((e) => e.name === 'write_file').length, 2)
  assert.match(JSON.stringify(captured.at(-1)), /Keep it accessible/)
  assert.match(JSON.stringify(captured.at(-1)), /index.html/)
  assert(
    !captured
      .at(-1)
      .some((message) =>
        message.tool_calls?.some((call) => call.function.arguments.includes('x'.repeat(1000)))
      ),
    'Checkpoint replaces full generated source in tool calls'
  )

  reset([tool('list_files'), write(), answer()])
  listingResult += '\n' + 'large directory listing\n'.repeat(6500)
  await chat('Implement the function in this project', event, [])
  assert(latest.codingSession.compactions > 0, 'A single completed batch can require cleanup')
  assert.equal(executions.filter((e) => e.name === 'write_file').length, 1)
  model.contextWindow = previousWindow

  reset(Array.from({ length: 4 }, () => answer('Everything is done.')))
  assert.match(await chat('Implement the function in this project', event, []), /incomplete/)
  assert.equal(executions.length, 0)
  reset([answer('A function maps inputs to outputs.')])
  assert.match(await chat('Explain a function', event, []), /maps inputs/)
  assert.equal(latest.codingSession, undefined)
  reset([answer('Here is the requested interactive figure.')])
  inlineVisual = true
  await chat('Create an interactive app diagram', event, [])
  assert.equal(latest.codingSession, undefined)
  console.log(
    'PASS adaptive coding loop: optional plans/review, inspect-only requests, command discovery, Java checks, patch recovery, bounded repairs, denial, follow-ups, resume, interruption and compaction'
  )
}

async function lifecycleTests() {
  const store = load('src/main/harness/store.ts', {
    electron: { app: { getPath: () => directory } },
    path,
    fs,
    crypto,
    './python': { pythonExpression: async () => JSON.stringify({ result: 3 }) }
  })
  const args = { category: 'skills', name: 'coding-example' }
  const content =
    '# Coding example\nSource: repeatable fixture checks.\nApplies to: coding.\nLimits: fixture only; no correctness guarantee.\nUse a focused edit and verify it.\n'
  await store.manageHarness({ ...args, action: 'propose', content })
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'candidate')
  await store.manageHarness({ ...args, action: 'probe' })
  await assert.rejects(store.manageHarness({ ...args, action: 'compose' }), /user approval/)
  await assert.rejects(
    store.manageHarness({ ...args, action: 'compose' }, undefined, content + 'changed'),
    /exact content/
  )
  await store.manageHarness({ ...args, action: 'compose' }, undefined, content)
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'trial')
  assert.match(store.harnessContext('coding', 'before_task'), /trial, unproven/)
  store.recordHarnessUse(args.category, args.name, 'run-1', true, 'Tests passed')
  store.recordHarnessUse(args.category, args.name, 'run-1', true, 'Same run must not count twice')
  assert.equal(store.harnessLifecycle(args.category, args.name).successes, 1)
  store.recordHarnessUse(args.category, args.name, 'run-2', true, 'Tests passed')
  store.recordHarnessUse(args.category, args.name, 'run-3', true, 'Tests passed')
  assert.equal(
    store.harnessLifecycle(args.category, args.name).state,
    'trial',
    'Execution success does not establish guidance usefulness'
  )
  store.recordHarnessUse(args.category, args.name, 'run-4', false, 'Regression')
  store.recordHarnessUse(args.category, args.name, 'run-5', false, 'Repeated regression')
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'candidate')
  assert(
    !store
      .harnessContext('coding', 'before_task')
      .includes('Automatically loaded guidance: skills/coding-example')
  )
  await store.manageHarness({ ...args, action: 'propose', content: content + 'Revised.' })
  await store.manageHarness({ ...args, action: 'probe' })
  await store.manageHarness({ ...args, action: 'compose' }, undefined, content + 'Revised.')
  assert.equal(store.harnessLifecycle(args.category, args.name).version, 2)
  await store.manageHarness({ ...args, action: 'archive' })
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'deprecated')
  await store.manageHarness({ ...args, action: 'rollback' })
  assert.equal(
    store.harnessLifecycle(args.category, args.name).state,
    'trial',
    'Rollback must not promote unproven guidance'
  )
  const rejected = { category: 'skills', name: 'discard-example' }
  await store.manageHarness({ ...rejected, action: 'propose', content })
  await store.manageHarness({ ...rejected, action: 'probe' })
  await store.manageHarness({ ...rejected, action: 'discard' })
  assert.equal(store.harnessLifecycle(rejected.category, rejected.name).state, 'discarded')
  await assert.rejects(
    store.manageHarness({ ...rejected, action: 'compose' }, undefined, content),
    /passing probe/
  )
  store.recordHarnessUse(args.category, args.name, 'trial-failed', false, 'Failed project checks')
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'candidate')
  assert.throws(() => store.readHarness(args.category, args.name, true), /quarantined/)
  await approvalTests(store, content)
  console.log(
    'PASS procedural lifecycle: candidate, exact-content approval, trial, three distinct checked uses, failure quarantine, versioned revision, deprecation, rollback and discard'
  )
}

async function approvalTests(store, content) {
  const args = { category: 'skills', name: 'approval-example' }
  await store.manageHarness({ ...args, action: 'propose', content })
  await store.manageHarness({ ...args, action: 'probe' })
  let approvals = 0,
    decision = 'allow',
    preview = '',
    executeCount = 0
  const active = { id: 'approval-run', signal: new AbortController().signal }
  const runner = load('src/main/llm/run-tool.ts', {
    '../harness/store': store,
    '../tools': {
      executeTool: async (_name, parameters, _run, scope) => {
        executeCount++
        return store.manageHarness(parameters, active.signal, scope.approvedProposal)
      }
    },
    '../permissions': {
      toolPermission: () => 'allow',
      requestApproval: async () => {
        approvals++
        return decision
      }
    },
    '../security/policy': { authorizeTool: () => {} },
    '../security/run-manager': {
      currentRun: () => active,
      assertRun: () => {},
      consumeToolBudget: () => {}
    },
    '../security/tool-contracts': contracts,
    '../security/audit': { securityEvent: () => {} },
    '../security/local-action': {
      bindLocalAction: async () => ({ preview: 'Compose', revalidate: async () => {}, scope: {} })
    },
    '../services/screen-glow': { hideScreenGlow: () => {} },
    '../settings': {
      allowApprovedTool: () => {
        throw new Error('Compose review must remain one-use')
      }
    }
  }).runTool
  const result = (
    await runner('harness_manage', { ...args, action: 'compose' }, 'compose-one', (e) => {
      if (e.type === 'tool_preview') preview = e.preview
      if (e.type === 'tool_wait') assert.equal(e.canAlwaysAllow, false)
    })
  ).text
  assert.match(result, /trial v1/)
  assert(preview.includes(content), 'Consent must show the exact candidate')
  assert.equal(approvals, 1, 'Structure-only compose asks even under Always allow')
  assert.equal(executeCount, 1)
  await store.manageHarness({ ...args, action: 'propose', content: content + 'Revision.' })
  await store.manageHarness({ ...args, action: 'probe' })
  decision = 'deny'
  assert.match(
    (await runner('harness_manage', { ...args, action: 'compose' }, 'compose-two')).text,
    /Denied/
  )
  assert.equal(executeCount, 1, 'Denied proposal cannot be composed')
  assert.equal(store.harnessLifecycle(args.category, args.name).version, 1)
}

async function main() {
  controllerTests()
  await integrationTests()
  await lifecycleTests()
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
