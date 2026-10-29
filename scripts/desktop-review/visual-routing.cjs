const assert = require('node:assert/strict')

module.exports = async function review({ load, visuals, routing, buildSystemPrompt }) {
  const exact =
    'Show me three examples of what you can render inline: a clickable web-request diagram, a chart with sample data, and an interactive compound-growth widget with working sliders.'
  for (const text of [
    exact,
    'Draw a chart with sample data',
    'Make a slider calculator',
    'Show a clickable Browser → Load balancer → Database diagram',
    'Explain the load balancer',
    'Make the chart blue',
    'Show an interactive diagram inline. Do not save files.'
  ])
    assert.equal(routing.needsVisualTools(text), false, text)
  for (const text of [
    'Explain the chart on my screen',
    'Make a chart from sales.csv',
    'Read sales.csv and draw a chart inline. Do not save files.',
    'Plot the data from my spreadsheet',
    'Read the file and chart it',
    'Save this diagram to a file',
    'Open Notepad',
    'Open Spotify',
    'Can you open Calculator',
    'Save it',
    'Look at the active window and draw its layout',
    'Capture a screenshot and annotate it'
  ])
    assert.equal(routing.needsVisualTools(text), true, text)
  assert(visuals.wantsVisual(exact, []))
  assert.match(buildSystemPrompt(true, true), /Desktop and file tools are disabled for this turn/)
  const settings = {
    model: {
      maxSteps: 6,
      historyTurns: 10,
      contextWindow: 16384,
      maxTokens: 512,
      visualMaxTokens: 8192
    }
  }
  const context = load('src/main/llm/context.ts', {
    './untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto: require('node:crypto') })
  })
  const calls = []
  const executed = []
  const events = []
  let replies = []
  const client = {
    getModel: async () => 'review-model',
    callLLM: async (...args) => {
      calls.push(args)
      assert(replies.length, 'Unexpected extra model call')
      return replies.shift()
    }
  }
  const correction = load('src/main/llm/visual-reply.ts', {
    './client': client,
    './visuals': visuals,
    './visual-routing': routing
  })
  const { chat } = load('src/main/llm/chat.ts', {
    ...require('../security/harness-fixture.cjs')(load),
    '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
    './specialists': {},
    '../workflow/controller': require('../security/workflow-load.cjs')(load),
    './environment': load('src/main/llm/environment.ts'),
    './desktop-reply': { correctDesktopReply: async (_model, _messages, reply) => reply },
    './context': context,
    './playbooks': load('src/main/llm/playbooks.ts'),
    '../memory/store': { listMemories: () => [] },
    '../memory/records': load('src/main/memory/records.ts'),
    crypto: require('node:crypto'),
    '@electron-toolkit/utils': { is: { dev: false } },
    '../settings': { getSettings: () => settings },
    '../tools': {
      activeToolSchemas: () =>
        ['look_at_screen', 'read_file', 'open_app'].map((name) => ({
          type: 'function',
          function: { name }
        }))
    },
    '../services/attachments': { attachmentContent: async () => [] },
    './prompt': { buildSystemPrompt },
    './client': client,
    './run-tool': {
      runTool: async (name) => {
        executed.push(name)
        return 'Requested context'
      }
    },
    './visuals': visuals,
    './visual-reply': correction,
    './visual-routing': routing,
    './untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto: require('node:crypto') }),
    '../security/run-manager': {
      currentRun: () => ({ mode: 'assistant', tools: 0 }),
      assertRun: () => {}
    },
    '../security/tool-contracts': load('src/main/security/tool-contracts.ts', {
      '../tools/schemas': load('src/main/tools/schemas.ts', {
        '../harness/schemas': load('src/main/harness/schemas.ts'),
        './windows': { POSITIONS: [] }
      })
    })
  })
  const toolReply = (name) => ({
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(
            name === 'read_file'
              ? { path: 'sales.csv' }
              : name === 'open_app'
                ? { name: 'notepad' }
                : {}
          )
        }
      }
    ]
  })
  const html = { content: '```html\n<div>Inline visual</div>\n```' }
  const pollutedHistory = [
    [
      { role: 'user', content: exact },
      { role: 'assistant', content: 'Captured the active window six times.' }
    ]
  ]
  replies = [toolReply('look_at_screen'), html]
  assert.match(await chat(exact, (event) => events.push(event), pollutedHistory), /```html/)
  assert.equal(calls.length, 2)
  assert(calls.every(([, , options]) => options.allowTools === false))
  assert.deepEqual(executed, [])
  assert(events.every((event) => ['context', 'workflow', 'text'].includes(event.type)))
  assert(!pollutedHistory.at(-1).some((message) => message.tool_calls || message.role === 'tool'))
  calls.length = 0
  replies = [toolReply('look_at_screen'), toolReply('look_at_screen')]
  await assert.rejects(
    chat(exact, (event) => events.push(event), []),
    /No desktop action was run/
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(executed, [])
  assert(events.every((event) => ['context', 'workflow', 'text'].includes(event.type)))
  for (const [text, name] of [
    ['Explain the chart on my screen', 'look_at_screen'],
    ['Make a chart from sales.csv', 'read_file'],
    ['Open Notepad', 'open_app']
  ]) {
    calls.length = 0
    replies = [toolReply(name), html]
    await chat(text, () => {}, [
      [
        { role: 'user', content: 'Draw a chart' },
        { role: 'assistant', content: html.content }
      ]
    ])
    assert(
      calls.every(([, , options]) => options.allowTools === true),
      text
    )
    assert.equal(executed.at(-1), name)
  }
  const payloads = []
  const transport = load('src/main/llm/client.ts', {
    '../../shared/model-tuning': load('src/shared/model-tuning.ts'),
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
    './context': context,
    '../settings': {
      getSettings: () => ({
        model: { endpoint: 'http://127.0.0.1:1234/v1', visualMaxTokens: 8192 }
      })
    },
    '../tools': {
      activeToolSchemas: () => [{ type: 'function', function: { name: 'look_at_screen' } }]
    },
    '../network/endpoint': load('src/main/network/endpoint.ts'),
    '../security/run-manager': { currentRun: () => undefined },
    '../network/json-request': {
      requestJson: async (_url, options) => {
        payloads.push(JSON.parse(options.body))
        return { choices: [{ message: { role: 'assistant', ...html } }] }
      }
    }
  })
  await transport.callLLM('review', [], { visual: true, allowTools: false })
  assert.equal(payloads[0].tools, undefined)
  assert.equal(payloads[0].tool_choice, 'none')
  await transport.callLLM('review', [], { visual: true, allowTools: true })
  assert.equal(payloads[1].tools[0].function.name, 'look_at_screen')
  assert.equal(payloads[1].tool_choice, undefined)
  console.log(
    'PASS exact inline prompt: tool schemas omitted, tool_choice none, unsolicited tool calls never execute, one bounded recovery, screen/file/app requests retain tools'
  )
}
