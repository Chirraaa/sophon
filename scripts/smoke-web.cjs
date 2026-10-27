const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const runs = load('src/main/security/run-manager.ts', { crypto })
const htmlText = load('src/main/network/html-text.ts', { parse5: require('parse5') })
let addresses = [{ address: '93.184.215.14', family: 4 }]
const policy = load('src/main/network/url-policy.ts', {
  net: require('node:net'),
  'dns/promises': { lookup: async () => addresses }
})
let settings = {
  research: { enabled: true, provider: 'duckduckgo' },
  model: { contextWindow: 60000 }
}
const settingsModule = {
  getSettings: () => settings,
  settingsRecovery: () => ({ required: false })
}
let responses = []
let requests = []
const page = load('src/main/network/public-page.ts', {
  '../services/isolated-parser': {
    parsePdf: async (bytes) => {
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
      return { text: 'Quantum lesson', pages: ['data:image/jpeg;base64,YQ=='] }
    }
  },
  './html-text': htmlText,
  crypto,
  '../settings': settingsModule,
  '../security/run-manager': runs,
  './url-policy': policy,
  https: {
    request: (url, options, callback) => {
      requests.push({ url, options })
      const req = new EventEmitter()
      req.end = () =>
        queueMicrotask(() => {
          const fixture = responses.shift()
          assert(fixture, 'Unexpected request')
          const res = new EventEmitter()
          res.statusCode = fixture.status ?? 200
          res.headers = fixture.headers ?? { 'content-type': 'text/html; charset=utf-8' }
          res.destroy = () => {
            res.destroyed = true
          }
          callback(res)
          if (res.destroyed) return
          for (const chunk of fixture.chunks ?? [fixture.body ?? '']) {
            res.emit('data', Buffer.from(chunk))
            if (res.destroyed) return
          }
          res.emit('end')
        })
      return req
    }
  }
})
const search = load('src/main/network/search-provider.ts', {
  './exa-search': {},
  '../services/isolated-parser': {
    parsePdf: async (bytes) => {
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
      return { text: 'Quantum lesson', pages: ['data:image/jpeg;base64,YQ=='] }
    }
  },
  './html-text': htmlText,
  crypto,
  '../settings': settingsModule,
  '../security/run-manager': runs,
  './url-policy': policy,
  './public-page': page,
  '../security/credentials': {
    searchKey: () => {
      throw new Error('Key must not be used for DuckDuckGo')
    }
  },
  './json-request': {
    requestJson: () => {
      throw new Error('Brave must not be used')
    }
  }
})
const start = () => runs.startRun('assistant', 'http://127.0.0.1:1234/v1', '')
async function main() {
  const signal = new AbortController().signal
  for (const url of [
    'http://example.org',
    'https://127.1/',
    'https://user:pass@example.org',
    'https://example.org:444',
    'file:///secret',
    'https://foo.internal'
  ])
    await assert.rejects(page.requestPublicText(url, signal), /public HTTPS/)
  assert.equal(requests.length, 0)
  addresses = [{ address: '127.0.0.1', family: 4 }]
  await assert.rejects(page.requestPublicText('https://example.org', signal), /non-public/)
  addresses = [
    { address: '93.184.215.14', family: 4 },
    { address: '10.0.0.1', family: 4 }
  ]
  await assert.rejects(page.requestPublicText('https://example.org', signal), /non-public/)
  assert.equal(requests.length, 0)
  addresses = [{ address: '93.184.215.14', family: 4 }]
  responses = [{ status: 302, headers: { location: 'https://127.0.0.1/private' } }]
  await assert.rejects(page.requestPublicText('https://example.org', signal), /public HTTPS/)
  responses = [{ status: 302, headers: { location: 'http://example.org/downgrade' } }]
  await assert.rejects(page.requestPublicText('https://example.org', signal), /public HTTPS/)
  responses = Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/loop' } }))
  await assert.rejects(page.requestPublicText('https://example.org', signal), /three-redirect/)
  for (const fixture of [
    { headers: { 'content-type': 'application/octet-stream' } },
    { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } },
    { headers: { 'content-type': 'text/html', 'content-length': '1048577' } },
    { headers: { 'content-type': 'text/html; charset=shift_jis' } },
    { chunks: ['a'.repeat(700000), 'b'.repeat(700000)] },
    { status: 403 }
  ]) {
    responses = [fixture]
    await assert.rejects(page.requestPublicText('https://example.org', signal))
  }
  responses = [{ headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.7 test' }]
  const pdf = await page.requestPublicText('https://example.org/lesson.pdf', signal)
  assert.equal(pdf.body, 'Quantum lesson')
  assert.equal(pdf.pages.length, 1)
  responses = [{ headers: { 'content-type': 'application/pdf', 'content-length': '8388609' } }]
  await assert.rejects(page.requestPublicText('https://example.org/large.pdf', signal), /8 MB/)
  const controller = new AbortController()
  controller.abort()
  const before = requests.length
  await assert.rejects(page.requestPublicText('https://example.org', controller.signal))
  assert.equal(requests.length, before)
  responses = [
    { status: 302, headers: { location: 'https://example.net/article' } },
    {
      body:
        '<title>Study &amp; learn</title><script>SECRET_SCRIPT</script><style>SECRET_STYLE</style><p>Useful evidence &#x1f600;</p><a href="/details">Details</a><a href="https://127.0.0.1">private</a>' +
        ' content'.repeat(3000)
    }
  ]
  let run = start()
  const source = await page.webFetch('https://example.org', run)
  assert.equal(source.url, 'https://example.net/article')
  assert.equal(source.title, 'Study & learn')
  assert.equal(source.text.length, 7500)
  assert(source.truncated)
  assert(!source.text.includes('SECRET'))
  assert(source.text.includes('😀'))
  assert.deepEqual(source.links, [{ title: 'Details', url: 'https://example.net/details' }])
  assert.equal(run.sources[0].id, source.id)
  assert.equal(source.provenance, 'untrusted-web')
  const sent = requests.at(-1)
  assert.equal(sent.options.agent, false)
  assert.equal(sent.options.method, 'GET')
  assert(!('Cookie' in sent.options.headers))
  assert(!('Authorization' in sent.options.headers))
  sent.options.lookup('example.net', {}, (err, address) => {
    assert.equal(err, null)
    assert.equal(address, '93.184.215.14')
  })
  run.pages = 6
  await assert.rejects(page.webFetch('https://example.org', run), /six calls/)
  runs.finishRun(run)
  await assert.rejects(page.webFetch('https://example.org', run))
  settings.model.contextWindow = 4096
  run = start()
  responses = [{ body: 'small '.repeat(1000), headers: { 'content-type': 'text/plain' } }]
  assert.equal((await page.webFetch('https://example.org', run)).text.length, 1000)
  runs.finishRun(run)
  const html =
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fstudy&amp;rut=x">Study &amp; learn</a><a class="result__snippet">Evidence <b>here</b>.</a><a class="result__a" href="https://127.0.0.1/private">private</a>'
  run = start()
  responses = [{ body: html }]
  const results = await search.webSearch('public study question', run)
  assert.equal(results.length, 1)
  assert.equal(results[0].url, 'https://example.org/study')
  assert.equal(results[0].snippet, 'Evidence here .')
  assert.equal(requests.at(-1).url.hostname, 'html.duckduckgo.com')
  assert.equal(requests.at(-1).url.searchParams.get('q'), 'public study question')
  assert(!JSON.stringify(requests.at(-1).options.headers).includes('Subscription'))
  responses = [{ status: 202 }]
  await assert.rejects(search.webSearch('another public question', run), /blocked or rate-limited/)
  assert.throws(() => search.duckDuckGoResults('<form>CAPTCHA challenge</form>'), /CAPTCHA/)
  assert.deepEqual(search.duckDuckGoResults('<div class="result--no-result">No results</div>'), [])
  runs.finishRun(run)
  const registry = load('src/main/tools/registry.ts')
  settings.tools = registry.defaultToolPermissions()
  settings.model.endpoint = 'http://127.0.0.1:1234/v1'
  settings.files = { workspace: '' }
  const authorization = load('src/main/security/policy.ts', {
    '../settings': settingsModule,
    '../tools/registry': registry,
    './run-manager': runs
  })
  run = start()
  settings.research.enabled = false
  assert.throws(() => authorization.authorizeTool(run, 'web_fetch'), /disabled/)
  settings.research.enabled = true
  settings.tools.web_fetch = 'block'
  assert.throws(() => authorization.authorizeTool(run, 'web_fetch'), /policy/)
  runs.finishRun(run)
  console.log(
    'PASS public-only DNS/socket binding, redirect checks, bounded text transport, cancellation, page provenance, context limits, keyless search and permission gates'
  )
  if (process.argv.includes('--live')) {
    const publicPolicy = load('src/main/network/url-policy.ts', {
      net: require('node:net'),
      'dns/promises': require('node:dns/promises')
    })
    const publicPage = load('src/main/network/public-page.ts', {
      https: require('node:https'),
      crypto,
      './url-policy': publicPolicy,
      '../services/isolated-parser': {
        parsePdf: async (bytes) => {
          assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
          return { text: 'Quantum lesson', pages: ['data:image/jpeg;base64,YQ=='] }
        }
      },
      './html-text': htmlText,
      '../settings': settingsModule,
      '../security/run-manager': runs
    })
    const publicSearch = load('src/main/network/search-provider.ts', {
      './exa-search': load('src/main/network/exa-search.ts', {
        https: require('node:https'),
        './url-policy': publicPolicy
      }),
      crypto,
      './url-policy': publicPolicy,
      './public-page': publicPage,
      '../services/isolated-parser': {
        parsePdf: async (bytes) => {
          assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
          return { text: 'Quantum lesson', pages: ['data:image/jpeg;base64,YQ=='] }
        }
      },
      './html-text': htmlText,
      '../settings': settingsModule,
      '../security/run-manager': runs,
      '../security/credentials': {},
      './json-request': {}
    })
    run = start()
    try {
      settings.research.provider = process.argv.includes('--duckduckgo') ? 'duckduckgo' : 'exa'
      const livePage = await publicPage.webFetch('https://example.org', run)
      assert(livePage.text.includes('Example Domain'))
      console.log('PASS live public HTTPS page read')
      for (const query of ['photosynthesis definition', 'Berlin weather today']) {
        const liveSearch = await publicSearch.webSearch(query, run)
        assert(liveSearch.length > 0)
        assert(
          liveSearch.every(
            (source) => source.taskId === run.id && source.provenance === 'untrusted-web'
          )
        )
        console.log(liveSearch.map(({ title, url }) => ({ title, url })))
        console.log(
          `PASS live ${settings.research.provider} search: ${query}: ${liveSearch.length} public results`
        )
      }
    } finally {
      runs.finishRun(run)
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
