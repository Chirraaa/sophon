const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const capabilities = load('src/shared/model-capabilities.ts')
const usage = load('src/shared/model-usage.ts')
const context = load('src/main/llm/context.ts', {
  './untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto })
})
const providers = load('src/main/llm/providers.ts')
const streams = load('src/main/llm/stream.ts')
const model = {
  provider: 'chatgpt',
  endpoint: 'https://api.openai.com/v1',
  modelId: 'fixture',
  contextWindow: 32000,
  maxTokens: 4096,
  maxSteps: 20,
  reasoningEffort: 'max'
}
const counts = {
  input_tokens: 120,
  output_tokens: 45,
  input_tokens_details: { cached_tokens: 80 },
  output_tokens_details: { reasoning_tokens: 30 }
}
const reported = usage.tokenUsage(counts)
assert.deepEqual(reported, {
  inputTokens: 120,
  outputTokens: 45,
  totalTokens: 165,
  cachedInputTokens: 80,
  reasoningTokens: 30
})
assert.equal(usage.tokenUsage({ input_tokens: -1, output_tokens: 1 }), undefined)
assert.equal(usage.tokenUsage({ input_tokens: '100', output_tokens: 1 }), undefined)
assert.equal(usage.tokenUsage({ input_tokens: NaN, output_tokens: 1 }), undefined)
assert.equal(usage.tokenUsage({}), undefined)
assert.equal(usage.tokenUsage({ prompt_tokens: 0, completion_tokens: 0 }).totalTokens, 0)
assert.equal(
  usage.tokenUsage({ ...counts, output_tokens_details: { reasoning_tokens: 46 } }).reasoningTokens,
  undefined
)
const summed = usage.addUsage(usage.addUsage(undefined, reported), undefined)
assert.equal(summed.reportedCalls, 1)
assert.equal(summed.calls, 2)
assert.equal(summed.totalTokens, 165)

assert.deepEqual(capabilities.documentedCapabilities('gpt-6.1-sol', 'chatgpt').reasoningEfforts, [
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
assert.equal(
  capabilities.supportedEffort('max', capabilities.documentedCapabilities('gpt-5.4', 'chatgpt')),
  undefined
)
assert.deepEqual(capabilities.documentedCapabilities('future-unannounced', 'chatgpt'), {})
for (const id of ['gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.6']) {
  const info = capabilities.documentedCapabilities(id, 'chatgpt')
  assert.equal(info.contextWindow, 1050000)
  assert.equal(info.defaultReasoningEffort, 'medium')
  assert.equal(capabilities.supportedEffort('max', info), 'max')
}
assert.deepEqual(capabilities.documentedCapabilities('gpt-6.1-sol', 'local'), {})
const override = capabilities.modelCapabilities('gpt-6.1-sol', 'chatgpt', {
  supported_reasoning_levels: [{ effort: 'xhigh' }, { effort: 'max' }, { effort: 'invented' }],
  default_reasoning_level: 'max',
  context_window: 200000
})
assert.deepEqual(override.reasoningEfforts, ['xhigh', 'max'])
assert.equal(override.contextWindow, 200000)
assert.equal(override.reasoningSource, 'provider')
assert.equal(capabilities.supportedEffort('max', override), 'max')
assert.deepEqual(
  capabilities.modelCapabilities('gpt-6.1-sol', 'chatgpt', { supported_reasoning_levels: [] })
    .reasoningEfforts,
  []
)

const messages = [
  { role: 'system', content: 'Instructions' },
  { role: 'user', contextGroup: 'history', content: 'Previous question' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Current prompt' },
      {
        type: 'text',
        text: JSON.stringify({
          trust: 'untrusted-data',
          kind: 'user-selected-file',
          content: 'File text'
        })
      },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }
    ]
  },
  { role: 'tool', content: 'Tool output', tool_call_id: 'call' },
  { role: 'user', contextGroup: 'memories', content: 'Memory' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: 'call', type: 'function', function: { name: 'read_file', arguments: '{}' } }
    ],
    responseState: { model: 'fixture', reasoning: [{ encrypted_content: 'opaque' }] }
  }
]
const tools = [{ type: 'function', function: { name: 'read_file' } }]
const measured = context.measureContext(messages, tools, model, false, {
  id: 'fixture',
  label: 'Fixture',
  ...override
})
assert.equal(measured.estimatedInputTokens, context.estimateMessages(messages))
assert.equal(
  measured.estimatedTotalTokens,
  measured.estimatedInputTokens + context.estimateTextTokens(JSON.stringify(tools)) + 32
)
assert.equal(
  measured.breakdown.reduce((sum, part) => sum + part.tokens, 0),
  measured.estimatedTotalTokens
)
assert.equal(new Set(measured.breakdown.map((part) => part.category)).size, 10)
assert.equal(measured.windowSource, 'provider')
assert.equal(measured.contextWindow, 200000)
assert.equal(context.measureContext(messages, [], model, false).contextWindow, null)
const local = context.measureContext(messages, tools, { ...model, provider: 'local' }, false)
assert.equal(local.contextWindow, 32000)
assert.equal(local.windowSource, 'configured')
assert.equal(
  local.inputBudget +
    local.reservedOutputTokens +
    local.headroomTokens +
    local.breakdown.find((part) => part.category === 'tools').tokens,
  32000
)

