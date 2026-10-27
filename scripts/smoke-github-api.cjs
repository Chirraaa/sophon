const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { callGithubApi, GithubApiError } = load('src/main/plugins/github-api.ts')
const originalFetch = global.fetch
const config = {
  type: 'http',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: { Authorization: 'Bearer fixture-secret', 'X-Unrelated': 'do-not-forward' }
}
const signal = new AbortController().signal
let calls = []
let status = 200
let remaining = '100'
let login = 'octocat'
global.fetch = async (url, init) => {
  const target = new URL(url)
  assert.equal(target.origin, 'https://api.github.com')
  assert.equal(init.redirect, 'error')
  assert.equal(init.credentials, 'omit')
  assert.equal(init.headers.Authorization, config.headers.Authorization)
  assert.equal(init.headers['X-Unrelated'], undefined)
  calls.push({
    path: target.pathname,
    query: target.searchParams,
    method: init.method,
    body: init.body && JSON.parse(init.body)
  })
  let result = {}
  if (target.pathname === '/user') result = { login, id: 1 }
  if (target.pathname === '/user/repos')
    result = [
      {
        full_name: 'octocat/hello',
        default_branch: 'main',
        private: false,
        unused: 'x'.repeat(100000)
      },
      { full_name: 'stranger/hello', default_branch: 'main', private: false },
      { full_name: 'second/hello', default_branch: 'main', private: false }
    ]
  if (target.pathname.endsWith('/git/ref/heads/feature%2Ftest'))
    result = { object: { sha: 'head' } }
  if (target.pathname.endsWith('/git/commits/head')) result = { tree: { sha: 'base-tree' } }
  if (target.pathname.endsWith('/git/trees')) result = { sha: 'new-tree' }
  if (target.pathname.endsWith('/git/commits') && init.method === 'POST')
    result = { sha: 'new-commit' }
  if (target.pathname === '/repos/octocat/hello/commits')
    result = [
      {
        sha: 'merge',
        parents: [{ sha: 'left' }, { sha: 'right' }],
        commit: {
          message: 'Merge feature',
          author: { name: 'Octocat', date: '2026-10-26T10:00:00Z' }
        }
      }
    ]
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'x-ratelimit-remaining': remaining }
  })
}
async function main() {
  assert.equal((await callGithubApi(config, 'get_me', {}, signal)).login, 'octocat')
  const repos = await callGithubApi(
    config,
    'search_repositories',
    { query: 'hello', perPage: 20 },
    signal
  )
  assert.equal(repos.items[0].full_name, 'octocat/hello')
  assert(JSON.stringify(repos).length < 500, 'Repository lists omit huge unused API fields')
  assert.equal(repos.total_count, 1, 'Other owners are excluded even if the API returns them')
  assert.equal(calls.at(-1).path, '/user/repos')
  assert.equal(calls.at(-1).query.get('type'), 'owner')
  assert.equal(calls.at(-1).query.get('per_page'), '100')
  assert.equal(
    (
      await callGithubApi(
        config,
        'search_repositories',
        { query: 'user:stranger OR hello' },
        signal
      )
    ).total_count,
    0,
    'Search syntax cannot broaden ownership'
  )
  assert.equal(
    (await callGithubApi(config, 'search_repositories', { query: '' }, signal)).total_count,
    1
  )
  login = 'second'
  assert.equal(
    (await callGithubApi(config, 'search_repositories', { query: 'hello' }, signal)).items[0]
      .full_name,
    'second/hello',
    'Switching accounts changes the enforced owner'
  )
  login = 'octocat'
  calls = []
  await assert.rejects(
    callGithubApi(config, 'push_files', { owner: 'stranger', repo: 'hello' }, signal),
    /owned by @octocat/
  )
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/user'],
    'An outside repository cannot be opened or changed'
  )
  assert(!calls.some((call) => call.path === '/search/repositories'))
  const history = await callGithubApi(
    config,
    'list_commits',
    { owner: 'octocat', repo: 'hello', sha: 'feature/test', perPage: 20, page: 2 },
    signal
  )
  assert.deepEqual(
    history[0].parents,
    [{ sha: 'left' }, { sha: 'right' }],
    'History retains actual parent metadata'
  )
  assert.equal(history[0].commit.author.date, '2026-10-26T10:00:00Z')
  assert.equal(calls.at(-1).query.get('sha'), 'feature/test')
  assert.equal(calls.at(-1).query.get('page'), '2')
  calls = []
  await callGithubApi(
    config,
    'push_files',
    {
      owner: 'octocat',
      repo: 'hello',
      branch: 'feature/test',
      message: 'Update',
      files: [{ path: 'README.md', content: 'Hello' }]
    },
    signal
  )
  assert.deepEqual(
    calls.map((call) => call.method),
    ['GET', 'GET', 'GET', 'POST', 'POST', 'PATCH']
  )
  assert.deepEqual(calls[3].body, {
    base_tree: 'base-tree',
    tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: 'Hello' }]
  })
  assert.deepEqual(calls[4].body.parents, ['head'])
  assert.deepEqual(calls[5].body, { sha: 'new-commit', force: false })
  for (const [code, pattern] of [
    [401, /Sign in again/],
    [403, /permission/],
    [404, /could not find/],
    [422, /Refresh/]
  ]) {
    status = code
    await assert.rejects(
      callGithubApi(config, 'get_me', {}, signal),
      (error) => error instanceof GithubApiError && pattern.test(error.message)
    )
  }
  status = 403
  remaining = '0'
  await assert.rejects(callGithubApi(config, 'get_me', {}, signal), /rate limit/)
  console.log(
    'PASS GitHub REST: fixed destination, isolated credentials, bounded list output, query parameters, atomic branch update without force, actionable HTTP errors.'
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
  })
