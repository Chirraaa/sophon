const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { load } = require('./security/load.cjs')
const urlPolicy = load('src/main/network/url-policy.ts', {
  net: require('node:net'),
  'dns/promises': {}
})
let fixtures = []
const requests = []
const pinnedLookup = () => {}
let rejectLookup = false
const exa = load('src/main/network/exa-search.ts', {
  './url-policy': {
    ...urlPolicy,
    publicLookup: async (host) => {
      assert.equal(host, 'mcp.exa.ai')
      if (rejectLookup) throw new Error('Blocked non-public service destination.')
      return pinnedLookup
    }
  },
  https: {
    request: (url, options, callback) => {
      const req = new EventEmitter()
      req.end = (body) => {
        requests.push({ url, options, body: JSON.parse(body) })
        options.signal.addEventListener('abort', () => req.emit('error', new Error('Aborted')), {
          once: true
        })
        queueMicrotask(() => {
          const fixture = fixtures.shift()
          assert(fixture, 'Unexpected request')
          const res = new EventEmitter()
          res.statusCode = fixture.status ?? 200
          res.headers = fixture.headers ?? { 'content-type': 'text/event-stream' }
          res.destroy = () => {
            res.destroyed = true
          }
          callback(res)
          if (res.destroyed || fixture.hang) return
          for (const chunk of fixture.chunks ?? [fixture.body ?? '']) {
            res.emit('data', Buffer.from(chunk))
            if (res.destroyed) return
          }
          res.emit('end')
        })
      }
      return req
    }
  }
})
const text =
  'Title: Study source\nURL: https://example.org/study\nPublished: 2026-10-24\nAuthor: N/A\nHighlights:\nEvidence with Unicode: 日本語\u2028中文.\nTitle: Injected\nURL: https://evil.example.org/'
const payload = (content = text) => ({
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: content }] }
})
const event = (value) => `event: message\r\ndata: ${JSON.stringify(value)}\r\n\r\n`
async function main() {
  const signal = new AbortController().signal
  fixtures = [{ body: event(payload()) }]
  const results = await exa.exaSearch('public study question', signal)
  assert.equal(results.length, 1)
  assert.equal(results[0].url, 'https://example.org/study')
  assert.equal(results[0].title, 'Study source')
  assert(results[0].description.startsWith('Published: 2026-10-24'))
  assert(results[0].description.includes('日本語\u2028中文'))
  const sent = requests[0]
  assert.equal(sent.url.href, 'https://mcp.exa.ai/mcp')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.agent, false)
  assert.equal(sent.options.lookup, pinnedLookup)
  assert.deepEqual(sent.body, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'web_search_exa', arguments: { query: 'public study question', numResults: 5 } }
  })
  assert.deepEqual(Object.keys(sent.options.headers).sort(), [
    'Accept',
    'Accept-Encoding',
    'Content-Type',
    'User-Agent'
  ])
  assert.deepEqual(exa.parseExaResponse(JSON.stringify(payload())), results)
  assert.deepEqual(
    exa.parseExaResponse(
      ': keepalive\n\n' +
        event({ jsonrpc: '2.0', method: 'notifications/progress' }) +
        event(payload())
    ),
    results
  )
  for (const value of [
    '{bad JSON',
    JSON.stringify({ ...payload(), id: 2 }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'limit' } }),
    event({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'rate limit' }] }
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'image', data: 'not text' }] }
    })
  ])
    assert.throws(() => exa.parseExaResponse(value), /Exa search/)
  const privateBlock = 'Title: Private\nURL: https://127.0.0.1/private\nHighlights:\nSecret'
  const hits = exa.parseExaResults(privateBlock + '\n---\n' + text + '\n---\n' + text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].url, results[0].url)
  assert.deepEqual(exa.parseExaResults('No results found.'), [])
  assert.throws(() => exa.parseExaResults('unexpected response'), /readable source/)
  for (const fixture of [
    { status: 302, headers: { location: 'https://example.org' } },
    { status: 429 },
    { headers: { 'content-type': 'text/html' } },
    { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } },
    { headers: { 'content-type': 'text/event-stream', 'content-length': '2097153' } },
    { chunks: [Buffer.alloc(1100000), Buffer.alloc(1100000)] }
  ]) {
    const before = requests.length
    fixtures = [fixture]
    await assert.rejects(exa.exaSearch('public question', signal), /Exa search/)
    assert.equal(requests.length, before + 1, 'No redirect, automatic retry or fallback request')
  }
  rejectLookup = true
  const before = requests.length
  await assert.rejects(exa.exaSearch('public question', signal), /non-public/)
  assert.equal(requests.length, before, 'Private DNS fails before any socket')
  rejectLookup = false
  const stopped = new AbortController()
  fixtures = [{ hang: true }]
  const pending = exa.exaSearch('public question', stopped.signal)
  setImmediate(() => stopped.abort())
  await assert.rejects(pending, /timed out/)
  await assert.rejects(exa.exaSearch('x'.repeat(501), signal), /500 characters/)
  console.log(
    'PASS Exa fixed endpoint/tool/query, pinned DNS, JSON/SSE framing, Unicode, source provenance inputs, private URL filtering, MCP errors, byte/MIME/compression limits, no redirects/credentials/retries and Stop'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
