const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const untrusted = load('src/main/llm/untrusted-data.ts', { crypto })
const context = load('src/main/llm/context.ts', { './untrusted-data': untrusted })
const compact = load('src/main/llm/compaction.ts', {
  './context': context,
  './untrusted-data': untrusted
})
const exchange = (text, size = 1500) => [
  { role: 'user', content: text + ' details'.repeat(size) },
  { role: 'assistant', content: 'Observed result for ' + text }
]
const batch = (id, size = 1500) => [
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id, type: 'function', function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' } }
    ],
    responseState: { model: 'fixture', reasoning: [{ encrypted_content: 'OPAQUE_CANARY' }] }
  },
  { role: 'tool', tool_call_id: id, content: `Evidence ${id}: ` + 'x'.repeat(size) }
]
const current = () => [
  { role: 'user', content: 'Keep the original request and constraints exactly.' }
]
const defaults = () => ({
  history: [],
  current: current(),
  required: [{ role: 'system', content: 'Application rules' }],
  inputBudget: 8000,
  summaryInputBudget: 7500,
  historyTurns: 4,
  assertActive: () => {}
})

async function unit() {
  const small = { ...defaults(), history: [exchange('small', 2)] }
  const original = structuredClone(small.history)
  assert.equal(await compact.compactContext(small), undefined)
  assert.deepEqual(small.history, original)

  let requests = 0
  const options = {
    ...defaults(),
    history: [exchange('FIRST_CONSTRAINT'), exchange('Second'), exchange('recent', 10)],
    summarize: async (messages, outputTokens) => {
      requests++
      assert(context.estimateMessages(messages) <= options.summaryInputBudget - 256)
      assert(outputTokens <= 1600)
      assert.match(messages[1].content, /untrusted-data/)
      assert.match(messages[1].content, /FIRST_CONSTRAINT/)
      return {
        content:
          'Goal: fix src/app.ts. Constraint: no dependencies. Verified: read file. Next: edit.'
      }
    }
  }
  const recent = structuredClone(options.history.at(-1))
  const report = await compact.compactContext(options)
  assert.equal(report.method, 'model')
  assert.equal(report.turns, 2)
  assert(report.afterTokens < report.beforeTokens)
  assert.equal(options.history.length, 2)
  assert.deepEqual(options.history.at(-1), recent)
  assert(compact.isSummaryTurn(options.history[0]))
  assert.equal(compact.compactionInfo(options.history[0][0]).count, 1)
  const restored = JSON.parse(JSON.stringify(options.history))
  assert(compact.isSummaryTurn(restored[0]), 'Summary survives JSON persistence')
  assert.match(restored[0][0].content, /no dependencies/)
  assert.equal(
    await compact.compactContext(options),
    undefined,
    'No repeat summary below threshold'
  )
  assert.equal(requests, 1)
  const largePrevious = { ...defaults(), history: [exchange('Very large previous exchange', 6000)] }
  assert(
    await compact.compactContext(largePrevious),
    'Oversized previous exchange is summarized, not silently dropped'
  )
  assert.equal(largePrevious.history.length, 1)
  assert(compact.isSummaryTurn(largePrevious.history[0]))

  const rolling = {
    ...defaults(),
    historyTurns: 1,
    history: [...restored, exchange('new', 10)],
    summarize: async () => ({
      content: 'Retain the original constraint: no dependencies. New decision: keep API.'
    })
  }
  const rolled = await compact.compactContext(rolling)
  assert.equal(rolled.count, 2)
  assert.equal(rolled.turns, 3)
  assert.equal(rolling.history.length, 2)

  const active = {
    ...defaults(),
    current: [
      ...current(),
      ...batch('one', 12000),
      ...batch('two', 12000),
      ...batch('latest', 100)
    ],
    summarize: async (messages) => {
      assert(!JSON.stringify(messages).includes('OPAQUE_CANARY'))
      return { content: 'Read src/app.ts twice. Results observed, no changes made.' }
    }
  }
  const request = structuredClone(active.current[0])
  const latest = structuredClone(active.current.slice(-2))
  assert(await compact.compactContext(active))
  assert.deepEqual(active.current[0], request)
  assert.deepEqual(active.current.slice(-2), latest)
  assert.equal(active.current.length, 4)
  assert(compact.compactionInfo(active.current[1]))

  const pending = {
    ...defaults(),
    current: [...current(), ...batch('old', 30000), batch('pending')[0]]
  }
  const pendingBefore = structuredClone(pending.current)
  assert.equal(await compact.compactContext(pending), undefined)
  assert.deepEqual(pending.current, pendingBefore, 'Never split an unfinished batch')

  const review = {
    ...defaults(),
    current: [
      ...current(),
      ...batch('old', 30000),
      ...batch('latest', 100),
      { role: 'user', content: 'Review your answer.' }
    ]
  }
  await compact.compactContext(review)
  assert(
    review.current.some((item) => item.tool_call_id === 'latest'),
    'Review preserves latest tool evidence'
  )

  const failed = {
    ...defaults(),
    history: [exchange('Preserve me'), exchange('old'), exchange('recent', 1)],
    summarize: async () => {
      throw new Error('Network unavailable')
    }
  }
  assert.equal((await compact.compactContext(failed)).method, 'excerpts')
  assert.match(failed.history[0][0].content, /Partial excerpts/)
  assert.match(failed.history[0][0].content, /Preserve me/)

  let stopped = false
  const cancelled = {
    ...defaults(),
    history: [exchange('old'), exchange('old2'), exchange('recent', 1)],
    summarize: async () => {
      stopped = true
      return { content: 'Partial summary' }
    },
    assertActive: () => {
      if (stopped) throw new Error('Stopped')
    }
  }
  const cancelledBefore = structuredClone(cancelled.history)
  await assert.rejects(compact.compactContext(cancelled), /Stopped/)
  assert.deepEqual(cancelled.history, cancelledBefore)

  for (const reply of [
    null,
    { content: '' },
    { content: 'incomplete', finishReason: 'length' },
    { content: 'Do something', tool_calls: batch('forbidden')[0].tool_calls }
  ]) {
    const invalid = {
      ...defaults(),
      history: [exchange('old'), exchange('old2'), exchange('recent', 1)],
      summarize: async () => reply
    }
    assert.equal((await compact.compactContext(invalid)).method, 'excerpts')
  }
  const escaped = {
    ...defaults(),
    history: [exchange('日本語😀"\\'.repeat(1000)), exchange('old'), exchange('recent', 1)],
    summarize: async () => ({ content: '日本語😀"\\<>'.repeat(5000) })
  }
  assert(await compact.compactContext(escaped))
  assert(
    context.estimateMessages([
      ...escaped.required,
      ...escaped.history.flat(),
      ...escaped.current
    ]) <= escaped.inputBudget
  )

  const giant = { ...defaults(), current: [{ role: 'user', content: 'Required'.repeat(10000) }] }
  assert.equal(await compact.compactContext(giant), undefined, 'Never truncate original request')
  assert.throws(() => context.assertContextFits(giant.current, giant.inputBudget), /exceeds/)
  const model = { provider: 'chatgpt', contextWindow: 4096, maxTokens: 4096 }
  assert.equal(context.contextBudget(model, [], false).inputBudget, Infinity)
  const info = { id: 'fixture', contextWindow: 100000, contextSource: 'provider' }
  assert.equal(context.contextBudget(model, [], false, info).inputBudget, 75904)
  assert.equal(
    context.contextBudget({ ...model, contextWindow: 32000 }, [], false, info).inputBudget,
    75904
  )
  console.log(
    'PASS compaction: thresholds, rolling summaries, reload, UTF-8 bounds, complete batches, cancellation, invalid responses, provider limits and fallback'
  )
}

