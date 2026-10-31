const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
let changed = false
let active = false
let recovery = false
let endpoint = 'https://api.githubcopilot.com/mcp/'
let failure = false
let calls = 0
let closed = 0
let releaseCall
const handlers = {}
class GithubApiError extends Error {}
const api = {
  GithubApiError,
  callGithubApi: async () => {
    calls++
    if (releaseCall)
      await new Promise((resolve) => {
        releaseCall.resolve = resolve
      })
    if (failure) throw new Error('transport')
    return { login: 'octocat' }
  }
}
const github = load('src/main/plugins/github.ts', {
  './github-api': api,
  '../security/run-manager': { currentRun: () => active, anyRunActive: () => !!active },
  '../settings': { settingsRecovery: () => ({ required: recovery }) },
  './store': {
    serverRecord: () => ({ config: { type: 'http', url: endpoint } }),
    setGithubIdentity: () => {}
  },
  './tools': {
    bindPluginAction: (_, args) => {
      assert.equal(typeof JSON.parse(args.arguments_json), 'object')
      return {
        preview: args,
        revalidate: () => {
          if (changed) throw new Error('changed')
        }
      }
    }
  },
  './runtime': {
    connected: () => ({
      controller: new AbortController(),
      client: {
        callTool: async () => {
          calls++
          if (releaseCall)
            await new Promise((resolve) => {
              releaseCall.resolve = resolve
            })
          if (failure) throw new Error('transport')
          return { content: [{ type: 'text', text: '{"login":"octocat"}' }] }
        }
      }
    }),
    disconnect: async () => {
      closed++
    },
    safeResult: (_, result) => JSON.stringify(result)
  }
})
github.registerGithubIpc({
  handle: (name, fn) => {
    handlers[name] = fn
  }
})
const call = (tool = 'get_me') => handlers['github:call']({}, 'account', tool, '{}')
async function main() {
  await call()
  assert.equal(calls, 1)
  changed = true
  await assert.rejects(call(), /changed/)
  changed = false
  active = true
  await assert.rejects(call(), /current task/)
  active = false
  recovery = true
  await assert.rejects(call(), /recovered/)
  recovery = false
  endpoint = 'https://example.com/mcp/'
  await assert.rejects(call(), /official GitHub/)
  endpoint = 'https://api.githubcopilot.com/mcp/'
  await assert.rejects(call('delete_repository'), /Unsupported/)
  assert.equal(calls, 1, 'Rejected requests never reach GitHub')
  releaseCall = {}
  const pending = call()
  await assert.rejects(call(), /already in progress/)
  releaseCall.resolve()
  await pending
  releaseCall = undefined
  failure = true
  await assert.rejects(call('push_files'), /a write may have completed/)
  assert.equal(closed, 1)
  failure = false
  await call()
  const data = load('src/renderer/src/components/github/data.ts')
  assert.deepEqual(data.rows(data.unpack({ content: [{ text: '[{"name":"main"}]' }] })), [
    { name: 'main' }
  ])
  assert.deepEqual(data.rows({ items: [] }), [])
  assert.match(
    data.friendlyError(
      new Error("Error invoking remote method 'github:call': Error: Bad credentials (401)")
    ),
    /Sign in again/
  )
  assert.match(data.friendlyError('rate limit exceeded'), /Wait a few minutes/)
  assert.match(data.friendlyError('404 Not Found'), /selected account/)
  assert.match(data.friendlyError('Forbidden: insufficient scopes'), /repository permissions/)
  assert.equal(
    data.friendlyError('Reconnect your account and try again.'),
    'Reconnect your account and try again.'
  )
  assert.throws(() => data.rows({ unknown: [] }), /Unexpected/)
  assert.throws(
    () => data.unpack({ isError: true, content: [{ text: 'Permission denied' }] }),
    /Permission denied/
  )
  const identified = []
  const saved = [
    { id: 'old', configuration: { url: 'https://api.githubcopilot.com/mcp/' } },
    {
      id: 'known',
      githubLogin: 'known-user',
      configuration: { url: 'https://api.githubcopilot.com/mcp/' }
    },
    { id: 'unavailable', configuration: { url: 'https://api.githubcopilot.com/mcp/' } },
    { id: 'other', configuration: { url: 'https://example.com/mcp/' } }
  ]
  const accounts = load('src/main/plugins/github-accounts.ts', {
    './store': {
      serverSummaries: () => saved,
      serverRecord: (id, requireEnabled) => {
        assert.equal(requireEnabled, false)
        return { config: { id } }
      },
      setGithubIdentity: (id, login) => identified.push({ id, login })
    },
    './github-api': {
      callGithubApi: async (config) => {
        if (config.id === 'unavailable') throw new Error('offline')
        return { login: 'saved-user' }
      }
    }
  })
  await accounts.identifyGithubAccounts()
  assert.deepEqual(
    identified,
    [{ id: 'old', login: 'saved-user' }],
    'Legacy disconnected names are backfilled; known names survive offline failures'
  )
  console.log(
    'GitHub smoke passed: direct actions without consent popups, revalidation, operation allowlist, endpoint restriction, task guards, serialization, uncertain writes and response parsing.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
