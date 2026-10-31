const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const runs = load('src/main/security/run-manager.ts', { crypto })
const schema = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schema })
const untrusted = load('src/main/llm/untrusted-data.ts', { crypto })
const context = load('src/main/llm/context.ts', { './untrusted-data': untrusted })
const workflow = require('./security/workflow-load.cjs')(load)
const settings = {
  model: {
    specialists: true,
    contextWindow: 60000,
    maxSteps: 10,
    historyTurns: 4,
    maxTokens: 512,
    visualMaxTokens: 8192
  },
  memory: { enabled: false }
}
let replies = []
let requests = []
let executed = []
let events = []
let toolResult = 'PUBLIC_EVIDENCE https://example.org/source'
let allowed = ['web_search', 'web_fetch', 'write_file']
let guides = []
let lastHistory
const activeToolSchemas = () =>
  schema.toolSchemas.filter(
    (tool) =>
      allowed.includes(tool.function.name) &&
      !(tool.function.name === 'web_search' && runs.currentRun()?.searchUnavailable)
  )
const client = {
  getModel: async () => 'local-fixture',
  callLLM: async (model, messages, options) => {
    runs.currentRun().modelCalls++
    requests.push({ model, messages, options })
    assert(replies.length, 'Unexpected model call')
    const reply = replies.shift()
    return typeof reply === 'function' ? reply() : reply
  }
}
const specialists = load('src/main/llm/specialists.ts', {
  ...require('./security/harness-fixture.cjs')(load),
  crypto,
  '../settings': { getSettings: () => settings },
  '../security/run-manager': runs,
  '../tools': { activeToolSchemas },
  '../tools/schemas': schema,
  '../security/tool-contracts': contracts,
  './client': client,
  './context': context,
  './untrusted-data': untrusted
})
const chat = load('src/main/llm/chat.ts', {
  ...require('./security/harness-fixture.cjs')(load),
  '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
  crypto,
  '../settings': { getSettings: () => settings },
  '../services/attachments': { attachmentContent: async () => [] },
  './prompt': { buildSystemPrompt: () => 'Sophon fixture system' },
  './client': client,
  './specialists': specialists,
  './run-tool': {
    runTool: async (name) => {
      executed.push(name)
      const result = typeof toolResult === 'function' ? toolResult(name) : toolResult
      if (name === 'web_search' && result.startsWith('Web unavailable:'))
        runs.currentRun().searchUnavailable = true
      return result
    }
  },
  './visuals': { wantsVisual: () => false, truncatedReply: (text) => text },
  './visual-reply': {},
  './visual-routing': { needsVisualTools: () => false },
  '../security/run-manager': runs,
  '../security/tool-contracts': contracts,
  './untrusted-data': untrusted,
  './context': context,
  './playbooks': {
    selectPlaybooks: () => guides,
    resourceToolOrder: (_query, tools) => tools
  },
  '../memory/store': {},
  '../memory/records': {},
  '../tools': { activeToolSchemas },
  './environment': {
    environmentPrompt: () => '',
    requestedDesktopTool: () => undefined,
    runStatePrompt: () => ''
  },
  './desktop-reply': { correctDesktopReply: async (_model, _messages, reply) => reply },
  '../workflow/controller': workflow
})
const call = (name, args, id = crypto.randomUUID()) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})
const consult = (profile, task = 'Check this explanation', extra = {}) => ({
  tool_calls: [call('consult_specialist', { profile, task, context: 'RELEVANT_EXCERPT', ...extra })]
})
async function runChat(queue, query = 'Explain a difficult scientific concept') {
  replies = [...queue]
  requests = []
  executed = []
  events = []
  const run = runs.startRun('assistant', 'http://127.0.0.1:1234/v1', '')
  try {
    lastHistory = []
    return await chat.chat(query, (event) => events.push(event), lastHistory)
  } finally {
    runs.finishRun(run)
  }
}
async function main() {
  const malformed = {
    tool_calls: [
      call('web_search', { query: 'valid first call' }),
      {
        ...call('write_file', {}),
        function: { name: 'write_file', arguments: '{"content":"unfinished' }
      }
    ]
  }
  assert.throws(
    () => contracts.parseToolCalls(malformed.tool_calls),
    contracts.InvalidToolJsonError
  )
  const repaired = await runChat([
    malformed,
    { tool_calls: [call('web_search', { query: 'repaired query' })] },
    { content: 'Recovered answer.' }
  ])
  assert.equal(repaired, 'Recovered answer.')
  assert.deepEqual(executed, ['web_search'])
  assert(requests[1].messages.some((message) => message.content === contracts.TOOL_JSON_REPAIR))
  await assert.rejects(() => runChat([malformed, malformed]), contracts.InvalidToolJsonError)
  assert.deepEqual(executed, [])
  assert.equal(requests.length, 2, 'Malformed calls must only be retried once')

  const questions = [
    { title: 'What help would be useful?', options: ['Explain concepts', 'Practice problems'] }
  ]
  const questionReply = await runChat(
    [{ tool_calls: [call('ask_questions', { questions })] }],
    'Help with this quantum mechanics lesson'
  )
  assert.match(questionReply, /^```sophon-questions/)
  assert.equal(requests.length, 1, 'Questions pause the loop without another model request')
  assert.deepEqual(executed, [], 'Questions do not execute desktop actions')
  assert(
    lastHistory
      .at(-1)
      .some((message) => message.role === 'tool' && message.content.includes('Awaiting user'))
  )
  assert.match(
    await runChat([
      { tool_calls: [call('ask_questions', { questions: [] })] },
      { tool_calls: [call('ask_questions', { questions })] }
    ]),
    /^```sophon-questions/
  )
  assert.deepEqual(executed, [], 'Invalid clarification repairs must not execute actions')
  const pairedQuestions = {
    tool_calls: [
      call('write_file', { path: 'new.txt', content: 'unsafe batch' }),
      call('ask_questions', { questions })
    ]
  }
  assert.match(
    await runChat([pairedQuestions, { tool_calls: [call('ask_questions', { questions })] }]),
    /^```sophon-questions/
  )
  assert.deepEqual(executed, [], 'An action paired with questions must not execute first')
  await assert.rejects(
    () => runChat([pairedQuestions, pairedQuestions, pairedQuestions, pairedQuestions]),
    /separately/
  )
  assert.deepEqual(executed, [], 'An action paired with questions must not execute first')

  assert.deepEqual(Object.keys(specialists.SPECIALIST_PROFILES), [
    'simple',
    'researcher',
    'visual_explainer',
    'tutor',
    'reviewer',
    'falsifier'
  ])
  assert.equal(specialists.specialistLimits(4096).consultations, 4)
  assert.equal(specialists.specialistLimits(16384).consultations, 8)
  assert.equal(specialists.specialistLimits(60000).consultations, 16)
  assert.equal(specialists.specialistLimits(100000).consultations, 16)
  assert.equal(await runChat([{ content: 'Quick answer' }], 'What is 2 + 2?'), 'Quick answer')
  assert.equal(requests.length, 1)
  assert.equal(events.filter((event) => event.type === 'specialist').length, 0)
  const quality = load('src/shared/reply-quality.ts')
  const leaked =
    '<tool_call> <function=consult_specialist> <parameter=profile>visual_explainer</parameter></function></tool_call>'
  assert(quality.hasToolMarkup(leaked))
  assert(!quality.hasToolMarkup('Example:\n```xml\n' + leaked + '\n```'))
  assert(!quality.hasToolMarkup('```html\n<html><body><input type="range"></body></html>\n```'))
  assert.equal(
    await runChat([{ content: leaked }, { content: 'Repaired answer' }]),
    'Repaired answer'
  )
  assert.deepEqual(executed, [])
  assert.equal(requests.length, 2)
  assert.match(await runChat([{ content: leaked }, { content: leaked }]), /invalid tool request/)
  assert.equal(requests.length, 2, 'Protocol recovery is bounded')
  guides = [{ id: 'mathematics', content: 'Check the result.' }]
  assert.equal(
    await runChat([
      { content: 'Draft '.repeat(100) },
      { content: 'Checked answer with complete reasoning. '.repeat(20).trim() }
    ]),
    'Checked answer with complete reasoning. '.repeat(20).trim()
  )
  assert.equal(requests.length, 2)
  assert.equal(requests[1].options.allowTools, false)
  assert.deepEqual(requests[1].options.tools, [])
  assert(requests[1].messages.some((message) => message.content === quality.ANSWER_REVIEW))
  assert(events.some((event) => event.type === 'quality' && event.status === 'reviewed'))
  assert(
    !lastHistory
      .flat()
      .some(
        (message) =>
          message.content === quality.ANSWER_REVIEW || String(message.content).startsWith('Draft ')
      ),
    'Drafts and review instructions do not become future history'
  )
  const preservedDraft = 'Complete explanation with a worked example. '.repeat(20).trim()
  for (const emptyReview of [
    '',
    '   ',
    '<think>Internal review only.</think>',
    'The answer looks good.',
    'Here is your lesson.'
  ]) {
    assert.equal(
      await runChat([{ content: preservedDraft }, { content: emptyReview }]),
      preservedDraft,
      'An empty review preserves the completed draft'
    )
    assert.equal(lastHistory.flat().at(-1).content, preservedDraft)
    assert(!lastHistory.flat().some((message) => message.content === quality.ANSWER_REVIEW))
    assert(events.some((event) => event.type === 'text' && event.text === preservedDraft))
    assert(!events.some((event) => event.type === 'quality' && event.status === 'reviewed'))
  }
  const oversizedDraft = 'Large draft '.repeat(20000)
  assert.equal(await runChat([{ content: oversizedDraft }]), oversizedDraft.trim())
  assert.equal(requests.length, 1, 'Skip review when the draft cannot fit in its context')
  await assert.rejects(
    runChat([
      { content: 'Draft '.repeat(100) },
      { tool_calls: [call('write_file', { path: 'review.txt', content: 'bad' })] }
    ]),
    /No review action was executed/
  )
  assert.deepEqual(executed, [])
  assert.equal(await runChat([{ content: 'Short answer' }]), 'Short answer')
  assert.equal(requests.length, 1)
  settings.model.maxSteps = 1
  assert.equal(await runChat([{ content: 'Long '.repeat(120) }]), 'Long '.repeat(120).trim())
  assert.equal(requests.length, 1, 'Review respects the shared call budget')
  settings.model.maxSteps = 10
  guides = []
  for (const profile of Object.keys(specialists.SPECIALIST_PROFILES)) {
    const answer = await runChat([
      consult(profile),
      { content: 'SPECIALIST_FINDING' },
      { content: 'Final synthesis' }
    ])
    assert.equal(answer, 'Final synthesis')
    assert.equal(requests.length, 3)
    assert(requests[1].messages[0].content.includes(specialists.SPECIALIST_PROFILES[profile].label))
    assert.equal(requests[1].options.outputTokens, 2048)
    const final = events.filter((event) => event.type === 'specialist').at(-1).run
    assert.equal(final.status, 'done')
    assert.equal(final.modelCalls, 1)
    assert(final.estimatedInputTokens > 0)
    assert(
      requests[2].messages.some(
        (message) => message.role === 'tool' && message.content.includes('untrusted-data')
      )
    )
    if (profile !== 'researcher') assert.deepEqual(requests[1].options.tools, [])
    assert(!requests[1].options.tools.some((tool) => tool.function.name === 'consult_specialist'))
    assert(!requests[1].options.tools.some((tool) => tool.function.name === 'write_file'))
  }
  let active = 0
  let peak = 0
  const slow = (content) => async () => {
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 40))
    active--
    return { content }
  }
  const parallel = await runChat([
    {
      tool_calls: [
        call('consult_specialist', { profile: 'simple', task: 'First job' }),
        call('consult_specialist', { profile: 'simple', task: 'Second job' }),
        call('consult_specialist', { profile: 'tutor', task: 'Third job' })
      ]
    },
    slow('FINDING_ONE'),
    slow('FINDING_TWO'),
    slow('FINDING_THREE'),
    { content: 'Parallel synthesis' }
  ])
  assert.equal(parallel, 'Parallel synthesis')
  assert.equal(peak, 3, 'Batched specialists run concurrently')
  const done = events.filter((event) => event.type === 'specialist' && event.run.status === 'done')
  assert.equal(new Set(done.map((event) => event.run.id)).size, 3)
  const lean = requests.find((r) => r.messages[0].content.includes('Sophon Agent'))
  assert.deepEqual(lean.options.tools, [])
  assert(lean.messages[0].content.length < 400, 'The simple profile keeps its prompt minimal')
  settings.model.maxSteps = 20
  peak = 0
  const ten = await runChat([
    {
      tool_calls: Array.from({ length: 10 }, (_, i) =>
        call('consult_specialist', { profile: 'simple', task: 'Job ' + i })
      )
    },
    ...Array.from({ length: 10 }, (_, i) => slow('FINDING_' + i)),
    { content: 'Ten-way synthesis' }
  ])
  assert.equal(ten, 'Ten-way synthesis')
  assert.equal(peak, 10, 'Ten specialists run at the same time')
  settings.model.maxSteps = 3
  await assert.rejects(
    runChat([
      {
        tool_calls: [
          call('consult_specialist', { profile: 'simple', task: 'A' }),
          call('consult_specialist', { profile: 'simple', task: 'B' })
        ]
      }
    ]),
    /Not enough model calls/
  )
  settings.model.maxSteps = 10
  settings.model.provider = 'openai'
  const previousOutputLimit = settings.model.maxTokens
  settings.model.maxTokens = 8192
  assert.equal(
    await runChat([
      consult('tutor'),
      { content: 'API specialist findings' },
      { content: 'API synthesis' }
    ]),
    'API synthesis'
  )
  assert.equal(
    requests[1].options.outputTokens,
    8192,
    'Responses specialists reserve the configured output budget for reasoning'
  )
  delete settings.model.provider
  settings.model.maxTokens = previousOutputLimit
  for (const reply of [
    null,
    { content: '' },
    { content: '   ' },
    { content: '<think>Review only.</think>' }
  ]) {
    replies = [reply]
    events = []
    const emptyRun = runs.startRun('assistant', 'http://127.0.0.1:1234/v1', '')
    try {
      const result = await specialists.consultSpecialist({
        model: 'local-fixture',
        args: { profile: 'reviewer', task: 'Check coding request edge cases' },
        remainingCalls: 1,
        onEvent: (event) => events.push(event),
        execute: async () => assert.fail('A reviewer cannot execute tools')
      })
      assert.equal(result.failed, true)
      assert.equal(result.failureReason, 'empty_response')
      assert.equal(result.calls, 1, 'Empty reviews do not retry')
      assert.equal(events.at(-1).run.status, 'failed', 'Empty findings are not review approval')
    } finally {
      runs.finishRun(emptyRun)
    }
  }
  await runChat([
    consult('researcher'),
    { tool_calls: [call('web_search', { query: 'public question' })] },
    { tool_calls: [call('web_fetch', { url: 'https://example.org/source' })] },
    { content: 'Evidence with https://example.org/source' },
    { content: 'Answer citing https://example.org/source' }
  ])
  assert.deepEqual(executed, ['web_search', 'web_fetch'])
  assert.deepEqual(requests[3].options.tools, [], 'Last specialist step must synthesize')
  assert.equal(requests.length, 5)
  assert(events.some((event) => event.type === 'tool_end'))
  const blocked = await runChat([
    consult('researcher'),
    {
      tool_calls: [
        call('web_search', { query: 'safe' }),
        call('write_file', { path: 'bad.txt', content: 'bad' })
      ]
    }
  ])
  assert.match(blocked, /outside its profile/)
  assert.deepEqual(executed, [], 'Reject the complete batch before any tool executes')
  const recursive = await runChat([consult('tutor'), consult('reviewer')])
  assert.match(recursive, /outside its profile/)
  assert.deepEqual(executed, [])
  toolResult = 'Denied: user declined the query.'
  const denied = await runChat([
    consult('researcher'),
    { tool_calls: [call('web_search', { query: 'public question' })] }
  ])
  assert.match(denied, /declined/)
  assert.equal(requests.length, 2, 'No replay or final model call after denial')
  assert.deepEqual(executed, ['web_search'])
  toolResult = 'Denied by the user.'
  assert.match(
    await runChat([
      consult('researcher'),
      { tool_calls: [call('web_search', { query: 'public question' })] }
    ]),
    /Denied by the user/
  )
  assert.equal(requests.length, 2, 'The exact broker denial also stops without another model call')
  toolResult = 'PUBLIC_EVIDENCE https://example.org/source'
  toolResult = (name) =>
    name === 'web_search'
      ? 'Web unavailable: DuckDuckGo CAPTCHA.'
      : 'PUBLIC_OFFICIAL_EVIDENCE https://example.org/source'
  const recovered = await runChat([
    {
      tool_calls: [
        call('web_search', { query: 'latest model' }),
        call('write_file', { path: 'unrelated.txt', content: 'skip' })
      ]
    },
    { tool_calls: [call('web_fetch', { url: 'https://example.org/source' })] },
    { content: 'Answer supported by the official page.' }
  ])
  assert.equal(recovered, 'Answer supported by the official page.')
  assert.deepEqual(
    executed,
    ['web_search', 'web_fetch'],
    'Other calls from the failed batch are skipped'
  )
  assert(!requests[1].options.tools.some((tool) => tool.function.name === 'web_search'))
  assert(
    events.some(
      (event) =>
        event.type === 'workflow' &&
        event.state.evidence.some((e) => e.tool === 'web_search' && e.status === 'failed')
    )
  )
  assert(!events.some((event) => event.type === 'workflow' && event.state.outcome === 'blocked'))
  const researched = await runChat([
    consult('researcher'),
    { tool_calls: [call('web_search', { query: 'latest model' })] },
    { tool_calls: [call('web_fetch', { url: 'https://example.org/source' })] },
    { content: 'Official source findings' },
    { content: 'Supported final answer' }
  ])
  assert.equal(researched, 'Supported final answer')
  assert.deepEqual(executed, ['web_search', 'web_fetch'])
  assert(!requests[2].options.tools.some((tool) => tool.function.name === 'web_search'))
  assert.equal(events.filter((event) => event.type === 'specialist').at(-1).run.status, 'done')
  toolResult = 'PUBLIC_EVIDENCE https://example.org/source'
  settings.model.specialists = false
  assert.equal(
    await runChat([consult('tutor'), { content: 'Answered without a subagent.' }]),
    'Answered without a subagent.'
  )
  assert(!requests[0].options.tools.some((tool) => tool.function.name === 'consult_specialist'))
  assert(
    requests[1].messages.some(
      (message) => message.role === 'tool' && /Not executed: .*unavailable/.test(message.content)
    )
  )
  await assert.rejects(
    runChat([consult('tutor'), consult('tutor'), consult('tutor'), consult('tutor')]),
    /unavailable/
  )
  settings.model.specialists = true
  settings.model.maxSteps = 3
  await runChat([consult('researcher'), { content: 'Short report' }, { content: 'Answer' }])
  assert.equal(requests.length, 3)
  assert.deepEqual(requests[1].options.tools, [])
  assert(!requests[2].options.tools.some((tool) => tool.function.name === 'consult_specialist'))
  settings.model.maxSteps = 10
  await assert.rejects(
    runChat([
      consult('tutor'),
      () => {
        runs.stopRun()
        return { content: 'too late' }
      }
    ])
  )
  assert.equal(requests.length, 2)
  assert.equal(events.filter((event) => event.type === 'specialist').at(-1).run.status, 'failed')
  let transported = 0
  const budgetClient = load('src/main/llm/client.ts', {
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
    './stream': load('src/main/llm/stream.ts'),
    './providers': load('src/main/llm/providers.ts'),
    './anthropic': load('src/main/llm/anthropic.ts'),
    '../security/chatgpt-auth': {
      chatgptAccessToken: async () => {
        throw new Error('ChatGPT login forbidden in this offline fixture')
      }
    },
    '../security/model-credentials': {
      modelKey: () => {
        throw new Error('API credentials forbidden in this offline fixture')
      }
    },
    '../settings': { getSettings: () => settings },
    '../tools': { activeToolSchemas },
    '../network/json-request': {
      requestJson: async (_url, options) => {
        // Model metadata lookups carry no body; count only conversation requests.
        if (!options?.body) return { data: [] }
        transported++
        return { choices: [{ message: { role: 'assistant', content: 'bounded' } }] }
      }
    },
    '../network/endpoint': load('src/main/network/endpoint.ts'),
    '../security/run-manager': runs,
    './context': context
  })
  settings.model.maxSteps = 2
  const budgetRun = runs.startRun('assistant', 'http://127.0.0.1:1234/v1', '')
  try {
    const messages = [{ role: 'user', content: 'Check the shared budget.' }]
    await budgetClient.callLLM('fixture', messages, { allowTools: false })
    await budgetClient.callLLM('fixture', messages, { allowTools: false })
    await assert.rejects(
      budgetClient.callLLM('fixture', messages, { allowTools: false }),
      /model-call limit/
    )
    assert.equal(transported, 2, 'Over-budget calls never reach transport')
    assert.equal(budgetRun.modelCalls, 2)
  } finally {
    runs.finishRun(budgetRun)
  }
  settings.model.maxSteps = 10
  console.log(
    'PASS four profiles, direct quick answers, sequential handoffs, profile tool boundaries, batch rejection, no recursion, shared model-call budget, context adaptation, disable and Stop'
  )
  if (process.argv.includes('--live')) {
    const requestJson = load('src/main/network/json-request.ts', {
      './sse': load('src/main/network/sse.ts', { string_decoder: require('node:string_decoder') }),
      http: require('node:http'),
      https: require('node:https')
    })
    const realClient = load('src/main/llm/client.ts', {
      'node:perf_hooks': require('node:perf_hooks'),
      './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
      './stream': load('src/main/llm/stream.ts'),
      './providers': load('src/main/llm/providers.ts'),
      './anthropic': load('src/main/llm/anthropic.ts'),
      '../security/chatgpt-auth': {
        chatgptAccessToken: async () => {
          throw new Error('ChatGPT login forbidden in this offline fixture')
        }
      },
      '../security/model-credentials': {
        modelKey: () => {
          throw new Error('API credentials forbidden in this offline fixture')
        }
      },
      '../settings': { getSettings: () => settings },
      '../tools': { activeToolSchemas },
      '../network/json-request': requestJson,
      '../network/endpoint': load('src/main/network/endpoint.ts'),
      '../security/run-manager': runs,
      './context': context
    })
    settings.model.endpoint = 'http://127.0.0.1:1234/v1'
    settings.model.modelId = ''
    settings.model.temperature = 0.2
    settings.model.thinking = false
    settings.model.maxSteps = 10
    settings.model.maxTokens = 2048
    allowed = []
    requests = []
    events = []
    client.getModel = realClient.getModel
    client.callLLM = realClient.callLLM
    const run = runs.startRun('assistant', settings.model.endpoint, '')
    try {
      const answer = await chat.chat(
        'Use consult_specialist to ask the tutor for a short worked example of why dividing by a fraction multiplies by its reciprocal. Then use consult_specialist to ask the reviewer to check the example. Finally give me the checked explanation. Do not use web or desktop tools.',
        (event) => events.push(event),
        []
      )
      const finished = events.filter(
        (event) => event.type === 'specialist' && event.run.status === 'done'
      )
      assert(
        finished.some((event) => event.run.profile === 'tutor'),
        'The live model did not complete a tutor consultation'
      )
      assert(
        finished.some((event) => event.run.profile === 'reviewer'),
        'The live model did not complete a reviewer consultation'
      )
      assert(answer.trim())
      console.log(
        `PASS live local model: Tutor + Reviewer, ${run.modelCalls} total model calls. Reply: ${answer.slice(0, 600)}`
      )
    } finally {
      runs.finishRun(run)
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
