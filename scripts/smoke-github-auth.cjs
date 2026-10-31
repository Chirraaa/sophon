const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const originalFetch = global.fetch
const originalNow = Date.now
let now = 100000
Date.now = () => now
let response = {}
let opened = []
let saved = []
let records = []
let active = false
let requests = []
global.fetch = async (url, init) => {
  requests.push({ url, init })
  return { ok: true, text: async () => JSON.stringify(response) }
}
const auth = load('src/main/plugins/github-auth.ts', {
  electron: {
    shell: {
      openExternal: async (url) => {
        opened.push(url)
      }
    }
  },
  crypto: require('node:crypto'),
  '../security/run-manager': { currentRun: () => active, anyRunActive: () => !!active },
  '../settings': { settingsRecovery: () => ({ required: false }) },
  './github-api': { callGithubApi: async () => ({ login: 'octocat' }) },
  './store': {
    setGithubIdentity: (id, login) => {
      assert.equal(id, 'stored-account')
      assert.equal(login, 'octocat')
    },
    serverSummaries: () => records,
    addServer: (name, config) => {
      saved.push({ name, config })
      records.push({ id: 'stored-account' })
    }
  },
  __process: { env: {} }
})
function codes() {
  response = {
    device_code: 'private-device-code',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5
  }
}
async function main() {
  assert.equal(auth.githubSignInConfigured(), true)
  await assert.rejects(auth.startGithubSignIn('!'), /client ID/)
  codes()
  const attempt = await auth.startGithubSignIn('')
  assert.equal(requests[0].init.body.get('client_id'), 'Ov23liUg0YeVU52hF4Mr')
  assert.equal(requests[0].init.body.get('scope'), 'public_repo')
  assert.equal(attempt.userCode, 'ABCD-EFGH')
  assert(!JSON.stringify(attempt).includes('private-device-code'))
  assert.deepEqual(opened, ['https://github.com/login/device'])
  await assert.rejects(auth.startGithubSignIn('public-client-id'), /already in progress/)
  const count = requests.length
  await auth.pollGithubSignIn(attempt.id)
  assert.equal(requests.length, count, 'Poll interval enforced in main process')
  now += 5000
  response = { error: 'authorization_pending' }
  assert.equal((await auth.pollGithubSignIn(attempt.id)).pollAfterMs, 5000)
  assert.equal(requests.at(-1).init.body.get('client_id'), 'Ov23liUg0YeVU52hF4Mr')
  now += 5000
  response = { error: 'slow_down' }
  assert.equal((await auth.pollGithubSignIn(attempt.id)).pollAfterMs, 10000)
  now += 10000
  response = { access_token: 'secret-token', token_type: 'bearer', scope: 'public_repo' }
  assert.deepEqual(await auth.pollGithubSignIn(attempt.id), { serverId: 'stored-account' })
  assert.equal(saved[0].config.headers.Authorization, 'Bearer secret-token')
  await assert.rejects(auth.pollGithubSignIn(attempt.id), /cancelled/)
  for (const scope of ['repo', 'public_repo,read:user', 'public_repo admin:repo_hook', undefined]) {
    codes()
    const broad = await auth.startGithubSignIn('')
    now += 5000
    response = { access_token: 'overprivileged-token', token_type: 'bearer', scope }
    await assert.rejects(auth.pollGithubSignIn(broad.id), /Revoke Sophon/)
    assert.equal(saved.length, 1, 'Overprivileged or unverified tokens must not be saved')
  }
  codes()
  const cancelled = await auth.startGithubSignIn('public-client-id')
  auth.cancelGithubSignIn('wrong-id')
  auth.cancelGithubSignIn(cancelled.id)
  await assert.rejects(auth.pollGithubSignIn(cancelled.id), /cancelled/)
  codes()
  const expired = await auth.startGithubSignIn('public-client-id')
  now += 900001
  await assert.rejects(auth.pollGithubSignIn(expired.id), /expired/)
  codes()
  const denied = await auth.startGithubSignIn('public-client-id')
  now += 5000
  response = { error: 'access_denied' }
  await assert.rejects(auth.pollGithubSignIn(denied.id), /declined/)
  codes()
  response.verification_uri = 'https://evil.example/login'
  await assert.rejects(auth.startGithubSignIn('public-client-id'), /could not start/)
  active = true
  await assert.rejects(auth.startGithubSignIn('public-client-id'), /current task/)
  assert.equal(saved.length, 1)
  assert(
    requests.every(
      ({ url, init }) => url.startsWith('https://github.com/login/') && init.redirect === 'error'
    )
  )
  console.log(
    'PASS GitHub OAuth device flow: fixed browser destination, intervals, slowdown, encrypted-store handoff, expiry, denial, cancellation, no credentials in renderer results.'
  )
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
    Date.now = originalNow
  })