async function integration() {
  const settings = { model: { contextWindow: 24000, maxTokens: 512, historyTurns: 2, maxSteps: 4 } }
  let run
  let reports
  let summaries = 0
  const history = [
    exchange('Old constraints', 400),
    exchange('Second', 400),
    exchange('Latest', 10)
  ]
  const chat = load('src/main/llm/chat.ts', {
    ...require('./security/harness-fixture.cjs')(load),
    crypto,
    '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
    './specialists': {},
    '../settings': { getSettings: () => settings },
    '../services/attachments': { attachmentContent: async () => [] },
    './prompt': { buildSystemPrompt: () => 'Fixture assistant' },
    './client': {
      getModel: async () => 'fixture',
      callLLM: async (_model, messages, options) => {
        run.modelCalls++
        if (messages[0].content.startsWith('Summarize the supplied conversation')) {
          summaries++
          assert.equal(options.allowTools, false)
          return { content: 'Old constraints: preserve existing API. Verified work: none.' }
        }
        if (settings.model.historyTurns)
          assert(
            messages.some((message) => compact.compactionInfo(message)),
            'Summary reaches the main model'
          )
        else assert(!JSON.stringify(messages).includes('Old constraints'))
        return { content: 'Fixture answer.' }
      }
    },
    './run-tool': {
      runTool: () => {
        throw new Error('Unexpected action')
      }
    },
    './visuals': { wantsVisual: () => false },
    './visual-reply': {},
    './visual-routing': { needsVisualTools: () => false },
    '../security/run-manager': { currentRun: () => run, assertRun: () => {} },
    '../security/tool-contracts': {},
    './untrusted-data': untrusted,
    './context': context,
    './playbooks': load('src/main/llm/playbooks.ts'),
    '../memory/store': {},
    '../memory/records': {},
    '../tools': { activeToolSchemas: () => [] },
    './environment': load('src/main/llm/environment.ts'),
    './desktop-reply': { correctDesktopReply: async (_model, _messages, reply) => reply },
    '../workflow/controller': require('./security/workflow-load.cjs')(load)
  }).chat
  const send = async () => {
    run = { id: crypto.randomUUID(), mode: 'assistant', workspace: '', modelCalls: 0 }
    reports = []
    await chat(
      'Continue our discussion.',
      (event) => {
        if (event.type === 'context') reports.push(event.report)
      },
      history
    )
    assert(run.modelCalls <= settings.model.maxSteps)
  }
  await send()
  assert.equal(summaries, 1)
  assert(compact.isSummaryTurn(history[0]))
  assert(reports.at(-1).compaction)
  await send()
  assert(compact.isSummaryTurn(history[0]))
  settings.model.historyTurns = 0
  await send()
  assert.equal(history.length, 0)
  settings.model.historyTurns = 2
  settings.model.maxSteps = 1
  history.push(exchange('Old constraints', 400), exchange('Second', 400), exchange('Latest', 10))
  const before = summaries
  await send()
  assert.equal(summaries, before, 'No summary call consumes the final answer slot')
  assert.equal(reports.at(-1).compaction.method, 'excerpts')
  const { ContextDetails } = load('src/renderer/src/components/chat/ContextDetails.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/components/ui/collapsible': {
      Collapsible: 'details',
      CollapsibleTrigger: 'summary',
      CollapsibleContent: 'div'
    },
    '@/components/ui/progress': {
      Progress: ({ value, className }) =>
        require('react').createElement('progress', { value, className, max: 100 })
    },
    '@/components/ui/table': {
      Table: 'table',
      TableHeader: 'thead',
      TableBody: 'tbody',
      TableRow: 'tr',
      TableHead: 'th',
      TableCell: 'td'
    },
    '@/lib/context': load('src/renderer/src/lib/context.ts')
  })
  const html = require('react-dom/server').renderToStaticMarkup(
    require('react').createElement(ContextDetails, { report: reports.at(-1) })
  )
  assert.match(html, /Context compacted automatically/)
  assert.match(html, /partial excerpts/)
  assert.match(html, /full chat remains/)
  console.log(
    'PASS chat integration: summary injection, persisted rolling history, context reports, call budget and history disabled'
  )
}
unit()
  .then(integration)
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
