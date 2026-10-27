const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
module.exports = async function ({ load }) {
  const { requestJson } = load('src/main/network/json-request.ts', {
    http,
    https,
    './sse': load('src/main/network/sse.ts', { string_decoder: require('node:string_decoder') })
  })
  let requests = 0,
    redirected = false
  const server = http.createServer((request, response) => {
    requests++
    assert.equal(request.headers.cookie, undefined)
    assert.equal(request.headers.authorization, undefined)
    assert.equal(request.headers.referer, undefined)
    assert.equal(request.headers['accept-encoding'], 'identity')
    if (request.url === '/redirect') {
      response.writeHead(307, { Location: '/recipient' })
      response.end()
      return
    }
    if (request.url === '/recipient') redirected = true
    if (request.url === '/empty') {
      response.writeHead(200)
      response.end()
      return
    }
    if (request.url === '/oauth-error' || request.url === '/oauth-large-error') {
      response.writeHead(400, { 'Content-Type': 'application/json', 'x-request-id': 'req_fixture' })
      response.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description:
            request.url === '/oauth-large-error' ? 'x'.repeat(9000) : 'SECRET_TOKEN_CANARY'
        })
      )
      return
    }
    if (request.url === '/plan-limit') {
      response.writeHead(429, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          error: {
            code: 'subscription_sharing_usage_limit_exceeded',
            message: 'SECRET_TOKEN_CANARY'
          }
        })
      )
      return
    }
    if (request.url === '/slow') return
    if (request.url === '/compressed') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
      response.end('{}')
      return
    }
    if (request.url === '/html') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<script>bad</script>')
      return
    }
    if (request.url === '/headers') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'x-large': 'x'.repeat(40000) })
      response.end('{}')
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(request.url === '/large' ? JSON.stringify('x'.repeat(5000)) : '{"ok":true}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = (path) => new URL(`http://127.0.0.1:${server.address().port}${path}`)
  try {
    assert.deepEqual(await requestJson(url('/ok')), { ok: true })
    await assert.rejects(
      requestJson(url('/redirect'), { body: 'synthetic-private-canary' }),
      /Redirects/
    )
    assert.equal(redirected, false)
    await assert.rejects(requestJson(url('/compressed')), /Compressed/)
    await assert.rejects(requestJson(url('/html')), /JSON/)
    await assert.rejects(requestJson(url('/headers')))
    await assert.rejects(requestJson(url('/large'), { maxBytes: 1000 }), /byte budget/)
    const controller = new AbortController()
    const pending = requestJson(url('/slow'), { signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pending, /stopped|timed out/)
    await assert.rejects(requestJson(url('/slow'), { timeout: 20 }), /stopped|timed out/)
    assert.equal(await requestJson(url('/empty'), { allowEmpty: true }), null)
    await assert.rejects(requestJson(url('/empty')), /JSON/)
    await assert.rejects(requestJson(url('/oauth-error'), { errorDetails: true }), (error) => {
      assert.equal(error.code, 'invalid_grant')
      assert.equal(error.statusCode, 400)
      assert.equal(error.requestId, 'req_fixture')
      assert(!error.message.includes('SECRET_TOKEN_CANARY'))
      return true
    })
    await assert.rejects(requestJson(url('/plan-limit'), { errorDetails: true }), (error) => {
      assert.equal(error.code, 'subscription_sharing_usage_limit_exceeded')
      assert(!error.message.includes('SECRET_TOKEN_CANARY'))
      return true
    })
    await assert.rejects(
      requestJson(url('/oauth-large-error'), { errorDetails: true }),
      /detail too large/
    )
    assert.equal(requests, 13)
    console.log(
      'PASS real bounded transport: redirect POST cannot reach second recipient, no ambient credentials, compression/MIME/header/body limits, Stop and deadline'
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