const response = {
  status: 'completed',
  output: [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] }
  ],
  usage: counts
}
assert.deepEqual(providers.responsesReply(response, 'fixture').usage, reported)
const stream = providers.responsesStream(() => {}, 'fixture')
stream.accept(JSON.stringify({ type: 'response.completed', response }))
assert.deepEqual(stream.reply().usage, reported)
const completion = streams.completionStream(() => {})
completion.accept(
  JSON.stringify({ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] })
)
completion.accept(
  JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 45,
      completion_tokens_details: { reasoning_tokens: 30 }
    }
  })
)
completion.accept('[DONE]')
assert.equal(completion.reply().usage.totalTokens, 165)

// One window rule for every provider, shared by budgets and the display.
const windowOf = (provider, info, contextWindow = 32000) =>
  context.contextWindow({ ...model, provider, contextWindow }, info)
assert.deepEqual(windowOf('chatgpt'), { window: null, source: 'unknown' })
assert.deepEqual(windowOf('anthropic'), { window: 200000, source: 'documented' })
assert.deepEqual(windowOf('claude', { contextWindow: 1000000, contextSource: 'provider' }), {
  window: 1000000,
  source: 'provider'
})
assert.deepEqual(
  windowOf('openai', { contextWindow: 400000, contextSource: 'documented' }),
  { window: 400000, source: 'documented' },
  'The OpenAI API uses the model window, not the local setting'
)
assert.deepEqual(windowOf('openai'), { window: 32000, source: 'configured' })
assert.deepEqual(
  windowOf('local', { contextWindow: 8192, contextSource: 'provider' }),
  { window: 8192, source: 'provider' },
  'A running llama.cpp server reports the window it actually uses'
)
assert.deepEqual(
  windowOf('local', { contextWindow: 131072, contextSource: 'documented' }),
  { window: 32000, source: 'configured' },
  'Local servers ignore unverified windows'
)
assert.equal(
  context.contextBudget({ ...model, provider: 'local', contextWindow: 32000 }, [], false, {
    contextWindow: 8192,
    contextSource: 'provider'
  }).inputBudget < 8192,
  true,
  'Budgets follow the same window as the display'
)
assert.equal(
  capabilities.modelCapabilities('m', 'compatible', { context_length: 65536 }).contextWindow,
  65536
)
assert.equal(
  capabilities.modelCapabilities('m', 'compatible', { max_model_len: 4096 }).contextWindow,
  4096
)

