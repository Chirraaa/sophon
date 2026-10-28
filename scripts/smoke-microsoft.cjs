const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { load, root } = require('./security/load.cjs')

const CLIENT = '11111111-2222-4333-8444-555555555555'
const TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'
const OTHER_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47'
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const get = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
  })

async function main() {
  const jose = await import('jose')
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256')
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'fixture-key', alg: 'RS256', use: 'sig' }
  const keys = { keys: [jwk] }
  const sign = (claims = {}, options = {}) =>
    new jose.SignJWT({
      tid: TENANT,
      oid: 'object-one',
      email: 'one@example.test',
      name: 'User One',
      nonce: 'n',
      ...claims
    })
      .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: jwk.kid })
      .setIssuer(options.issuer ?? `https://login.microsoftonline.com/${claims.tid ?? TENANT}/v2.0`)
      .setSubject('pairwise-sub')
      .setAudience(options.audience ?? CLIENT)
      .setIssuedAt(options.iat)
      .setExpirationTime(options.exp ?? '1h')
      .sign(privateKey)

  // ---- Protocol helpers
  const oauth = load('src/main/security/microsoft-oauth.ts', {
    crypto,
    jose,
    '../network/json-request': { requestJson: async () => keys }
  })
  assert(oauth.validClientId(CLIENT))
  for (const bad of ['', 'not-a-guid', CLIENT + 'x', undefined, 42, '{' + CLIENT + '}'])
    assert(!oauth.validClientId(bad), String(bad))

  for (const uri of [
    'http://127.0.0.1:5000/',
    'https://localhost:5000/',
    'http://localhost/',
    'http://localhost:5000/auth/callback',
    'http://localhost:5000/?x=1',
    'http://user@localhost:5000/'
  ])
    assert.throws(() => oauth.microsoftAttempt(uri), /Invalid Microsoft loopback/, uri)
  const attempt = oauth.microsoftAttempt('http://localhost:5000/')
  const add = new URL(oauth.microsoftAuthorizationUrl(attempt, CLIENT))
  assert.equal(
    add.origin + add.pathname,
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
  )
  assert.equal(add.searchParams.get('client_id'), CLIENT)
  assert.equal(add.searchParams.get('response_type'), 'code')
  assert.equal(add.searchParams.get('redirect_uri'), 'http://localhost:5000/')
  assert.equal(add.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(
    add.searchParams.get('code_challenge'),
    crypto.createHash('sha256').update(attempt.verifier).digest('base64url')
  )
  assert.equal(add.searchParams.get('prompt'), 'select_account', 'adding shows the account chooser')
  assert(!add.searchParams.has('client_secret'))
  assert.deepEqual(add.searchParams.get('scope').split(' '), oauth.MICROSOFT_SCOPES)
  const hinted = new URL(
    oauth.microsoftAuthorizationUrl(attempt, CLIENT, { loginHint: 'a@b.test' })
  )
  assert.equal(hinted.searchParams.get('login_hint'), 'a@b.test')
  assert(!hinted.searchParams.has('prompt'))
  assert.throws(() => oauth.microsoftAuthorizationUrl(attempt, 'bad'), /application ID/)

  const query = (entries) => new URLSearchParams(entries)
  assert.equal(
    oauth.microsoftCallbackCode(query({ state: attempt.state, code: 'abc' }), attempt),
    'abc'
  )
  assert.throws(
    () => oauth.microsoftCallbackCode(query({ state: 'wrong', code: 'abc' }), attempt),
    /state/
  )
  assert.throws(
    () =>
      oauth.microsoftCallbackCode(query({ state: attempt.state, error: 'access_denied' }), attempt),
    /declined/
  )
  assert.throws(
    () =>
      oauth.microsoftCallbackCode(
        query({ state: attempt.state, error: 'server_error', error_description: 'secret detail' }),
        attempt
      ),
    (error) => /did not complete/.test(error.message) && !/secret/.test(error.message)
  )
  assert.throws(
    () =>
      oauth.microsoftCallbackCode(
        new URLSearchParams(`state=${attempt.state}&code=a&code=b`),
        attempt
      ),
    /Ambiguous/
  )
  assert.throws(
    () => oauth.microsoftCallbackCode(query({ state: attempt.state }), attempt),
    /valid code/
  )
  assert.deepEqual(
    oauth.normalizeScopes('https://graph.microsoft.com/User.Read openid  Calendars.ReadWrite'),
    ['User.Read', 'openid', 'Calendars.ReadWrite']
  )

  const identity = await oauth.verifyMicrosoftIdentity(await sign(), CLIENT, 'n', keys)
  assert.deepEqual(identity, {
    subject: 'object-one',
    tenantId: TENANT,
    email: 'one@example.test',
    name: 'User One'
  })
  const bad = async (token, nonce = 'n', client = CLIENT) =>
    assert.rejects(
      oauth.verifyMicrosoftIdentity(await token, client, nonce, keys),
      /validation failed/
    )
  await bad(sign({}, { audience: 'someone-else' }))
  await bad(sign(), 'other-nonce')
  await bad(sign({}, { issuer: 'https://evil.example/v2.0' }))
  await bad(sign({}, { issuer: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }), 'n')
  await bad(sign({ tid: 'not-a-guid' }))
  await bad(sign({}, { exp: Math.floor(Date.now() / 1000) - 3600 }))
  await bad(sign({}, { iat: Math.floor(Date.now() / 1000) + 3600 }))
  await bad(sign() + 'x')
  await assert.rejects(
    oauth.verifyMicrosoftIdentity(await sign(), CLIENT, 'n', { keys: [] }),
    /validation failed/
  )
  assert.equal(
    (
      await oauth.verifyMicrosoftIdentity(
        await sign({ email: undefined, preferred_username: 'pu@x.test' }),
        CLIENT,
        'n',
        keys
      )
    ).email,
    'pu@x.test'
  )

  // ---- Account store and browser flow
  const cache = path.join(root, '.cache/microsoft-smoke')
  fs.mkdirSync(cache, { recursive: true })
  const profile = fs.mkdtempSync(path.join(cache, 'profile-'))
  const xor = (value) => Buffer.from(value).map((b) => b ^ 0x55)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => xor(Buffer.from(value)),
    decryptString: (value) => xor(value).toString()
  }
  const credentialFile = path.join(profile, 'microsoft-auth.enc')
  const saved = () => JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile)))
  let authorization
  let mode = 'normal'
  let browserOpened = deferred()
  let serial = 0
  let person = { oid: 'object-one', email: 'one@example.test', tid: TENANT }
  let granted = 'openid profile email User.Read https://graph.microsoft.com/Calendars.ReadWrite'
  let refreshes = 0
  let exchanges = 0
  let refreshGate
  let refreshError
  const network = {
    requestJson: async (url, options = {}) => {
      assert.equal(
        url.origin,
        'https://login.microsoftonline.com',
        'only Microsoft sign-in endpoints'
      )
      if (url.pathname === '/common/discovery/v2.0/keys') return keys
      assert.equal(url.pathname, '/common/oauth2/v2.0/token')
      const fields = new URLSearchParams(options.body)
      assert.equal(fields.get('client_id'), CLIENT)
      assert(!fields.has('client_secret'), 'public client: no secret')
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
      if (fields.get('grant_type') === 'refresh_token') {
        refreshes++
        assert(fields.get('scope').includes('Calendars.ReadWrite'))
        if (refreshGate) await refreshGate.promise
        if (refreshError) throw refreshError
        serial++
        return {
          access_token: `access-${serial}`,
          refresh_token: `refresh-${serial}`,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: granted
        }
      }
      exchanges++
      assert.equal(fields.get('grant_type'), 'authorization_code')
      assert.equal(fields.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
      assert.equal(
        crypto.createHash('sha256').update(fields.get('code_verifier')).digest('base64url'),
        authorization.searchParams.get('code_challenge')
      )
      assert.equal(fields.get('code'), 'fixture-code')
      serial++
      return {
        access_token: `access-${serial}`,
        refresh_token: `refresh-${serial}`,
        id_token: await sign(
          {
            oid: person.oid,
            email: person.email,
            tid: person.tid,
            nonce: authorization.searchParams.get('nonce')
          },
          {}
        ),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: granted
      }
    }
  }
  const realOauth = load('src/main/security/microsoft-oauth.ts', {
    crypto,
    jose,
    '../network/json-request': network
  })
  const runs = load('src/main/security/run-manager.ts', { crypto })
  const auth = load('src/main/security/microsoft-auth.ts', {
    electron: {
      app: { getPath: () => profile },
      safeStorage,
      shell: {
        openExternal: async (value) => {
          authorization = new URL(value)
          assert.equal(authorization.origin, 'https://login.microsoftonline.com')
          assert(!authorization.searchParams.has('access_token'))
          browserOpened.resolve()
          if (mode === 'cancel') return
          const callback = new URL(authorization.searchParams.get('redirect_uri'))
          assert.equal(callback.hostname, 'localhost')
          const local = new URL(callback.href)
          local.hostname = '127.0.0.1'
          local.search = new URLSearchParams({
            code: 'fixture-code',
            state: 'wrong-state'
          }).toString()
          assert.equal(await get(local), 400, 'a wrong-state probe cannot consume the attempt')
          local.searchParams.set('state', authorization.searchParams.get('state'))
          assert.equal(
            await get(local, { Host: `evil.example:${callback.port}` }),
            400,
            'foreign Host headers are refused'
          )
          local.pathname = '/other'
          assert.equal(await get(local), 400)
          local.pathname = '/'
          if (mode === 'declined') local.searchParams.set('error', 'access_denied')
          assert.equal(await get(local), mode === 'declined' ? 400 : 200)
        }
      }
    },
    fs: {
      ...fs,
      readFileSync: (file, ...args) => {
        assert(String(file).startsWith(profile), 'only the app profile is read')
        return fs.readFileSync(file, ...args)
      }
    },
    path,
    crypto,
    http,
    '../network/json-request': network,
    './run-manager': runs,
    './microsoft-oauth': realOauth
  })

  assert.deepEqual(auth.microsoftStatus(), {
    clientId: '',
    pending: false,
    activeId: undefined,
    accounts: []
  })
  await assert.rejects(auth.signInMicrosoft(), /application \(client\) ID first/)
  for (const invalid of ['abc', CLIENT.slice(1), 'x'.repeat(40)])
    assert.throws(() => auth.setMicrosoftClientId(invalid), /Application \(client\) ID/)
  assert.equal(auth.setMicrosoftClientId(`  ${CLIENT}  `).clientId, CLIENT)

  // Add the first account
  const first = await auth.signInMicrosoft()
  assert.equal(first.pending, false)
  assert.equal(first.accounts.length, 1)
  assert.equal(first.accounts[0].email, 'one@example.test')
  assert.equal(first.accounts[0].name, 'User One')
  assert.equal(first.accounts[0].calendar, true, 'URL-form scopes are normalized')
  assert.equal(first.activeId, first.accounts[0].id)
  const firstId = first.activeId
  assert(!JSON.stringify(first).includes('access-') && !JSON.stringify(first).includes('refresh-'))
  assert(
    !fs.readFileSync(credentialFile).includes(Buffer.from('refresh-')),
    'tokens are encrypted at rest'
  )
  assert.equal(await auth.microsoftAccessToken(), 'access-1')
  assert.equal(
    await auth.microsoftAccessToken(firstId, 'Calendars.ReadWrite'),
    'access-1',
    'cached'
  )
  assert.equal(refreshes, 0)

  // Declined, cancelled and mismatched sign-ins change nothing
  mode = 'declined'
  await assert.rejects(auth.signInMicrosoft(), /declined/)
  assert.equal(exchanges, 1, 'declining never reaches the token exchange')
  mode = 'cancel'
  browserOpened = deferred()
  const cancelled = auth.signInMicrosoft()
  await browserOpened.promise
  assert.equal(auth.microsoftStatus().pending, true)
  await assert.rejects(auth.signInMicrosoft(), /already in progress/)
  auth.cancelMicrosoftSignIn()
  await assert.rejects(cancelled, /cancelled/)
  assert.equal(auth.microsoftStatus().pending, false)
  mode = 'normal'
  person = { oid: 'object-two', email: 'two@example.test', tid: TENANT }
  await assert.rejects(auth.signInMicrosoft(firstId), /different account/)
  assert.equal(auth.microsoftStatus().accounts.length, 1)
  await assert.rejects(auth.signInMicrosoft('00000000-0000-4000-8000-000000000000'), /Unknown/)

  // Add a second account explicitly; it becomes active and the first stays available
  const second = await auth.signInMicrosoft()
  assert.equal(second.accounts.length, 2)
  const secondId = second.activeId
  assert.notEqual(secondId, firstId)
  assert.equal(authorization.searchParams.get('prompt'), 'select_account')
  // Same person in a different tenant is a different account
  person = { oid: 'object-two', email: 'two@example.test', tid: OTHER_TENANT }
  assert.equal((await auth.signInMicrosoft()).accounts.length, 3)
  // Adding an existing identity again updates it instead of duplicating it
  person = { oid: 'object-two', email: 'two@example.test', tid: TENANT }
  const again = await auth.signInMicrosoft()
  assert.equal(again.accounts.length, 3)
  assert.equal(again.activeId, secondId)
  // Reconnect passes a login hint and keeps the id
  await auth.signInMicrosoft(secondId)
  assert.equal(authorization.searchParams.get('login_hint'), 'two@example.test')
  assert(!authorization.searchParams.has('prompt'))

  // Explicit switching
  assert.equal(auth.selectMicrosoftAccount(firstId).activeId, firstId)
  assert.throws(
    () => auth.selectMicrosoftAccount('00000000-0000-4000-8000-000000000000'),
    /Unknown/
  )
  assert.match(await auth.microsoftAccessToken(), /^access-/)
  await assert.rejects(auth.microsoftAccessToken(undefined, 'Mail.Read'), /not granted Mail.Read/)

  // Refresh: single flight, rotation, scope kept
  const store = saved()
  store.accounts.find((a) => a.id === firstId).expiresAt = Date.now() - 1000
  fs.writeFileSync(credentialFile, safeStorage.encryptString(JSON.stringify(store)))
  const before = saved().accounts.find((a) => a.id === firstId).refreshToken
  refreshGate = deferred()
  const racing = [auth.microsoftAccessToken(firstId), auth.microsoftAccessToken(firstId)]
  refreshGate.resolve()
  const [a, b] = await Promise.all(racing)
  assert.equal(a, b)
  assert.equal(refreshes, 1, 'concurrent callers share one refresh')
  refreshGate = undefined
  assert.notEqual(saved().accounts.find((x) => x.id === firstId).refreshToken, before)
  assert.equal(await auth.microsoftAccessToken(firstId), a, 'renewed token is cached')

  // A revoked refresh token signs the account out locally and says how to recover
  const stale = saved()
  stale.accounts.find((x) => x.id === firstId).expiresAt = 0
  fs.writeFileSync(credentialFile, safeStorage.encryptString(JSON.stringify(stale)))
  refreshError = Object.assign(new Error('revoked'), { code: 'invalid_grant' })
  await assert.rejects(auth.microsoftAccessToken(firstId), /expired or was revoked.*Reconnect/)
  refreshError = undefined
  assert.equal(auth.microsoftStatus().accounts.find((x) => x.id === firstId).signedIn, false)
  await assert.rejects(auth.microsoftAccessToken(firstId), /Sign in again/)
  assert(!('refreshToken' in saved().accounts.find((x) => x.id === firstId)))
  assert.match(
    await auth.microsoftAccessToken(secondId),
    /^access-/,
    'other accounts are unaffected'
  )

  // Application ID is locked while accounts exist
  assert.throws(
    () => auth.setMicrosoftClientId('22222222-2222-4222-8222-222222222222'),
    /Remove the connected/
  )
  assert.equal(auth.setMicrosoftClientId(CLIENT).clientId, CLIENT, 'saving the same ID is allowed')

  // Removal
  const ids = auth.microsoftStatus().accounts.map((x) => x.id)
  const afterOne = auth.removeMicrosoftAccount(ids[0])
  assert.equal(afterOne.accounts.length, 2)
  assert.equal(auth.removeMicrosoftAccount(ids[1]).accounts.length, 1)
  assert.equal(auth.microsoftStatus().activeId, ids[2], 'a single remaining account becomes active')
  const empty = auth.removeMicrosoftAccount(ids[2])
  assert.deepEqual(empty.accounts, [])
  assert.equal(empty.activeId, undefined)
  assert.throws(() => auth.removeMicrosoftAccount(ids[0]), /Unknown/)
  assert.equal(auth.setMicrosoftClientId('').clientId, '')
  assert.equal(
    auth.setMicrosoftClientId('22222222-2222-4222-8222-222222222222').clientId.length,
    36
  )

  // A damaged credential file is never overwritten
  fs.writeFileSync(credentialFile, Buffer.from('garbage'))
  assert.throws(() => auth.microsoftStatus(), /has not been replaced/)
  assert.throws(() => auth.setMicrosoftClientId(CLIENT), /has not been replaced/)
  assert.equal(fs.readFileSync(credentialFile).toString(), 'garbage')

  fs.rmSync(cache, { recursive: true, force: true })
  console.log('microsoft smoke passed')
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
