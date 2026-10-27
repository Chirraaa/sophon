const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { eventStream } = load('src/main/network/sse.ts', {
  string_decoder: require('node:string_decoder')
})
const { completionStream } = load('src/main/llm/stream.ts')
for (const finish_reason of ['length', 'content_filter']) {
  const limited = completionStream(() => {})
  limited.accept(
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'limited', function: { name: 'edit_file', arguments: '{' } }
            ]
          },
          finish_reason
        }
      ]
    })
  )
  assert.throws(
    () => limited.reply(),
    (error) => (error.name === 'CodingOutputLimitError') === (finish_reason === 'length')
  )
}
const encode = (delta, finish_reason = null) =>
  'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\r\n\r\n'
const updates = []
const completion = completionStream((text) => updates.push(text))
const parser = eventStream(completion.accept)
const wire = Buffer.from(
  ': heartbeat\r\n\r\n' +
    encode({ role: 'assistant', content: 'Bonjour 🌍' }) +
    encode({ content: ' — hello' }) +
    encode({}, 'stop') +
    'data: {"choices":[],"usage":{}}\r\n\r\ndata: [DONE]\r\n\r\n'
)
for (const byte of wire) parser.write(Buffer.from([byte]))
parser.end()
assert.deepEqual(updates, ['Bonjour 🌍', 'Bonjour 🌍 — hello'])
assert.equal(completion.reply().content, 'Bonjour 🌍 — hello')
const tools = completionStream(() => {})
tools.accept(
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"pa' }
            }
          ]
        }
      }
    ]
  })
)
assert.throws(() => tools.reply(), /before completing/)
tools.accept(
  JSON.stringify({
    choices: [
      {
        delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"notes.txt"}' } }] },
        finish_reason: 'tool_calls'
      }
    ]
  })
)
assert.deepEqual(tools.reply().tool_calls, [
  {
    id: 'call-1',
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"notes.txt"}' }
  }
])
assert.throws(() => completionStream(() => {}).accept('{bad json'))
assert.throws(
  () =>
    completionStream(() => {}).accept(JSON.stringify({ choices: [{ delta: { content: 42 } }] })),
  /content/
)
assert.throws(
  () =>
    completionStream(() => {}).accept(
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 60 }] } }] })
    ),
  /index/
)
const incomplete = eventStream(() => {})
incomplete.write(Buffer.from('data: {"choices":[]}'))
assert.throws(() => incomplete.end(), /Incomplete/)
for (const ending of ['\n', '\r\n', '\r']) {
  const received = []
  const parser = eventStream((data) => received.push(data))
  const bytes = Buffer.from(
    '\uFEFF' + [': heartbeat', 'data: first', 'data: second', '', ''].join(ending)
  )
  for (const byte of bytes) parser.write(Buffer.from([byte]))
  parser.end()
  assert.deepEqual(received, ['first\nsecond'])
}
const finishOnly = completionStream(() => {})
finishOnly.accept(JSON.stringify({ choices: [{ delta: { content: 'Answer' } }] }))
finishOnly.accept(JSON.stringify({ choices: [{ delta: null, finish_reason: 'stop' }] }))
assert.equal(finishOnly.reply().content, 'Answer')
const providers = load('src/main/llm/providers.ts')
const toolItem = (id) => ({
  type: 'function_call',
  id: 'fc_' + id,
  call_id: id,
  namespace: 'sophon',
  name: 'list_windows',
  arguments: '{}'
})
const textItem = (text) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  content: [{ type: 'output_text', text }]
})
const makeStream = () => providers.responsesStream(() => {}, 'fixture-model', 'sophon')
const send = (stream, event) => stream.accept(JSON.stringify(event))
const itemDone = (stream, output_index, item) =>
  send(stream, { type: 'response.output_item.done', output_index, item })
const complete = (stream, output) =>
  send(stream, { type: 'response.completed', response: { status: 'completed', output } })