// Image cost follows each provider's encoding rule, read from the image header.
const png = (width, height) => {
  const header = Buffer.alloc(24)
  header.writeUInt32BE(0x89504e47, 0)
  header.writeUInt32BE(0x0d0a1a0a, 4)
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return 'data:image/png;base64,' + header.toString('base64')
}
const jpeg = (width, height) => {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3]
  return (
    'data:image/jpeg;base64,' +
    Buffer.from([0xff, 0xd8, ...app0, ...sof, ...Array(12).fill(0)]).toString('base64')
  )
}
assert.equal(context.imageTokens(png(1280, 960), 'claude'), Math.ceil((1238 * 928) / 750))
assert.equal(context.imageTokens(png(1280, 960), 'openai'), 85 + 170 * 4)
assert.equal(context.imageTokens(jpeg(1280, 960), 'local'), 46 * 35)
assert.equal(context.imageTokens(png(1280, 960)), 2048, 'Budgets keep the conservative cost')
assert.equal(context.imageTokens('https://example.test/a.png', 'claude'), 2048)
const pictured = context.measureContext(
  [{ role: 'user', content: [{ type: 'image_url', image_url: { url: png(1280, 960) } }] }],
  [],
  { ...model, provider: 'openai' },
  false
)
assert.equal(pictured.breakdown.find((part) => part.category === 'attachments').tokens, 765)

// A reply's reading keeps its largest measured request; estimates never erase it.
const contextUsage = load('src/shared/context-usage.ts')
const base = {
  estimatedInputTokens: 900,
  estimatedTotalTokens: 1000,
  inputBudget: 1,
  reservedOutputTokens: 1
}
let merged = contextUsage.mergeContext(undefined, base)
assert.equal(contextUsage.contextUsedTokens(merged), 1000, 'Estimate before any measurement')
merged = contextUsage.mergeContext(merged, {
  ...base,
  reportedInputTokens: 5000,
  reportedOutputTokens: 200
})
assert.equal(contextUsage.contextUsedTokens(merged), 5200)
merged = contextUsage.mergeContext(merged, { ...base, estimatedTotalTokens: 800 })
assert.equal(
  contextUsage.contextUsedTokens(merged),
  5200,
  'A smaller pre-request estimate keeps the peak'
)
assert.equal(merged.reportedInputTokens, 5000)
merged = contextUsage.mergeContext(merged, {
  ...base,
  reportedInputTokens: 3000,
  reportedOutputTokens: 100
})
assert.equal(contextUsage.contextUsedTokens(merged), 5200, 'A smaller final request keeps the peak')
assert.equal(merged.reportedInputTokens, 3000, 'Latest request details still update')
merged = contextUsage.mergeContext(merged, { ...base, compaction: { count: 1 } })
assert.equal(merged.peakTokens, undefined, 'Compaction resets the peak')
assert.equal(contextUsage.contextUsedTokens(merged), 1000)
console.log(
  'PASS per-provider windows (server-reported local, OpenAI model window, Claude/ChatGPT), header-based image costs, peak-preserving merge and compaction reset'
)

