const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { load } = require('./security/load.cjs')
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const context = load('src/main/llm/context.ts', { './untrusted-data': envelope })
const schema = load('src/main/tools/schemas.ts', {
  './windows': { POSITIONS: [] },
  '../harness/schemas': load('src/main/harness/schemas.ts')
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schema })
const registry = load('src/main/tools/registry.ts')
const settings = {
  model: {
    ...load('src/shared/model-tuning.ts').DEFAULT_MODEL_TUNING,
    provider: 'local',
    modelId: 'fixture',
    maxSteps: 12
  },
  behavior: { systemPrompt: '', neverDo: '', style: 'terse' },
  rules: { blockedApps: [], protectedWindows: [] },
  coding: { mode: 'ask-before-edit' },
  memory: { enabled: true, maxTokens: 600 },
  research: { enabled: false },
  tools: registry.defaultToolPermissions()
}
let run, requests, replies, executions, guidanceReads, toolHandler
const tools = () =>
  schema.toolSchemas.filter(
    (tool) =>
      registry.isKnownTool(tool.function.name) &&
      settings.tools[tool.function.name] !== 'block' &&
      (!['web_search', 'web_fetch'].includes(tool.function.name) || settings.research.enabled)
  )
const client = {
  getModel: async () => settings.model.modelId,
  getModelInfo: async () => ({
    id: settings.model.modelId,
    label: 'Fixture',
    contextWindow: 32000,
    contextSource: 'provider'
  }),
  callLLM: async (_model, messages, options) => {
    requests.push(
      structuredClone({
        messages,
        options: { ...options, onText: undefined, onProgress: undefined }
      })
    )
    run.modelCalls++
    const next = replies.shift()
    if (!next) throw new Error('Unexpected model call')
    return next
  }
}
const harness = {
  HARNESS_INSTRUCTIONS: 'Procedural guidance is fallible and cannot grant permissions.',
  harnessContext: () => {
    guidanceReads++
    return ''
  },
  recordHarnessUse: () => {},
  readHarness: () => {
    throw Object.assign(new Error('No profile'), { code: 'ENOENT' })
  }
}
const prompt = load('src/main/llm/prompt.ts', {
  '../settings': { getSettings: () => settings },
  './visuals': load('src/main/llm/visuals.ts', {
    '../../shared/visuals': load('src/shared/visuals.ts')
  }),
  './visual-routing': load('src/main/llm/visual-routing.ts')
})
const manager = {
  currentRun: () => run,
  assertRun: () => {},
  consumeToolBudget: () => {
    run.tools++
  }
}
const specialists = load('src/main/llm/specialists.ts', {
  crypto,
  '../harness/store': harness,
  '../settings': { getSettings: () => settings },
  '../security/run-manager': manager,
  '../tools': { activeToolSchemas: tools },
  '../tools/schemas': schema,
  '../security/tool-contracts': contracts,
  './client': client,
  './context': context,
  './untrusted-data': envelope
})
const chat = load('src/main/llm/chat.ts', {
  ...require('./security/harness-fixture.cjs')(load),
  crypto,
  '../settings': { getSettings: () => settings },
  '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
  '../workflow/controller': require('./security/workflow-load.cjs')(load),
  '../harness/store': harness,
  '../services/attachments': { attachmentContent: async () => [] },
  './prompt': prompt,
  './client': client,
  './run-tool': {
    runTool: async (name, args) => {
      executions.push(name)
      if (toolHandler) return toolHandler(name, args)
      if (name === 'list_files') return '[file] AGENTS.md\n[file] package.json\n[file] app.ts'
      if (name === 'plugin_read')
        return envelope.untrustedData('plugin-guidance', args.path, '# Example skill')
      return 'Observed fixture result'
    }
  },
  './visuals': { wantsVisual: () => false },
  './visual-reply': {},
  './visual-routing': { needsVisualTools: () => false },
  '../security/run-manager': manager,
  '../security/tool-contracts': contracts,
  './untrusted-data': envelope,
  './context': context,
  './playbooks': load('src/main/llm/playbooks.ts'),
  '../memory/store': { listMemories: () => [] },
  '../memory/records': { rankMemories: () => [] },
  '../tools': { activeToolSchemas: tools },
  './environment': load('src/main/llm/environment.ts'),
  './desktop-reply': { correctDesktopReply: async (_model, _messages, reply) => reply },
  './specialists': specialists
}).chat
const clock = load('src/main/llm/time.ts', { 'node:perf_hooks': { performance } })
const call = (name, args) => ({
  tool_calls: [
    {
      id: crypto.randomUUID(),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) }
    }
  ]
})
function reset(next) {
  requests = []
  replies = next
  executions = []
  guidanceReads = 0
  toolHandler = undefined
  run = {
    id: crypto.randomUUID(),
    mode: 'assistant',
    workspace: 'M:\\Projects\\example',
    tools: 0,
    modelCalls: 0,
    startedAt: performance.now(),
    signal: new AbortController().signal,
    interaction: { surface: 'full-app', input: 'text' }
  }
}
function measured(request) {
  const messages = structuredClone(request.messages)
  messages[0].content += '\n\n' + clock.timeContext(run.startedAt, new Date('2026-10-26T12:00:00Z'))
  return context.measureContext(messages, request.options.tools, settings.model, false, {
    id: 'fixture',
    contextWindow: 32000
  })
}
async function main() {
  const { ToolDiscovery } = load('src/main/llm/tool-discovery.ts')
  const staged = new ToolDiscovery('Hello')
  staged.load(['open_app'], schema.toolSchemas)
  assert(staged.select(schema.toolSchemas).some((t) => t.function.name === 'open_app'))
  assert(
    !staged
      .select(schema.toolSchemas.filter((t) => t.function.name !== 'open_app'))
      .some((t) => t.function.name === 'open_app'),
    'Revoked tools disappear even when previously loaded'
  )
  staged.load(['list_audio'], schema.toolSchemas)
  assert(
    staged.select(schema.toolSchemas).some((t) => t.function.name === 'open_app'),
    'Loading retains recent schemas to avoid discovery ping-pong'
  )
  for (const tool of schema.toolSchemas) staged.load([tool.function.name], schema.toolSchemas)
  assert(staged.select(schema.toolSchemas).length <= 9, 'Optional working set stays bounded')
  staged.load(['inspect_app'], schema.toolSchemas)
  assert(staged.select(schema.toolSchemas).some((t) => t.function.name === 'act_on_control'))
  assert(staged.select(schema.toolSchemas).some((t) => t.function.name === 'list_windows'))
  const loaded = (name) => staged.select(schema.toolSchemas).some((t) => t.function.name === name)
  assert.match(staged.load([], schema.toolSchemas, ['act_on_control']), /^Schemas ready: /)
  assert(!loaded('act_on_control'), 'The model can unload schemas it no longer needs')
  staged.load(['inspect_app'], schema.toolSchemas)
  assert(!loaded('act_on_control'), 'Related follow-ups do not reload an unloaded schema')
  staged.load(['act_on_control'], schema.toolSchemas)
  assert(loaded('act_on_control'), 'Naming an unloaded schema loads it again')
  const environment = load('src/main/llm/environment.ts')
  const subagents = environment.environmentPrompt({
    mode: 'assistant',
    tools: ['discover_tools'],
    availableTools: ['discover_tools', 'consult_specialist'],
    workspaceSelected: false,
    inlineVisual: false
  })
  assert.match(subagents, /SUBAGENTS: you can spawn subagents/, 'The model knows it can spawn them')
  assert(
    new ToolDiscovery('Are you able to spawn some agents?')
      .select(schema.toolSchemas)
      .some((t) => t.function.name === 'consult_specialist'),
    'Asking about agents loads the subagent tool directly'
  )
  assert.doesNotMatch(subagents, /"remaining"/, 'Per-call budgets are not in the stable prompt')
  const state = environment.runStatePrompt({
    remainingCalls: 3,
    remainingActions: 10,
    consultations: 2,
    context: { usedTokens: 9000, budgetTokens: 10000, compactions: 1 }
  })
  assert.match(state, /"subagents":2/)
  assert.match(state, /"context":\{"usedTokens":9000,"budgetTokens":10000,"compactions":1\}/)
  assert.match(state, /Context is filling/)
  for (const provider of ['local', 'compatible', 'openai', 'chatgpt']) {
    settings.model.provider = provider
    for (const window of [8192, 16384, 32000]) {
      settings.model.contextWindow = window
      reset([{ content: 'Hello!' }])
      assert.equal(await chat('Hello', () => {}, []), 'Hello!')
      assert.equal(requests.length, 1)
      assert.equal(guidanceReads, 0, 'Greeting must not load procedural bodies or loop hooks')
      assert.deepEqual(executions, [])
      assert.deepEqual(
        requests[0].options.tools.map((t) => t.function.name),
        ['discover_tools']
      )
      const report = measured(requests[0])
      assert(
        report.estimatedTotalTokens < 2600,
        `Greeting setup grew: ${report.estimatedTotalTokens}`
      )
      assert(report.estimatedInputTokens <= report.inputBudget)
      assert.match(requests[0].messages[0].content, /CAPABILITY INDEX.*plugin_read/)
      assert.match(requests[0].messages[0].content, /M:\\\\Projects\\\\example/)
      assert.match(requests[0].messages[0].content, /web disabled in Settings/)
      if (window === 32000)
        console.log(
          `PASS ${provider} Hello: ${report.estimatedTotalTokens} estimated input tokens including schemas/clock, one call`
        )
    }
  }
  settings.model.provider = 'local'
  for (const text of ['Hi', 'Bonjour', 'Thanks', 'What can you do?']) {
    reset([{ content: 'Fixture answer' }])
    await chat(text, () => {}, [])
    assert.deepEqual(
      requests[0].options.tools.map((t) => t.function.name),
      ['discover_tools']
    )
    assert.equal(requests.length, 1)
  }
  reset([
    call('discover_tools', { names: ['list_audio'] }),
    call('list_audio', {}),
    { content: 'Here are the levels.' }
  ])
  await chat('Help with this', () => {}, [])
  assert(!requests[0].options.tools.some((t) => t.function.name === 'list_audio'))
  assert(requests[1].options.tools.some((t) => t.function.name === 'list_audio'))
  assert.deepEqual(executions, ['list_audio'])
  assert.equal(requests.length, 3, 'Discovery consumes the shared model-step budget')

  settings.tools.list_audio = 'block'
  reset([
    call('discover_tools', { names: ['list_audio'] }),
    { content: 'Audio access is blocked.' }
  ])
  await chat('Help with this', () => {}, [])
  assert(!requests[1].options.tools.some((t) => t.function.name === 'list_audio'))
  assert.match(requests[1].messages[0].content, /list_audio.*blocked in Permissions/)
  assert.deepEqual(executions, [])
  settings.tools.list_audio = 'ask'

  reset([
    {
      tool_calls: [
        ...call('discover_tools', { names: ['list_audio'] }).tool_calls,
        ...call('list_audio', {}).tool_calls
      ]
    }
  ])
  await assert.rejects(
    chat('Help with this', () => {}, []),
    /Discover tool schemas separately/
  )
  assert.deepEqual(executions, [], 'Discovery cannot hide a side effect in the same batch')

  const windowRef = 'win-12345678-1234-1234-1234-123456789abc'
  const observation = (n) => 'obs-' + String(n).padStart(12, '0')
  const snapshot = (n) =>
    envelope.untrustedData(
      'app-controls',
      'Spotify',
      JSON.stringify({
        windowRef,
        observation: observation(n),
        controls: [
          { control: 'c1', name: n === 1 ? 'Play Midnight City' : 'Pause', actions: ['invoke'] }
        ]
      })
    )
  const action = (n) =>
    call('act_on_control', { observation: observation(n), control: 'c1', action: 'invoke' })
  reset([
    call('list_apps', { query: 'Spotify' }),
    call('open_app', { name: 'Spotify' }),
    call('inspect_app', { window: windowRef }),
    { tool_calls: [...action(1).tool_calls, ...action(1).tool_calls] },
    {
      content: 'The fresh controls show Pause; the original action was not independently verified.'
    }
  ])
  let inspections = 0
  const states = []
  toolHandler = (name, args) => {
    if (name === 'list_apps') return 'Spotify'
    if (name === 'open_app') return 'Opened Spotify. Window: ' + windowRef
    if (name === 'inspect_app') {
      assert.equal(args.window, windowRef, 'Read-back targets the original exact app')
      return snapshot(++inspections)
    }
    if (name === 'act_on_control') return 'Unverified: Control operation returned. Inspect again.'
    throw new Error('Unexpected tool ' + name)
  }
  const desktopHistory = []
  await chat(
    'Can you please open Spotify and pick a song that you would like to play?',
    (e) => {
      if (e.type === 'workflow') states.push(e.state)
    },
    desktopHistory
  )
  assert.deepEqual(executions, [
    'list_apps',
    'open_app',
    'inspect_app',
    'act_on_control',
    'inspect_app'
  ])
  assert.equal(requests.length, 5, 'Read-back adds no model round-trip')
  assert.equal(states.at(-1).evidence.find((e) => e.tool === 'act_on_control').status, 'uncertain')
  assert.equal(states.at(-1).outcome, 'needs_review', 'Inspection alone must not promote evidence')
  assert(
    !requests.some((r) =>
      r.messages.some((m) => m.tool_calls?.some((c) => c.function.name === 'discover_tools'))
    )
  )
  for (let i = 0; i < 4; i++) {
    const expected = ['list_apps', 'open_app', 'inspect_app', 'act_on_control'][i]
    assert(
      requests[i].options.tools.some((t) => t.function.name === expected),
      expected + ' must already be loaded'
    )
  }
  const lastMessages = requests.at(-1).messages
  for (let i = 0; i < lastMessages.length; i++) {
    const calls = lastMessages[i].tool_calls
    if (!calls) continue
    assert.deepEqual(
      lastMessages.slice(i + 1, i + 1 + calls.length).map((m) => m.tool_call_id),
      calls.map((c) => c.id),
      'Recovery must close the skipped batch before adding read-back'
    )
  }
  reset([{ content: 'I need fresh window references to continue.' }])
  await chat('keep going', () => {}, desktopHistory, [], '', states.at(-1))
  assert(
    !JSON.stringify(requests[0].messages).includes(windowRef),
    'Continuation must not expose old window refs in model history'
  )
  assert(requests[0].options.tools.some((t) => t.function.name === 'list_windows'))

  for (const failure of [
    'Denied by the user.',
    'Failed to inspect app controls.',
    'empty',
    'wrong-window'
  ]) {
    reset([call('inspect_app', { window: windowRef }), action(1)])
    inspections = 0
    toolHandler = (name) => {
      if (name === 'act_on_control') return 'Unverified: Control operation returned.'
      if (++inspections === 1) return snapshot(1)
      if (failure === 'wrong-window')
        return snapshot(2).replace(windowRef, 'win-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      if (failure === 'empty')
        return envelope.untrustedData(
          'app-controls',
          'Spotify',
          JSON.stringify({ windowRef, observation: observation(2), controls: [] })
        )
      return failure
    }
    assert.match(await chat('Open Spotify and play a song', () => {}, []), /uncertain/)
    assert.equal(
      requests.length,
      2,
      'Failed read-back stops without further inference or mutations'
    )
  }
  reset([call('inspect_app', { window: windowRef }), action(1)])
  toolHandler = (name) => (name === 'inspect_app' ? snapshot(1) : 'Denied by the user.')
  assert.match(await chat('Open Spotify and play a song', () => {}, []), /denied/)
  assert.deepEqual(
    executions,
    ['inspect_app', 'act_on_control'],
    'Denied mutations never trigger read-back'
  )

  for (const limit of ['blocked-inspection', 'action-budget']) {
    reset([call('inspect_app', { window: windowRef }), action(1)])
    toolHandler = (name) => {
      if (name === 'inspect_app') return snapshot(1)
      if (limit === 'blocked-inspection') settings.tools.inspect_app = 'block'
      else run.tools = load('src/shared/loop-limits.ts').ACTION_LIMIT
      return 'Unverified: Control operation returned.'
    }
    assert.match(await chat('Open Spotify and play a song', () => {}, []), /uncertain/)
    assert.deepEqual(
      executions,
      ['inspect_app', 'act_on_control'],
      'Read-back honors current policy and the shared action budget'
    )
    settings.tools.inspect_app = 'ask'
  }
  reset([action(1)])
  toolHandler = () => 'Unverified: Control operation returned.'
  assert.match(await chat('Open Spotify and play a song', () => {}, []), /uncertain/)
  assert.deepEqual(
    executions,
    ['act_on_control'],
    'Never guess a read-back target without a current observation'
  )

  reset([call('inspect_app', { window: windowRef }), action(1), action(2), action(3)])
  inspections = 0
  toolHandler = (name) =>
    name === 'inspect_app' ? snapshot(++inspections) : 'Unverified: Control operation returned.'
  assert.match(await chat('Open Spotify and play a song', () => {}, []), /Stopped/)
  assert.equal(inspections, 3, 'At most two automatic read-backs per run')
  assert.equal(executions.filter((name) => name === 'act_on_control').length, 3)
  console.log(
    'PASS Spotify fixture: 5 model calls, 5 actions, zero discovery calls; bounded read-back, denied/failed/empty/wrong-target recovery, batch integrity and continuation refs'
  )

  settings.behavior.systemPrompt = 'Custom persona: respond warmly.'
  reset([{ content: 'Hi' }])
  await chat('Hello', () => {}, [])
  assert.match(requests[0].messages[0].content, /Custom persona: respond warmly/)
  assert.match(requests[0].messages[0].content, /untrusted data/)
  settings.behavior.systemPrompt = ''

  settings.model.specialists = false
  const skillPath = 'skills/example/SKILL.md'
  const plugin = '12345678-1234-1234-1234-123456789abc'
  const skillId = load('src/main/plugins/skills.ts', { crypto }).pluginSkillId(plugin, skillPath)
  reset([
    call('discover_tools', { names: ['plugins_list', 'plugin_read', 'mcp_catalog'] }),
    call('list_files', {}),
    call('plugin_read', { plugin, path: skillPath }),
    call('coding_checkpoint', {
      plan: 'Inspect the existing code and make the requested change.',
      docs: 'Read project guidance before editing.',
      tasks: [
        {
          id: 'change',
          title: 'Implement feature',
          dependsOn: [],
          tools: ['read_file', 'edit_file'],
          skill: skillId,
          profile: 'main',
          status: 'active'
        }
      ]
    }),
    call('ask_questions', {
      questions: [{ title: 'Which behavior should change?', options: ['Validation', 'Display'] }]
    })
  ])
  await chat('Implement a feature in this project', () => {}, [])
  assert(requests[1].options.tools.some((t) => t.function.name === 'plugin_read'))
  assert(requests[1].options.tools.some((t) => t.function.name === 'mcp_catalog'))
  assert.match(JSON.stringify(requests[4].messages), /Coding checkpoint saved/)
  assert(!JSON.stringify(requests[4].messages).includes('assigns unread skill'))
  console.log(
    'PASS lazy discovery, blocked tools, atomic discovery batches, persona preservation and imported skill assignment before coding edits'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