const compact = makeStream()
itemDone(compact, 0, toolItem('first'))
itemDone(compact, 1, toolItem('second'))
complete(compact, [toolItem('second')])
assert.deepEqual(
  compact.reply().tool_calls.map((call) => call.id),
  ['first', 'second']
)
const duplicated = makeStream()
itemDone(duplicated, 0, toolItem('first'))
complete(duplicated, [toolItem('first')])
assert.equal(duplicated.reply().tool_calls.length, 1)
const noItemId = makeStream()
itemDone(noItemId, 0, toolItem('first'))
const withoutId = { ...toolItem('first') }
delete withoutId.id
complete(noItemId, [withoutId])
assert.equal(noItemId.reply().tool_calls.length, 1)
const argumentOnly = makeStream()
send(argumentOnly, { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{' })
assert.throws(() => complete(argumentOnly, []), /unfinished tool call/)
const duplicateTerminal = makeStream()
itemDone(duplicateTerminal, 0, toolItem('first'))
assert.throws(
  () => complete(duplicateTerminal, [toolItem('first'), toolItem('first')]),
  /Duplicate terminal/
)
const missingOutput = makeStream()
send(missingOutput, {
  type: 'response.output_text.delta',
  delta: 'Text without a terminal snapshot'
})
complete(missingOutput, undefined)
assert.equal(missingOutput.reply().content, 'Text without a terminal snapshot')
const diagnostic = providers.chatgptFailure(
  Object.assign(new Error('Original'), {
    code: 'subscription_sharing_usage_limit_exceeded',
    statusCode: 429,
    requestId: 'req_fixture'
  })
)
assert.equal(diagnostic.code, 'subscription_sharing_usage_limit_exceeded')
assert.equal(diagnostic.statusCode, 429)
assert.equal(diagnostic.requestId, 'req_fixture')
assert.match(diagnostic.message, /plan usage limit/)
const conflict = makeStream()
itemDone(conflict, 0, toolItem('first'))
assert.throws(
  () => complete(conflict, [{ ...toolItem('first'), arguments: '{"changed":true}' }]),
  /Conflicting/
)
const snapshot = makeStream()
itemDone(snapshot, 0, textItem('Keep this answer'))
complete(snapshot, [{ ...textItem(''), content: [] }])
snapshot.accept('[DONE]')
assert.equal(snapshot.reply().content, 'Keep this answer')
const unfinished = makeStream()
send(unfinished, { type: 'response.output_item.added', output_index: 0, item: toolItem('pending') })
assert.throws(() => complete(unfinished, []), /unfinished tool call/)
const terminalTool = makeStream()
send(terminalTool, {
  type: 'response.output_item.added',
  output_index: 0,
  item: toolItem('pending')
})
complete(terminalTool, [toolItem('pending')])
assert.equal(terminalTool.reply().tool_calls[0].id, 'pending')
const refusal = makeStream()
send(refusal, { type: 'response.refusal.delta', delta: 'Unable to help.' })
complete(refusal, [])
assert.equal(refusal.reply().content, 'Unable to help.')
const empty = makeStream()
complete(empty, [])
assert.throws(() => empty.reply(), /without answer text or tool calls/)
const sentinelOnly = makeStream()
sentinelOnly.accept('[DONE]')
assert.throws(() => sentinelOnly.reply(), /before completing/)
const wrongStatus = makeStream()
assert.throws(
  () =>
    send(wrongStatus, {
      type: 'response.completed',
      response: { status: 'in_progress', output: [] }
    }),
  /terminal Responses status/
)
assert.throws(
  () =>
    providers.responsesReply(
      { status: 'completed', output: [toolItem('same'), toolItem('same')] },
      'fixture-model',
      'sophon'
    ),
  /duplicate/
)
console.log(
  'PASS sparse terminal snapshots, tool identity reconciliation, unfinished/conflicting/duplicate tool rejection, refusals, empty answers, terminal status, SSE BOM and all line endings'
)
console.log(
  'PASS streamed UTF-8 and event boundaries, heartbeat and usage events, incremental content, fragmented tool arguments, incomplete and malformed stream rejection'
)

async function transportChecks() {
  const http = require('node:http')
  const { requestJson } = load('src/main/network/json-request.ts', {
    http,
    https: require('node:https'),
    './sse': { eventStream }
  })
  const server = http.createServer((request, response) => {
    if (request.url === '/no-content') {
      response.writeHead(204)
      response.end()
    } else if (request.url === '/headerless-bom') {
      response.end('\uFEFF\r\ndata: {"ok":true}\r\r')
    } else if (request.url === '/wrong-type') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream-unsupported' })
      response.end('data: {}\n\n')
    } else if (request.url === '/interrupted') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write('data: {}\n\n')
      setImmediate(() => response.destroy())
    } else if (request.url === '/headerless-stream') {
      response.write('ev')
      setImmediate(() => {
        response.write(
          'ent: response.output_text.delta\r\n: heartbeat\r\ndata: {"ok":true}\r\n\r\n'
        )
        response.end()
      })
    } else if (request.url === '/headerless-json') {
      response.end('{"ok":true}')
    } else if (request.url === '/headerless-html') {
      response.end('<html>Gateway page</html>\n')
    } else if (request.url === '/empty') {
      response.end()
    } else if (request.url === '/headerless-incomplete') {
      response.end('data: {"ok":true}')
    } else if (request.url === '/headerless-large') {
      response.end('x'.repeat(8193))
    } else if (request.url === '/html') {
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'x-request-id': 'fixture_gateway_123'
      })
      response.end('<html>Gateway page</html>')
    } else if (request.url === '/json') {
      assert.equal(request.headers.accept, 'application/json')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
    } else {
      assert.equal(request.headers.accept, 'text/event-stream, application/json')
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
      response.end('data: {"ok":true}\n\n')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const events = []
    assert.equal(await requestJson(new URL(base), { onEvent: (data) => events.push(data) }), null)
    assert.deepEqual(events, ['{"ok":true}'])
    assert.equal(await requestJson(new URL(base + '/no-content'), { allowEmpty: true }), null)
    await assert.rejects(requestJson(new URL(base + '/no-content')), /HTTP 204/)
    await assert.rejects(
      requestJson(new URL(base + '/wrong-type'), { onEvent: () => {} }),
      /unexpected response/
    )
    await assert.rejects(
      requestJson(new URL(base + '/interrupted'), { onEvent: () => {} }),
      /interrupted|connect/
    )
    await assert.rejects(
      requestJson(new URL(base), { onEvent: () => {}, maxBytes: 3 }),
      /byte budget/
    )
    await assert.rejects(
      requestJson(new URL(base), { signal: AbortSignal.abort() }),
      /stopped or timed out/
    )
    const bomEvents = []
    await requestJson(new URL(base + '/headerless-bom'), {
      onEvent: (data) => bomEvents.push(data)
    })
    assert.deepEqual(bomEvents, ['{"ok":true}'])
    const headerless = []
    assert.equal(
      await requestJson(new URL(base + '/headerless-stream'), {
        onEvent: (data) => headerless.push(data)
      }),
      null
    )
    assert.deepEqual(headerless, ['{"ok":true}'])
    assert.deepEqual(await requestJson(new URL(base + '/headerless-json'), { onEvent: () => {} }), {
      ok: true
    })
    for (const [path, message] of [
      ['/headerless-html', /unrecognized body/],
      ['/empty', /empty body/],
      ['/headerless-incomplete', /incomplete or unrecognized body/],
      ['/headerless-large', /8192 bytes/]
    ]) {
      await assert.rejects(
        requestJson(new URL(base + path), {
          onEvent: () => assert.fail('Invalid bodies must not produce events')
        }),
        message
      )
    }
    assert.deepEqual(await requestJson(new URL(base + '/json')), { ok: true })
    await assert.rejects(requestJson(new URL(base + '/html'), { onEvent: () => {} }), (error) => {
      assert.match(
        error.message,
        /unexpected response instead of a model stream \(HTTP 200, text\/html\)/
      )
      assert.match(error.message, /Request ID: fixture_gateway_123/)
      assert(!error.message.includes('Gateway page'))
      assert(!error.message.includes('reconnect'))
      return true
    })
    console.log(
      'PASS stream Accept negotiation, JSON requests and actionable non-JSON response rejection'
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
transportChecks().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