async function review() {
  let account = 'one'
  let lists = 0
  let fail = false
  const requests = []
  const contexts = []
  const totals = []
  const run = {
    modelCalls: 0,
    endpoint: model.endpoint,
    onModelContext: (value) => contexts.push(value),
    onModelUsage: (value) => totals.push(value)
  }
  const client = load('src/main/llm/client.ts', {
    '../settings': { getSettings: () => ({ model }) },
    '../tools': { activeToolSchemas: () => tools },
    '../network/endpoint': load('src/main/network/endpoint.ts'),
    '../security/run-manager': { currentRun: () => run, assertRun: () => {} },
    './context': context,
    './stream': streams,
    './providers': providers,
    './anthropic': load('src/main/llm/anthropic.ts'),
    '../security/model-credentials': {
      modelKey: () => {
        throw new Error('No key needed')
      }
    },
    '../security/chatgpt-auth': {
      chatgptAccessToken: async () => 'fixture',
      chatgptAccountScope: () => account,
      chatgptStatus: () => ({ activeId: account, accounts: [] })
    },
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
    '../network/json-request': {
      requestJson: async (url, options) => {
        if (url.pathname.endsWith('/models')) {
          lists++
          return {
            models: [
              {
                slug: 'fixture',
                display_name: 'Fixture',
                visibility: 'list',
                context_window: 200000,
                supported_reasoning_levels:
                  account === 'one' ? [{ effort: 'xhigh' }, { effort: 'max' }] : [{ effort: 'low' }]
              }
            ]
          }
        }
        requests.push(JSON.parse(options.body))
        if (fail) throw new Error('Fixture transport failed')
        options.onEvent(JSON.stringify({ type: 'response.completed', response }))
        return null
      }
    }
  })
  await client.callLLM('fixture', messages)
  assert.equal(contexts.length, 0, 'Only main conversation requests report context')
  await client.callLLM('fixture', messages, { reportContext: true })
  assert.equal(lists, 1)
  assert.deepEqual(requests[0].reasoning, { effort: 'max' })
  assert.equal(totals.at(-1).totalTokens, 330)
  assert.equal(totals.at(-1).reportedCalls, 2)
  assert.equal(contexts.length, 2, 'An estimate before the request, then the measured size')
  assert.equal(contexts[0].reportedInputTokens, undefined)
  assert.equal(contexts.at(-1).contextWindow, 200000)
  assert.equal(contexts.at(-1).reportedInputTokens, reported.inputTokens)
  assert.equal(contexts.at(-1).reportedOutputTokens, reported.outputTokens)
  // The measured ratio now scales the next estimate toward the provider's count.
  await client.callLLM('fixture', messages, { reportContext: true })
  assert.equal(contexts.at(-2).calibrated, true)
  assert(
    Math.abs(contexts.at(-2).estimatedTotalTokens - reported.inputTokens) <=
      Math.abs(contexts[0].estimatedTotalTokens - reported.inputTokens),
    'Calibrated estimates move toward the reported size'
  )
  assert(!JSON.stringify(requests).includes('contextGroup'))
  account = 'two'
  await client.callLLM('fixture', messages)
  assert.equal(lists, 2, 'Account changes invalidate capability cache')
  assert.equal(requests.at(-1).reasoning, undefined, 'Do not send unsupported saved effort')
  fail = true
  await assert.rejects(client.callLLM('fixture', messages), /Fixture transport failed/)
  assert.equal(totals.at(-1).calls, 5)
  assert.equal(totals.at(-1).reportedCalls, 4)
  console.log(
    'PASS supported reasoning levels, account cache isolation, exact usage/partial reporting, streaming, all-call totals, context composition and capacity sources; no network'
  )

  // A running llama.cpp server reports its per-slot context through /props.
  const localClient = (props) =>
    load('src/main/llm/client.ts', {
      '../settings': {
        getSettings: () => ({
          model: { ...model, provider: 'local', endpoint: 'http://127.0.0.1:8080/v1' }
        })
      },
      '../tools': { activeToolSchemas: () => [] },
      '../network/endpoint': load('src/main/network/endpoint.ts'),
      '../security/run-manager': { currentRun: () => undefined, assertRun: () => {} },
      './context': context,
      './stream': streams,
      './providers': providers,
      './anthropic': load('src/main/llm/anthropic.ts'),
      '../security/model-credentials': { modelKey: () => undefined },
      '../security/chatgpt-auth': {},
      'node:perf_hooks': require('node:perf_hooks'),
      './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
      '../network/json-request': {
        requestJson: async (url) => {
          if (url.pathname === '/props') return props()
          return { data: [{ id: 'served.gguf' }] }
        }
      }
    })
  const served = await localClient(() => ({
    default_generation_settings: { n_ctx: 8192 }
  })).getModelInfo()
  assert.equal(served.contextWindow, 8192)
  assert.equal(served.contextSource, 'provider')
  const unreported = await localClient(() => {
    throw new Error('404')
  }).getModelInfo()
  assert.equal(unreported.contextWindow, undefined, 'No /props falls back to Settings')
  console.log('PASS local server context from llama.cpp /props with Settings fallback')
}
review().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
