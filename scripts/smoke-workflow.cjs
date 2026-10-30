const { record, normalizeToolOutcome } = require('./security/action-fixture.cjs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { load } = require('./security/load.cjs')
const workflow = require('./security/workflow-load.cjs')(load)

{
  const { standaloneHtmlIssue } = load('src/main/workflow/html-check.ts', {
    parse5: require('parse5'),
    'node:vm': require('node:vm')
  })
  const document = (script) =>
    '<!DOCTYPE html><html><head><title>Test</title></head><body><canvas></canvas><script>' +
    script +
    '</script></body></html>'
  assert.equal(standaloneHtmlIssue(document('throw new Error("must never execute");')), undefined)
  assert.match(standaloneHtmlIssue(document('function ( {')), /JavaScript syntax error/)
  assert.match(standaloneHtmlIssue('<!DOCTYPE html><html>'), /incomplete/)
  assert.match(
    standaloneHtmlIssue(document('').replace('<script>', '<script src="app.js">')),
    /Linked scripts/
  )
  const { CodingVerification } = load('src/main/workflow/coding-verification.ts')
  const gate = new CodingVerification()
  record(
    gate,
    'write_file',
    { path: 'result.html' },
    'Saved result.html. Verified by reading back identical bytes.',
    'verified'
  )
  record(gate, 'list_files', { path: '.' }, '[file] result.html', 'observed')
  assert.deepEqual(gate.next(), {
    tool: 'read_file',
    args: { path: 'result.html', max_chars: 60000 }
  })
  const content = (source) =>
    JSON.stringify({ trust: 'untrusted-data', kind: 'local-file', content: source })
  record(
    gate,
    'read_file',
    { path: 'result.html', max_chars: 60000 },
    content(document('const answer = 42;')),
    'observed'
  )
  assert('done' in gate.next())
  record(
    gate,
    'read_file',
    { path: 'result.html', start_line: 1, line_count: 20 },
    JSON.stringify({ trust: 'untrusted-data', kind: 'local-file-excerpt', content: 'partial' }),
    'observed'
  )
  assert(
    'done' in gate.next(),
    'An observation excerpt does not invalidate a complete source check'
  )
  assert.match(gate.summary(), /syntax.*passed.*runtime behavior not tested/)
  record(
    gate,
    'edit_file',
    { path: 'result.html' },
    'Edited result.html. Verified by reading back identical bytes.',
    'verified'
  )
  assert.equal(gate.report().status, 'pending', 'An edit invalidates the HTML check')
  record(gate, 'list_files', { path: '.' }, '[file] result.html', 'observed')
  record(
    gate,
    'read_file',
    { path: 'result.html', max_chars: 60000 },
    content(document('function {')),
    'observed'
  )
  assert.match(gate.next().blocked, /syntax error/)
  assert(gate.requestSetupRepair())
  assert(gate.requestSetupRepair())
  assert.equal(gate.requestSetupRepair(), undefined)
}

{
  const controller = new workflow.WorkflowController(
    'absolute',
    'assistant',
    'M:\\Scratch\\project',
    'Create result.html',
    undefined,
    () => {}
  )
  const args = { path: 'M:\\Scratch\\project\\result.html', content: '<!DOCTYPE html>' }
  controller.beforeAction('write', 'write_file', args)
  controller.afterAction(
    'write',
    normalizeToolOutcome(
      'write_file',
      args,
      'Saved result.html. Verified by reading back identical bytes.'
    )
  )
  assert.deepEqual(controller.actions.paths(), ['result.html'])
  const verifier = new (load('src/main/workflow/coding-verification.ts').CodingVerification)(
    controller.actions
  )
  assert.deepEqual(verifier.next(), { tool: 'list_files', args: { path: '.' } })
}

{
  const controller = new workflow.WorkflowController(
    'recovery',
    'assistant',
    'M:/Project',
    'fix',
    undefined,
    () => {}
  )
  let next = 0
  const action = (path, result, tool = 'edit_file') => {
    const id = String(++next)
    controller.beforeAction(id, tool, { path })
    controller.afterAction(id, normalizeToolOutcome(tool, { path }, result))
    return controller.canRecover(id)
  }
  for (const path of ['a.ts', 'b.ts', 'c.ts']) {
    assert(action(path, 'Patch not applied: stale excerpt'))
    action(path, `Edited ${path}. Verified by reading back identical bytes.`)
  }
  assert(action('stuck.ts', 'Patch not applied: stale excerpt'))
  action('other.ts', 'Edited other.ts. Verified by reading back identical bytes.')
  assert(action('stuck.ts', 'Patch not applied: stale excerpt'))
  action('other.ts', 'Edited other.ts. Verified by reading back identical bytes.')
  assert.equal(action('stuck.ts', 'Patch not applied: stale excerpt'), false)
  assert.equal(controller.snapshot().outcome, 'needs_review')
}
{
  const { LoopBudgets } = load('src/main/workflow/loop-budgets.ts')
  const budget = new LoopBudgets()
  for (const kind of ['session', 'gate', 'arguments', 'completion', 'protocol']) budget.fail(kind)
  budget.progress('file-read')
  assert.equal(budget.count('session'), 1)
  assert.equal(budget.count('gate'), 0)
  budget.progress('checkpoint')
  assert.equal(budget.count('session'), 0)
  assert.equal(budget.count('arguments'), 1)
  budget.progress('arguments')
  assert.equal(budget.count('arguments'), 0)
  assert.equal(budget.count('completion'), 1)
  assert.equal(budget.count('protocol'), 1)
  for (let i = 0; i < 3; i++)
    assert.equal(
      budget.recover('click', '', normalizeToolOutcome('click', {}, 'Screenshot required: stale')),
      i < 2
    )
  assert.equal(
    budget.recover('edit_file', 'a', normalizeToolOutcome('edit_file', {}, 'Denied by user')),
    false
  )
}
const validation = load('src/main/workflow/results.ts')
{
  const controller = new workflow.WorkflowController(
    'readback',
    'assistant',
    '',
    'play music',
    undefined,
    () => {}
  )
  controller.beforeAction('act', 'act_on_control', { action: 'invoke' })
  controller.afterAction(
    'act',
    normalizeToolOutcome(
      'act_on_control',
      { action: 'invoke' },
      'Unverified: provider returned no state'
    )
  )
  assert(controller.canRecover('act'))
  assert.throws(
    () => controller.beforeAction('replay', 'act_on_control', { action: 'invoke' }),
    /Inspect/
  )
  controller.beforeAction('read', 'inspect_app', { window: 'fixture' })
  controller.afterAction(
    'read',
    normalizeToolOutcome('inspect_app', {}, 'Observed current controls')
  )
  assert.equal(controller.snapshot().evidence[0].status, 'uncertain')
  controller.finish()
  assert.equal(controller.snapshot().outcome, 'needs_review')
}
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const schemas = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schemas })
const model = {
  contextWindow: 32000,
  maxTokens: 512,
  visualMaxTokens: 8192,
  historyTurns: 0,
  maxSteps: 6
}
let run = { modelCalls: 0, id: 'run-1', mode: 'assistant', workspace: 'M:\\Project', tools: 0 }
let latest
let queue = []
let captured = []
let volatile = []
let offered = []
let executions = []
let toolResult = 'Opened Notepad'
let toolHandler
let cancelled = false
const chat = load('src/main/llm/chat.ts', {
  ...require('./security/harness-fixture.cjs')(load),
  '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
  './specialists': {},
  crypto,
  '../settings': { getSettings: () => ({ model }) },
  '../services/attachments': { attachmentContent: async () => [] },
  './prompt': { buildSystemPrompt: () => 'Fixture assistant' },
  './client': {
    getModel: async () => 'fixture',
    callLLM: async (_id, messages, options) => {
      run.modelCalls = (run.modelCalls ?? 0) + 1
      captured.push(messages)
      volatile.push(options?.volatile ?? '')
      offered.push((options?.tools ?? []).map((tool) => tool.function.name))
      assert(queue.length, 'Unexpected model call')
      const reply = queue.shift()
      if (reply instanceof Error) throw reply
      return reply
    }
  },
  './run-tool': {
    runTool: async (name, args) => {
      executions.push(name)
      if (toolHandler) return toolHandler(name, args)
      return toolResult
    }
  },
  './visuals': { wantsVisual: () => false, truncatedReply: (value) => value },
  './visual-reply': {},
  './visual-routing': { needsVisualTools: () => false },
  '../security/run-manager': {
    currentRun: () => run,
    assertRun: () => {
      if (cancelled) throw new Error('Stopped fixture')
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
const event = (e) => {
  if (e.type === 'workflow') latest = e.state
}
const tool = (name, args = {}, id = 'call-one') => ({
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
})
const answer = (content) => ({ content })
function reset(replies) {
  run.modelCalls = 0
  run.modelCallLimit = undefined
  latest = undefined
  captured = []
  volatile = []
  offered = []
  executions = []
  queue = replies
}

async function review() {
  run = { ...run, mode: 'assistant' }
  const questions = [
    {
      title: 'What would you like to make around the double-slit experiment?',
      options: ['Interactive simulation', 'Educational explanation', 'Research project']
    }
  ]
  reset([tool('ask_questions', { questions })])
  const clarification = await chat(
    'I would like to start a new project around the double slit experiment.',
    event,
    []
  )
  assert.match(clarification, /^```sophon-questions\n/)
  assert.deepEqual(JSON.parse(clarification.split('\n')[1]), questions)
  assert.deepEqual(executions, [], 'Clarification must not execute desktop actions')
  assert.equal(captured.length, 1, 'Questions should await the user without another model call')
  assert(JSON.stringify(captured[0]).includes('instead of ending with a prose questionnaire'))
  reset([answer('The calculation tool is unavailable.')])
  await chat('Use unavailable_tool to calculate 17 * 23; do not use another tool.', event, [])
  assert(JSON.stringify(captured[0]).includes('Available tools for THIS request: none'))
  assert.deepEqual(executions, [])
  reset([
    tool('read_file', { path: 'project-notes.txt', unexpected: true }),
    tool('read_file', { path: 'project-notes.txt' }),
    answer('Read the project notes.')
  ])
  toolResult = 'Project: ORION'
  await chat('Read project-notes.txt', event, [])
  assert.deepEqual(executions, ['read_file'], 'Invalid arguments must be repaired before execution')
  assert(JSON.stringify(captured[1]).includes('did not match its argument schema'))
  run = { ...run, mode: 'assistant' }
  for (const result of ['Denied by the user.', 'Blocked: rule']) {
    reset([tool('open_app', { name: 'notepad' })])
    toolResult = result
    const reply = await chat('Open Notepad', event, [])
    assert.match(reply, /Stopped after a denied action/)
    assert.equal(captured.length, 1)
    assert.notEqual(latest.outcome, 'actions_checked')
    assert.equal(latest.evidence.length, 1)
  }
  // Failed or uncertain results go back to the model to diagnose instead of ending the task.
  for (const result of [
    'Failed to open Notepad',
    'No window matching target',
    'Windows refused to move target',
    'Unverified: bytes differ'
  ]) {
    reset([tool('open_app', { name: 'notepad' }), answer('Notepad could not be confirmed open.')])
    toolResult = result
    const reply = await chat('Open Notepad', event, [])
    assert.equal(reply, 'Notepad could not be confirmed open.')
    assert.equal(captured.length, 2)
    assert(
      captured[1].some((m) => m.role === 'system' && /not a reason to stop/.test(String(m.content)))
    )
    assert.notEqual(latest.outcome, 'actions_checked')
    assert.equal(latest.evidence.length, 1)
  }
  reset([
    tool('open_app', { name: 'notepad' }),
    tool('open_app', { name: 'notepad' }, 'call-two'),
    tool('open_app', { name: 'notepad' }, 'call-three')
  ])
  toolResult = 'Failed to open Notepad'
  assert.match(await chat('Open Notepad', event, []), /Stopped after a failed action/)
  assert.equal(executions.length, 3, 'General failure recovery is bounded to two attempts')
  reset([
    answer('Opened Notepad.'),
    tool('open_app', { name: 'notepad' }),
    answer('Opened Notepad.')
  ])
  toolResult = 'Opened Notepad'
  await chat('Open Notepad', event, [])
  assert.equal(captured.length, 3)
  assert.deepEqual(executions, ['open_app'])
  assert.equal(latest.evidence[0].status, 'reported')
  assert.equal(latest.outcome, 'needs_review')
  assert.equal(latest.evidence[0].runId, 'run-1')
  const checkpoint = structuredClone(latest)
  assert(validation.unsupportedCompletion('Opened Calculator.', checkpoint.evidence, 'run-1'))
  reset([answer('Opened Notepad.'), answer('Opened Notepad.')])
  assert.match(await chat('Open Notepad', event, []), /could not verify/)
  assert.equal(captured.length, 2)
  assert.deepEqual(executions, [])
  assert.equal(latest.outcome, 'needs_review')
  reset([answer('Done.'), answer('Done.')])
  assert.match(await chat('Open Notepad', event, []), /could not verify/)

  // A plain single-intent command finishes from the host-confirmed result
  // without a second, confirmation-only model call.
  reset([tool('open_app', { name: 'notepad' })])
  toolResult = 'Opened Notepad. Window: win-00000000-0000-0000-0000-000000000000 "Untitled".'
  assert.equal(await chat('Open Notepad', event, []), 'Opened Notepad.')
  assert.equal(captured.length, 1)
  assert.deepEqual(executions, ['open_app'])
  const system = captured[0][0].content
  assert.match(volatile[0], /^RUN STATE \(refreshed every model call\): \{"remaining":/)
  assert(!/RUN STATE \(refreshed/.test(system), 'Per-call budgets stay out of the system message')
  reset([tool('focus_window', { window: 'win-1' }), answer('Focused it.')])
  toolResult = 'Focus request sent but not confirmed.'
  await chat('Focus Notepad', event, [])
  assert.equal(captured.length, 2, 'Unconfirmed results still go back to the model')
  reset([tool('open_app', { name: 'notepad' }), answer('Opened Notepad and checked it.')])
  toolResult = 'Opened Notepad. Window: win-00000000-0000-0000-0000-000000000000 "Untitled".'
  await chat('Open Notepad then tell me its title', event, [])
  assert.equal(captured.length, 2, 'Multi-step requests keep the model in the loop')

  // A short confirmation continues the earlier request: its tools stay loaded,
  // and a reply that only claims the action is sent back once to take it.
  model.historyTurns = 4
  reset([
    answer('Clearing the entire chat now.'),
    tool('clear_chat'),
    answer('The chat will be cleared.')
  ])
  toolResult = 'Approved. The chat will be cleared as soon as this reply ends.'
  const earlier = [
    [
      { role: 'user', content: 'Can you clear this chat?' },
      { role: 'assistant', content: 'Please confirm: do you want me to clear this entire chat?' }
    ]
  ]
  await chat('go', event, earlier)
  assert(offered[0].includes('clear_chat'), 'Follow-up keeps the previous request tools')
  assert.match(JSON.stringify(captured[1]), /described a next step but did not take it/)
  assert.deepEqual(executions, ['clear_chat'])
  model.historyTurns = 0
  const quality = load('src/shared/reply-quality.ts')
  for (const text of [
    'Clearing the entire chat now.',
    'I’ll clear this entire chat now.',
    'Sure, deleting the file now.'
  ])
    assert(quality.announcesNextStep(text), text)
  for (const text of [
    'Nothing is pending now.',
    'The chat is cleared now.',
    'Should I clear it now?'
  ])
    assert(!quality.announcesNextStep(text), text)

  const args = { path: 'notes.txt', content: 'abc' }
  toolResult = 'Saved notes.txt (3 bytes). Verified by reading back identical bytes.'
  reset([tool('write_file', args), answer('Saved notes.txt.')])
  toolHandler = (name) => {
    if (name === 'list_files') return '[file] package.json'
    if (name === 'read_file')
      return envelope.untrustedData(
        'local-file',
        'package.json',
        JSON.stringify({ scripts: { test: 'node test.cjs' } })
      )
    if (name === 'run_npm') return JSON.stringify({ exitCode: 0, stopped: false })
    return toolResult
  }
  await chat('Create notes.txt', event, [])
  toolHandler = undefined
  assert.equal(latest.outcome, 'actions_checked')
  assert.equal(latest.evidence[0].status, 'verified')
  assert.equal(validation.unsupportedCompletion('I wrote a document below.', [], run.id), undefined)
  assert(
    validation.unsupportedCompletion(
      'Saved notes.txt.',
      [{ ...latest.evidence[0], target: 'other-notes.txt' }],
      run.id
    )
  )
  assert.equal(
    validation.unsupportedCompletion(
      'Saved notes.txt.',
      [{ ...latest.evidence[0], target: 'folder/notes.txt' }],
      run.id
    ),
    undefined
  )
  assert.equal(
    validation.assessResult('write_file', { ...args, content: 'different' }, toolResult).status,
    'uncertain'
  )
  assert.equal(
    validation.assessResult('read_file', {}, JSON.stringify({ content: toolResult })).status,
    'observed'
  )
  assert.equal(
    validation.unsupportedCompletion('Example:\n```text\nSaved notes.txt.\n```', [], run.id),
    undefined
  )

  run = { ...run, id: 'run-2' }
  reset([tool('list_windows'), answer('The current window list is available.')])
  toolResult = 'Windows: Notepad'
  await chat('Continue the previous task.', event, [], [], 'chat-id', checkpoint)
  assert.equal(latest.goal, 'Open Notepad')
  assert.equal(latest.id, checkpoint.id)
  assert.deepEqual(executions, ['list_windows'], 'Resume must not replay the old open action')
  assert(JSON.stringify(captured[0]).includes('originalGoal'))
  assert(JSON.stringify(captured[0]).includes('historical'))
  assert(!JSON.stringify(captured[0]).includes('M:\\\\Project'))
  const resumeBlocked = { ...checkpoint, outcome: 'blocked' }
  assert.equal(
    new workflow.WorkflowController(
      'next',
      'assistant',
      run.workspace,
      'Continue the previous task.',
      resumeBlocked,
      () => {}
    ).resumed,
    true
  )
  assert.equal(
    new workflow.WorkflowController(
      'next',
      'assistant',
      'M:\\Other',
      'Continue the previous task.',
      checkpoint,
      () => {}
    ).resumed,
    false
  )
  assert.equal(
    new workflow.WorkflowController(
      'next',
      'assistant',
      run.workspace,
      'Explain gravity',
      checkpoint,
      () => {}
    ).resumed,
    false
  )

  run = { ...run, mode: 'assistant' }
  reset([tool('open_app', { name: 'notepad' }), new Error('Model disconnected')])
  toolResult = 'Opened Notepad'
  await assert.rejects(chat('Open Notepad', event, []), /disconnected/)
  assert.equal(latest.outcome, 'interrupted')
  assert.equal(latest.evidence[0].status, 'reported')

  model.historyTurns = 3
  const interruptedHistory = []
  reset([tool('open_app', { name: 'notepad' }), new Error('Disconnected')])
  await assert.rejects(chat('Open Notepad', event, interruptedHistory), /Disconnected/)
  const interruptedCheckpoint = structuredClone(latest)
  assert.equal(interruptedHistory.length, 1)
  assert(interruptedHistory[0].some((message) => message.role === 'tool'))
  run = { ...run, id: 'run-continued' }
  reset([answer('The earlier request opened Notepad; ready to continue.')])
  await chat('Keep going', event, interruptedHistory, [], 'chat-id', interruptedCheckpoint)
  assert.equal(latest.id, interruptedCheckpoint.id)
  assert.equal(latest.goal, 'Open Notepad')
  assert.equal(captured.length, 1, 'Continuation needs no reconstruction call')
  assert.deepEqual(executions, [])
  assert(JSON.stringify(captured[0]).includes('Opened Notepad'))
  for (const text of [
    'go',
    'Go!',
    'Resume the response.',
    'Pick up where we left off',
    'Continue, keep it concise'
  ])
    assert(workflow.isContinuation(text), text)
  for (const text of ['Continue writing a new poem', 'Explain gravity'])
    assert(!workflow.isContinuation(text), text)
  model.historyTurns = 0

  let pending
  const controller = new workflow.WorkflowController(
    'r',
    'assistant',
    run.workspace,
    'Goal with exact constraints: do not overwrite.',
    undefined,
    (s) => {
      pending = s
    }
  )
  for (let i = 0; i < 20; i++) {
    controller.beforeAction('a-' + i, 'list_windows', {})
    controller.afterAction('a-' + i, normalizeToolOutcome('list_windows', {}, 'Windows data'))
  }
  assert.equal(pending.evidence.length, 16)
  assert.equal(pending.omittedEvidence, 4)
  assert(controller.context().length < 2200)
  controller.beforeAction('pending-action', 'write_file', args)
  const interrupted = workflow.interruptedWorkflow(pending)
  assert.equal(interrupted.evidence.at(-1).status, 'uncertain')
  assert(workflow.validWorkflow(interrupted))
  assert(!workflow.validWorkflow({ ...interrupted, phase: ['finished'] }))
  assert(
    !workflow.validWorkflow({ ...interrupted, evidence: Array(17).fill(interrupted.evidence[0]) })
  )

  let disk = Buffer.from(
    JSON.stringify({
      activeId: 'a0000000-0000-4000-8000-000000000001',
      chats: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          mode: 'desktop',
          title: 'Task',
          updatedAt: Date.now(),
          items: [],
          history: [],
          workflow: { ...pending, mode: 'research' }
        }
      ]
    })
  )
  const files = new Map([[path.join('fixture', 'chats.json'), disk]])
  const store = load('src/main/chat/store.ts', {
    fs: { existsSync: (file) => files.has(file), unlinkSync: (file) => files.delete(file) },
    './action-details': { archiveAction: () => {} },
    electron: { app: { getPath: () => 'fixture' } },
    crypto,
    path,
    '../services/attachments': { purgeAttachments: () => {} },
    '../security/private-store': {
      readPrivate: (file) => files.get(file),
      writePrivate: (_file, bytes) => {
        files.set(_file, bytes)
      }
    },
    '../workflow/controller': workflow
  })
  const restored = store.loadConversations()
  assert.equal(restored.chats[0].mode, 'assistant')
  assert.equal(restored.chats[0].workflow.mode, 'assistant')
  assert.equal(restored.chats[0].workflow.outcome, 'interrupted')
  assert.equal(restored.chats[0].workflow.evidence.at(-1).status, 'uncertain')
  store.persistConversations(restored)
  assert.equal(store.loadConversations().chats[0].workflow.goal, pending.goal)
  const bodyPath = [...files.keys()].find(
    (file) =>
      file.includes('conversations') && file.endsWith('.json') && !file.endsWith('index.json')
  )
  const body = JSON.parse(files.get(bodyPath).toString('utf8'))
  body.workflow.mode = 'research'
  files.set(bodyPath, Buffer.from(JSON.stringify(body)))
  const migrated = store.loadConversations().chats[0]
  assert.equal(migrated.workflow.mode, 'assistant')
  assert.equal(migrated.workflow.goal, pending.goal)
  body.workflow = 'damaged'
  files.set(bodyPath, Buffer.from(JSON.stringify(body)))
  assert.equal(store.loadConversations().chats[0].workflow, undefined)

  console.log(
    'PASS result categories, unsupported completion repair/fallback, exact constraints, scoped resume with zero history, legacy mode migration, interruption/reload and bounded evidence'
  )
  await require('./security/workflow-native.cjs')({ load })
  const write = { path: 'src/page.tsx', content: 'fixture' }
  let builds = 0
  let failUntil = 1
  let scripts = { build: 'next build', test: 'node test.cjs' }
  let denied = false
  const checked = []
  toolHandler = (name, args) => {
    if (name === 'write_file')
      return `Saved ${args.path} (${Buffer.byteLength(args.content)} bytes). Verified by reading back identical bytes.`
    if (name === 'list_files') return args.path === '.' ? '[file] package.json' : '[file] page.tsx'
    if (name === 'read_file')
      return envelope.untrustedData('local-file', args.path, JSON.stringify({ scripts }))
    if (name === 'run_npm') {
      checked.push(args.args[1])
      if (denied) return 'Denied by the user.'
      const exitCode = args.args[1] === 'build' && ++builds <= failUntil ? 1 : 0
      return JSON.stringify({
        exitCode,
        stopped: false,
        output: {
          trust: 'untrusted-data',
          content: exitCode ? 'Type error in src/page.tsx' : 'passed'
        }
      })
    }
    throw new Error('Unexpected coding tool ' + name)
  }
  reset([
    tool('write_file', write),
    answer('Done.'),
    tool('write_file', { ...write, content: 'fixed' }),
    answer('Fixed.')
  ])
  const repaired = await chat('Fix the React code', event, [])
  assert.match(repaired, /Project checks:/)
  assert.match(repaired, /build.*passed/)
  assert.deepEqual(
    checked,
    ['test', 'build', 'test', 'build'],
    'Any edit invalidates all earlier passing checks'
  )
  assert.equal(latest.outcome, 'actions_checked')
  assert(JSON.stringify(captured).includes('Project verification failed'))
  const codingCheckpoint = structuredClone(latest)
  codingCheckpoint.evidence = []
  codingCheckpoint.omittedEvidence = 30
  checked.length = 0
  reset([answer('Continued.')])
  await chat('Continue', event, [], [], '', codingCheckpoint)
  assert.deepEqual(checked, ['test', 'build'], 'Resume rechecks, never trusts historical passes')
  builds = 0
  failUntil = Infinity
  checked.length = 0
  reset([tool('write_file', write), answer('Done.'), answer('Done.'), answer('Done.')])
  assert.match(await chat('Fix the React code', event, []), /Repair limit reached/)
  assert.equal(builds, 3)
  assert.equal(latest.outcome, 'needs_review')
  denied = true
  checked.length = 0
  reset([tool('write_file', write), answer('Done.')])
  assert.match(await chat('Fix the React code', event, []), /not verified.*Denied/)
  assert.equal(checked.length, 1, 'Denial stops without another check or repair')
  assert.equal(latest.outcome, 'blocked')
  denied = false
  scripts = {}
  checked.length = 0
  reset([tool('write_file', write), answer('Done.'), answer('Done.'), answer('Done.')])
  assert.match(await chat('Fix the React code', event, []), /No supported verification scripts/)
  assert.equal(
    captured.filter((messages) =>
      messages.some(
        (message) =>
          typeof message.content === 'string' && message.content.includes('Setup repair 2 of 2')
      )
    ).length > 0,
    true
  )
  assert.equal(checked.length, 0)
  assert.equal(latest.outcome, 'needs_review')
  toolHandler = undefined
  const { CodingVerification } = load('src/main/workflow/coding-verification.ts')
  const { codingMutation } = load('src/main/workflow/coding-mutation.ts')
  for (const path of ['ui/App.vue', 'ui/App.svelte', 'server/Program.cs', 'project/unknown.ext']) {
    for (const tool of ['write_file', 'edit_file', 'delete_file']) {
      assert.equal(codingMutation(tool, { path }), true)
      const changed = new CodingVerification()
      record(changed, tool, { path }, 'saved', 'verified')
      assert.equal(changed.active, true)
      assert.deepEqual(changed.next(), { tool: 'list_files', args: { path: path.split('/')[0] } })
    }
  }
  const commandGate = new CodingVerification()
  record(
    commandGate,
    'run_command',
    { path: 'project', purpose: 'change' },
    '{"exitCode":0}',
    'verified'
  )
  assert.equal(commandGate.active, true, 'The first change command activates verification')
  assert.deepEqual(commandGate.next(), { tool: 'list_files', args: { path: 'project' } })
  for (const status of ['failed', 'denied', 'uncertain']) {
    const ignored = new CodingVerification()
    record(ignored, 'edit_file', { path: 'App.vue' }, 'not saved', status)
    assert.deepEqual(
      ignored.next(),
      status === 'uncertain' ? { tool: 'list_files', args: { path: '.' } } : { done: true }
    )
  }
  const partialGate = new CodingVerification()
  partialGate.resume(['index.ts'])
  record(partialGate, 'list_files', { path: '.' }, '[file] package.json', 'observed')
  record(
    partialGate,
    'read_file',
    { path: 'package.json', start_line: 1, line_count: 1 },
    envelope.untrustedData(
      'local-file-excerpt',
      'package.json',
      '{"scripts":{"test":"node test.js"}}'
    ),
    'observed'
  )
  assert.deepEqual(
    partialGate.next(),
    { tool: 'read_file', args: { path: 'package.json' } },
    'An excerpt must not satisfy full manifest discovery'
  )
  const gate = new CodingVerification()
  const manifest = (scripts, dependencies = {}) =>
    envelope.untrustedData(
      'local-file',
      'apps/web/package.json',
      JSON.stringify({ scripts, dependencies })
    )
  gate.resume(['apps/web/page.tsx'])
  record(gate, 'list_files', { path: 'apps/web' }, '[file] package.json', 'observed')
  record(
    gate,
    'read_file',
    { path: 'apps/web/package.json' },
    manifest({ lint: 'eslint .' }, { next: '16' }),
    'observed'
  )
  assert.match(gate.next().blocked, /no build script/)
  assert.match(gate.requestSetupRepair(), /Setup repair 1 of 2/)
  assert.match(gate.requestSetupRepair(), /Setup repair 2 of 2/)
  assert.equal(gate.requestSetupRepair(), undefined, 'Setup repair cannot loop forever')
  record(
    gate,
    'read_file',
    { path: 'apps/web/package.json' },
    manifest({ lint: 'eslint .', build: 'next build' }, { next: '16' }),
    'observed'
  )
  assert.deepEqual(gate.next(), {
    tool: 'run_npm',
    args: { path: 'apps/web', args: ['run', 'lint'] }
  })
  for (let i = 0; i < 2; i++) {
    record(
      gate,
      'read_file',
      { path: 'apps/web/package.json' },
      manifest({ build: 'next build' }),
      'observed'
    )
    assert.match(
      gate.next().blocked,
      /lint was removed/,
      'Rereading a weakened manifest cannot erase required checks'
    )
  }
  console.log(
    'PASS enforced coding loop: automatic checks, failure diagnostics, repair, stale-pass invalidation, resume, hard retry cap, denied execution and missing checks'
  )
}
review().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
