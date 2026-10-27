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
let run, requests, replies, executions, guidanceReads
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
    requests.push(structuredClone({ messages, options: { ...options, onText: undefined } }))
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
    !staged.select(schema.toolSchemas).some((t) => t.function.name === 'open_app'),
    'Loading replaces optional schemas instead of accumulating forever'
  )
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
