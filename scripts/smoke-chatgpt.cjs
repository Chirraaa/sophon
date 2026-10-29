const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { load, root } = require('./security/load.cjs')
const { createHarness } = require('../bench/harness.cjs')
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const get = (url) =>
  new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
  })

async function main() {
  const jose = await import('jose')
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256')
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'fixture-key', alg: 'RS256', use: 'sig' }
  const cache = path.join(root, '.cache/chatgpt-smoke')
  fs.mkdirSync(cache, { recursive: true })
  const profile = fs.mkdtempSync(path.join(cache, 'profile-'))
  const xor = (value) => Buffer.from(value).map((b) => b ^ 0x55)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => xor(Buffer.from(value)),
    decryptString: (value) => xor(value).toString()
  }
  const credentialFile = path.join(profile, 'chatgpt-auth.enc')
  const saved = () => JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile)))
  const save = (store) =>
    fs.writeFileSync(credentialFile, safeStorage.encryptString(JSON.stringify(store)))
  let authorization
  let browserOpened = deferred()
  let mode = 'normal'
  let serial = 0
  let subject = 'subscriber-one'
  let granted = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
  let tokenExchanges = 0
  let refreshes = 0
  let refreshGate
  let refreshEntered
  let refreshError
  let revokeFails = false
  const routes = []
  const sign = (clientId, nonce, claims = {}) =>
    new jose.SignJWT({ email: 'fixture@example.test', nonce, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer('https://auth.openai.com')
      .setSubject(subject)
      .setAudience(clientId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)
  const network = {
    requestJson: async (url, options = {}) => {
      routes.push(url.href)
      assert.equal(
        url.origin,
        'https://auth.openai.com',
        'Never use Codex backend endpoints or a third-party token service'
      )
      if (url.pathname === '/.well-known/jwks.json') return { keys: [jwk] }
      if (url.pathname === '/.well-known/openid-configuration')
        return { issuer: url.origin, revocation_endpoint: url.origin + '/oauth/revoke' }
      if (url.pathname === '/oauth/revoke') {
        if (revokeFails) throw new Error('Synthetic network failure')
        assert.equal(options.allowEmpty, true)
        assert.equal(new URLSearchParams(options.body).get('token_type_hint'), 'refresh_token')
        return null
      }
      assert.equal(url.pathname, '/api/accounts/oauth/token')
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
      const fields = new URLSearchParams(options.body)
      assert.equal(fields.get('resource'), 'https://api.openai.com/v1')
      if (fields.get('grant_type') === 'refresh_token') {
        refreshes++
        assert.notEqual(fields.get('client_id'), 'dynamic_agent_client')
        assert.equal(fields.get('scope'), null)
        if (refreshEntered) refreshEntered.resolve()
        if (refreshGate) await refreshGate.promise
        if (refreshError) throw refreshError
        serial++
        return {
          access_token: `access-${serial}`,
          refresh_token: `refresh-${serial}`,
          token_type: 'Bearer',
          expires_in: 3600
        }
      }
      tokenExchanges++
      assert.equal(fields.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
      assert.equal(
        crypto.createHash('sha256').update(fields.get('code_verifier')).digest('base64url'),
        authorization.searchParams.get('code_challenge')
      )
      assert.equal(fields.get('code'), 'fixture-code')
      assert.notEqual(fields.get('client_id'), 'dynamic_agent_client')
      serial++
      return {
        access_token: `access-${serial}`,
        refresh_token: `refresh-${serial}`,
        id_token: await sign(fields.get('client_id'), authorization.searchParams.get('nonce')),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: granted
      }
    }
  }
  const oauth = load('src/main/security/chatgpt-oauth.ts', {
    crypto,
    jose,
    '../network/json-request': network
  })
  const runs = load('src/main/security/run-manager.ts', { crypto })
  const auth = load('src/main/security/chatgpt-auth.ts', {
    electron: {
      app: { getPath: () => profile },
      safeStorage,
      shell: {
        openExternal: async (value) => {
          if (value.startsWith('https://chatgpt.com/')) return
          authorization = new URL(value)
          assert.equal(authorization.origin, 'https://auth.openai.com')
          assert.equal(
            authorization.searchParams.get('agent_name_hint'),
            authorization.searchParams.get('client_id') === 'dynamic_agent_client' ? 'Sophon' : null
          )
          assert(!authorization.searchParams.has('access_token'))
          browserOpened.resolve()
          if (mode === 'cancel') return
          const callback = new URL(authorization.searchParams.get('redirect_uri'))
          callback.search = new URLSearchParams({
            code: 'fixture-code',
            state: 'wrong-state',
            client_id:
              authorization.searchParams.get('client_id') === 'dynamic_agent_client'
                ? `oaiapp_fixture_${serial}`
                : authorization.searchParams.get('client_id')
          }).toString()
          assert.equal(
            await get(callback),
            400,
            'Wrong-state probes cannot consume the pending attempt'
          )
          callback.searchParams.set('state', authorization.searchParams.get('state'))
          if (mode === 'wrong-client') callback.searchParams.set('client_id', 'oaiapp_other')
          if (mode === 'declined') callback.searchParams.set('error', 'access_denied')
          const status = await get(callback)
          assert.equal(status, mode === 'wrong-client' || mode === 'declined' ? 400 : 200)
        }
      }
    },
    fs: {
      ...fs,
      readFileSync: (file, ...args) => {
        assert(String(file).startsWith(profile), 'Do not inspect or copy .codex/auth.json')
        return fs.readFileSync(file, ...args)
      }
    },
    path,
    crypto,
    http,
    '../network/json-request': network,
    './run-manager': runs,
    './chatgpt-oauth': oauth
  })
  assert.equal(auth.chatgptStatus().accounts.length, 0)
  const first = await auth.signInChatgpt()
  assert.equal(first.pending, false)
  assert.equal(first.accounts[0].planEnabled, true)
  assert.equal(first.welcome, true)
  const hostId = saved().hostId
  const firstId = first.activeId
  const firstClient = saved().accounts[0].clientId
  assert(!JSON.stringify(first).includes('access-'))
  assert(!JSON.stringify(first).includes('refresh-'))
  assert(!fs.readFileSync(credentialFile).includes(Buffer.from('access-')))
  auth.acknowledgeChatgptWelcome()
  assert.equal(auth.chatgptStatus().welcome, false)
  assert.equal(await auth.chatgptAccessToken(), 'access-1')
  mode = 'wrong-client'
  await assert.rejects(auth.signInChatgpt(firstId), /expected client ID/)
  assert.equal(tokenExchanges, 1, 'Client mismatch must fail before token exchange')
  mode = 'declined'
  await assert.rejects(auth.signInChatgpt(firstId), /declined/)
  assert.equal(tokenExchanges, 1)
  mode = 'cancel'
  browserOpened = deferred()
  const cancelled = auth.signInChatgpt(firstId)
  await browserOpened.promise
  auth.cancelChatgptSignIn()
  await assert.rejects(cancelled, /cancelled/)
  assert.equal(auth.chatgptStatus().pending, false)
  mode = 'normal'

  const goodIdToken = await sign(firstClient, 'expected-nonce')
  assert.equal(
    (await oauth.verifyChatgptIdentity(goodIdToken, firstClient, 'expected-nonce')).subject,
    subject
  )
  await assert.rejects(
    oauth.verifyChatgptIdentity(goodIdToken, firstClient, 'wrong-nonce'),
    /validation failed/
  )
  await assert.rejects(
    oauth.verifyChatgptIdentity(goodIdToken, 'other-client', 'expected-nonce'),
    /validation failed/
  )
  const parts = goodIdToken.split('.')
  parts[1] = Buffer.from(JSON.stringify({ sub: 'forged' })).toString('base64url')
  await assert.rejects(
    oauth.verifyChatgptIdentity(parts.join('.'), firstClient, 'expected-nonce'),
    /validation failed/
  )
  const badIssuer = await new jose.SignJWT({ nonce: 'n' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer('https://evil.example')
    .setSubject(subject)
    .setAudience(firstClient)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
  await assert.rejects(
    oauth.verifyChatgptIdentity(badIssuer, firstClient, 'n'),
    /validation failed/
  )
  const expired = await new jose.SignJWT({ nonce: 'n' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer('https://auth.openai.com')
    .setSubject(subject)
    .setAudience(firstClient)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(privateKey)
  await assert.rejects(oauth.verifyChatgptIdentity(expired, firstClient, 'n'), /validation failed/)

  let store = saved()
  store.accounts[0].expiresAt = 0
  save(store)
  refreshGate = deferred()
  refreshEntered = deferred()
  const renewal = auth.chatgptAccessToken()
  await refreshEntered.promise
  const concurrent = auth.chatgptAccessToken()
  refreshGate.resolve()
  assert.equal(await renewal, await concurrent)
  assert.equal(refreshes, 1, 'Only one refresh may rotate the session at a time')
  refreshGate = undefined
  refreshEntered = undefined
  assert.notEqual(saved().accounts[0].refreshToken, 'refresh-1')

  subject = 'subscriber-two'
  granted = 'openid profile email offline_access resource.invoke'
  const second = await auth.signInChatgpt()
  assert.equal(second.accounts.length, 2)
  assert.equal(second.accounts.find((a) => a.id === second.activeId).planEnabled, false)
  assert.equal(second.welcome, false)
  await assert.rejects(auth.chatgptAccessToken(), /not enabled/)
  const run = runs.startRun('assistant', 'https://api.openai.com/v1', '')
  auth.selectChatgptAccount(firstId)
  assert.throws(() => runs.assertRun(run), /authorized|abort|Stopped/i)
  runs.finishRun(run)
  assert.equal(saved().hostId, hostId)
  assert.equal(saved().accounts.find((a) => a.id === firstId).clientId, firstClient)

  store = saved()
  store.accounts.find((a) => a.id === firstId).expiresAt = 0
  save(store)
  refreshError = Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' })
  await assert.rejects(auth.chatgptAccessToken(), /expired or was revoked/)
  assert.equal(auth.chatgptStatus().accounts.find((a) => a.id === firstId).signedIn, false)
  refreshError = undefined
  subject = 'subscriber-one'
  granted = oauth.CHATGPT_SCOPES
  await auth.signInChatgpt(firstId)
  assert.equal(authorization.searchParams.get('client_id'), firstClient)
  assert.equal(authorization.searchParams.get('ext_agent_host_id'), hostId)
  assert.equal(auth.chatgptStatus().welcome, false)
  const signedOut = await auth.signOutChatgpt()
  assert.equal(signedOut.revoked, true)
  assert(!saved().accounts.find((a) => a.id === firstId).refreshToken)
  assert.equal(saved().accounts.find((a) => a.id === firstId).clientId, firstClient)
  await assert.rejects(auth.chatgptAccessToken(), /Continue with ChatGPT/)
  await auth.signInChatgpt(firstId)
  revokeFails = true
  assert.equal((await auth.signOutChatgpt()).revoked, false)
  assert.equal(auth.chatgptStatus().activeId, undefined)
  assert(routes.every((value) => !value.includes('backend-api')))

  const response = (...output) => ({
    status: 'completed',
    output,
    usage: { input_tokens: 120, output_tokens: 18 }
  })
  const call = (name, args, call_id = 'plan_call') => ({
    type: 'function_call',
    namespace: 'sophon',
    call_id,
    name,
    arguments: JSON.stringify(args)
  })
  const message = (value) => ({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: value }]
  })
  const config = {
    provider: 'chatgpt',
    endpoint: 'https://api.openai.com/v1',
    modelId: 'fixture-plan-model',
    reasoningEffort: 'high'
  }
  const harness = createHarness(
    {
      id: 'subscription-tools',
      files: { 'package.json': JSON.stringify({ scripts: { test: 'node test.cjs' } }) },
      toolResults: {
        list_files: '[file] package.json',
        run_npm: JSON.stringify({ exitCode: 0, stopped: false })
      },
      streamResponses: true,
      prompt: 'Read source.txt and create copy.txt',
      responses: [
        response(
          { type: 'reasoning', id: 'rs_plan', summary: [], encrypted_content: 'encrypted-plan' },
          call('read_file', { path: 'source.txt' })
        ),
        response(
          call('write_file', { path: 'copy.txt', content: 'alpha\nbeta\ngamma' }, 'plan_write')
        ),
        response(message('Saved copy.txt.'))
      ]
    },
    0,
    config
  )
  const result = await harness.run()
  assert(!result.error, result.error)
  assert.deepEqual(
    result.calls.map((call) => call.name),
    ['read_file', 'write_file', 'list_files', 'read_file', 'run_npm']
  )
  for (const { body } of result.requests) {
    assert.deepEqual(body.reasoning, { effort: 'high' })
    assert.equal(body.stream, true)
    assert.equal(body.store, false)
    assert.equal(body.max_output_tokens, undefined)
    assert.equal(body.temperature, undefined)
    assert(!body.input.some((item) => item.role === 'system'))
    if (body.tools)
      assert(body.tools.every((tool) => tool.type === 'namespace' && tool.name === 'sophon'))
  }
  assert(
    result.requests[1].body.input.some(
      (item) => item.type === 'function_call' && item.namespace === 'sophon'
    )
  )
  assert(!JSON.stringify(result).includes('fixture-oauth-token'))

  let outgoing
  let streamFailure = false
  let tokenUsed = false
  const providers = load('src/main/llm/providers.ts')
  const sparseTools = providers.responsesStream(() => {}, config.modelId, 'sophon')
  sparseTools.accept(
    JSON.stringify({
      type: 'response.output_item.done',
      output_index: 0,
      item: call('list_windows', {})
    })
  )
  assert.throws(() => sparseTools.reply(), /before completing/)
  sparseTools.accept(JSON.stringify({ type: 'response.completed', response: response() }))
  assert.equal(sparseTools.reply().finishReason, 'tool_calls')
  assert.equal(sparseTools.reply().tool_calls[0].function.name, 'list_windows')
  assert.equal(sparseTools.reply().tool_calls.length, 1)
  const incompleteSparseTools = providers.responsesStream(() => {}, config.modelId, 'sophon')
  incompleteSparseTools.accept(
    JSON.stringify({
      type: 'response.output_item.done',
      output_index: 0,
      item: call('list_windows', {})
    })
  )
  assert.throws(
    () =>
      incompleteSparseTools.accept(
        JSON.stringify({
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            output: [],
            incomplete_details: { reason: 'max_output_tokens' }
          }
        })
      ),
    /incomplete tool batch/
  )
  const unknownNamespace = providers.responsesStream(() => {}, config.modelId, 'sophon')
  unknownNamespace.accept(
    JSON.stringify({
      type: 'response.output_item.done',
      output_index: 0,
      item: { ...call('list_windows', {}), namespace: 'other' }
    })
  )
  assert.throws(
    () =>
      unknownNamespace.accept(JSON.stringify({ type: 'response.completed', response: response() })),
    /unknown tool namespace/
  )
  const streamedUpdates = []
  const sparseStream = providers.responsesStream(
    (text) => streamedUpdates.push(text),
    config.modelId,
    'sophon'
  )
  sparseStream.accept(JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello' }))
  sparseStream.accept(JSON.stringify({ type: 'response.output_text.delta', delta: ' there!' }))
  assert.throws(() => sparseStream.reply(), /before completing/)
  sparseStream.accept(JSON.stringify({ type: 'response.completed', response: response() }))
  assert.deepEqual(streamedUpdates, ['Hello', 'Hello there!'])
  assert.equal(sparseStream.reply().content, 'Hello there!')
  assert.equal(sparseStream.reply().finishReason, 'stop')
  const canonicalStream = providers.responsesStream(() => {}, config.modelId)
  canonicalStream.accept(JSON.stringify({ type: 'response.output_text.delta', delta: 'Draft' }))
  canonicalStream.accept(
    JSON.stringify({ type: 'response.completed', response: response(message('Final answer')) })
  )
  assert.equal(canonicalStream.reply().content, 'Final answer')
  const failedStream = providers.responsesStream(() => {}, config.modelId, 'sophon')
  failedStream.accept(JSON.stringify({ type: 'response.output_text.delta', delta: 'Partial' }))
  assert.throws(
    () =>
      failedStream.accept(
        JSON.stringify({
          type: 'response.failed',
          response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } }
        })
      ),
    /plan usage limit reached/
  )
  assert.throws(() => failedStream.reply(), /before completing/)
  const partialTools = providers.responsesStream(() => {}, config.modelId, 'sophon')
  partialTools.accept(JSON.stringify({ type: 'response.output_text.delta', delta: 'Partial' }))
  assert.throws(
    () =>
      partialTools.accept(
        JSON.stringify({
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [call('read_file', { path: 'source.txt' })]
          }
        })
      ),
    /incomplete tool batch/
  )
  let statusRequests = 0
  const client = load('src/main/llm/client.ts', {
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
    './stream': load('src/main/llm/stream.ts'),
    './providers': providers,
    './anthropic': load('src/main/llm/anthropic.ts'),
    '../settings': { getSettings: () => ({ model: { ...harness.settings.model, ...config } }) },
    '../tools': { activeToolSchemas: () => [] },
    '../network/endpoint': load('src/main/network/endpoint.ts'),
    '../security/run-manager': { currentRun: () => undefined },
    '../security/model-credentials': {
      modelKey: () => {
        throw new Error('Never use paid API credentials for a subscription request')
      }
    },
    '../security/chatgpt-auth': {
      chatgptStatus: () => ({ activeId: 'fixture-chatgpt', accounts: [] }),
      chatgptAccountScope: () => 'fixture-chatgpt',
      chatgptAccessToken: async () => {
        tokenUsed = true
        return 'fixture-plan-access'
      }
    },
    './context': harness.context,
    '../network/json-request': {
      requestJson: async (url, options) => {
        assert(tokenUsed)
        outgoing = { url, options, body: options.body && JSON.parse(options.body) }
        if (url.pathname.endsWith('/models')) {
          statusRequests++
          return {
            models: [
              {
                slug: 'fixture-plan-model',
                display_name: 'Fixture model',
                visibility: 'list',
                supported_reasoning_levels: [
                  { effort: 'low' },
                  { effort: 'high' },
                  { effort: 'xhigh' }
                ]
              },
              { slug: 'hidden', visibility: 'hide' }
            ]
          }
        }
        assert(
          options.onEvent,
          'Subscription requests always consume SSE, including specialist calls without text callbacks'
        )
        if (streamFailure)
          options.onEvent(
            JSON.stringify({
              type: 'response.failed',
              response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } }
            })
          )
        options.onEvent(JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello' }))
        options.onEvent(
          JSON.stringify({ type: 'response.completed', response: response(message('Hello')) })
        )
        return null
      }
    }
  })
  assert.deepEqual(await client.listModels(), ['fixture-plan-model'])
  assert.deepEqual(await client.listModelChoices(), [
    {
      id: 'fixture-plan-model',
      label: 'Fixture model',
      reasoningEfforts: ['low', 'high', 'xhigh'],
      reasoningSource: 'provider'
    }
  ])
  const beforeStatus = statusRequests
  const statuses = await Promise.all(Array.from({ length: 20 }, () => client.getLlmStatus()))
  assert(statuses.every((status) => status.online))
  await client.getLlmStatus()
  assert.equal(
    statusRequests,
    beforeStatus + 1,
    'Concurrent and repeated status polls share one request'
  )
  const selectedModel = config.modelId
  config.modelId = 'another-fixture-model'
  assert.equal((await client.getLlmStatus()).model, config.modelId)
  assert.equal(statusRequests, beforeStatus + 2, 'Changing models invalidates the status cache')
  config.modelId = selectedModel
  assert.equal(
    (
      await client.callLLM(config.modelId, [
        { role: 'system', content: 'App instructions' },
        { role: 'user', content: 'Hi' }
      ])
    ).content,
    'Hello'
  )
  assert.equal(outgoing.options.headers.Authorization, 'Bearer fixture-plan-access')
  assert.equal(outgoing.body.input[0].role, 'developer')
  assert.equal(outgoing.body.max_output_tokens, undefined)
  assert.deepEqual(outgoing.body.reasoning, { effort: 'high' })
  const originalWindow = config.contextWindow
  config.contextWindow = 2048
  const largeInput = 'Full ChatGPT context '.repeat(5000)
  assert.equal(
    (await client.callLLM(config.modelId, [{ role: 'user', content: largeInput }])).content,
    'Hello'
  )
  assert(JSON.stringify(outgoing.body.input).includes(largeInput))
  assert.equal(outgoing.body.max_output_tokens, undefined)
  config.contextWindow = originalWindow
  streamFailure = true
  await assert.rejects(
    client.callLLM(config.modelId, [{ role: 'user', content: 'Hi' }]),
    /plan usage limit reached/
  )
  assert.throws(
    () =>
      providers.responsesReply(
        response({ ...call('list_windows', {}), namespace: 'other' }),
        config.modelId,
        'sophon'
      ),
    /unknown tool namespace/
  )
  const reasoningMessage = {
    role: 'assistant',
    content: '',
    responseState: {
      model: config.modelId,
      scope: 'account-one',
      reasoning: [{ type: 'reasoning', encrypted_content: 'private-reasoning' }]
    }
  }
  assert(
    providers
      .responsesInput([reasoningMessage], config.modelId, 'sophon', 'account-one')
      .some((item) => item.type === 'reasoning')
  )
  assert(
    !providers
      .responsesInput([reasoningMessage], config.modelId, 'sophon', 'account-two')
      .some((item) => item.type === 'reasoning'),
    'Do not replay encrypted reasoning to a different ChatGPT connection'
  )

  fs.unlinkSync(credentialFile)
  fs.rmdirSync(profile)
  console.log(
    'PASS ChatGPT OAuth PKCE/state/client/identity validation, cancellation, encrypted account isolation, scope gating, serialized token rotation, sign-out/revocation, subscription tool loop, streaming and usage errors; no real account or inference calls'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
