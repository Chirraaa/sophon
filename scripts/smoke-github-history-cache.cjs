const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { createGithubHistoryCache } = load('src/main/plugins/github-history.ts')
const context = {
  serverId: 'account',
  account: 'octocat',
  repository: 'octocat/hello',
  branch: 'main'
}
const calls = []
let allowed = true
let fail = false
let release
const history = createGithubHistoryCache(
  async (id, tool, raw) => {
    const args = JSON.parse(raw)
    calls.push({ id, tool, args })
    if (release) await release
    if (fail) throw new Error('offline')
    const data =
      tool === 'list_branches'
        ? [{ name: 'main' }]
        : Array.from({ length: args.page === 1 ? 20 : 1 }, (_, i) => ({
            sha: `${args.sha}:${args.page}:${i}`
          }))
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  },
  () => {
    if (!allowed) throw new Error('account revoked')
  }
)
async function main() {
  const first = await history(context, 'get')
  assert.equal(calls.length, 2)
  assert.equal((await history(context, 'get')).fetchedAt, first.fetchedAt)
  assert.equal(calls.length, 2, 'Reopening a card or another window uses the existing snapshot')
  const older = await history(context, 'older')
  assert.equal(older.commits.length, 21)
  assert.equal(calls.length, 3, 'Pagination fetches commits only, reusing known branches')
  await history(context, 'older')
  assert.equal(calls.length, 3, 'No request after the end of history')
  await history(context, 'fetch')
  assert.equal(calls.length, 5, 'Explicit Fetch refreshes both commits and refs')
  fail = true
  await assert.rejects(history(context, 'fetch'), /offline/)
  assert.equal(
    (await history(context, 'get')).commits.length,
    20,
    'A failed fetch preserves the previous snapshot'
  )
  fail = false
  await history({ ...context, branch: 'feature' }, 'get')
  await history({ ...context, serverId: 'another-account' }, 'get')
  assert(calls.some((call) => call.args.sha === 'feature'))
  allowed = false
  await assert.rejects(
    history(context, 'get'),
    /revoked/,
    'Cached reads still revalidate account access'
  )
  allowed = true
  let unlock
  release = new Promise((resolve) => {
    unlock = resolve
  })
  const count = calls.length
  const a = history(context, 'fetch'),
    b = history(context, 'fetch')
  release = undefined
  unlock()
  assert.deepEqual(await a, await b)
  assert.equal(calls.length - count, 2, 'Concurrent windows share one in-flight fetch')
  console.log(
    'PASS GitHub history cache: reopening, pagination, explicit fetch, failures, account isolation and concurrent windows'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
