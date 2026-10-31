const assert = require('node:assert/strict')
const util = require('node:util')
const path = require('node:path')
const { load } = require('./security/load.cjs')
const root = path.resolve('.cache/checkout-fixture')
const calls = []
let head = 'original',
  dirty = false,
  counts = '0\t2',
  branch = 'main',
  remote = 'https://github.com/octocat/hello.git',
  rewrite = false,
  active = false,
  changedDuringFetch = false,
  linked = false,
  networkFail = false
const execFile = () => {}
execFile[util.promisify.custom] = async (file, args, options) => {
  if (file === 'where.exe') return { stdout: 'C:\\Git\\cmd\\git.exe\n' }
  calls.push({ args, options })
  const command = args.find((arg) =>
    [
      'config',
      'check-ref-format',
      'rev-parse',
      'symbolic-ref',
      'status',
      'fetch',
      'rev-list',
      'merge'
    ].includes(arg)
  )
  let stdout = ''
  if (command === 'config' && args.includes('--list'))
    stdout =
      'filter.demo.smudge\nunsafe\0credential.https://github.com.helper\nunsafe\0' +
      (rewrite ? 'url.https://evil.example/.insteadof\nhttps://github.com/\0' : '')
  else if (command === 'config') stdout = remote
  if (command === 'rev-parse') stdout = args.includes('--show-toplevel') ? root : head
  if (command === 'symbolic-ref') stdout = branch
  if (command === 'status') stdout = dirty ? ' M file.txt' : ''
  if (command === 'fetch') {
    if (networkFail) throw new Error('do-not-leak-secret')
    if (changedDuringFetch) head = 'changed-by-someone-else'
  }
  if (command === 'rev-list') stdout = counts
  if (command === 'merge') head = 'updated'
  return { stdout, stderr: '' }
}
const api = load('src/main/plugins/github-checkout.ts', {
  electron: { app: { getPath: () => root } },
  child_process: { execFile },
  util,
  path,
  'fs/promises': {
    lstat: async () => ({ isDirectory: () => !linked, isSymbolicLink: () => linked }),
    realpath: async (value) => value,
    mkdir: async () => {}
  },
  '../security/private-store': {
    readPrivate: () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    writePrivate: () => {}
  },
  '../security/workspace-policy': { validateWorkspaceRoot: async (value) => value },
  '../security/run-manager': { currentRun: () => active, anyRunActive: () => !!active },
  '../settings': { settingsRecovery: () => ({ required: false }) },
  './store': {
    serverRecord: () => ({
      githubLogin: 'octocat',
      config: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer do-not-leak-secret' }
      }
    })
  }
})
const context = {
  serverId: 'saved-account',
  account: 'octocat',
  repository: 'octocat/hello',
  branch: 'main'
}
const commands = () =>
  calls.flatMap((call) => call.args.filter((arg) => ['fetch', 'merge'].includes(arg)))
async function main() {
  assert.equal(api.githubCheckoutStatus(context), null)
  await api.githubCheckoutAction(context, 'link', root)
  assert.equal(api.githubCheckoutStatus(context).path, root)
  calls.length = 0
  await api.githubCheckoutAction(context, 'fetch')
  assert.deepEqual(commands(), ['fetch'], 'Fetch updates refs without updating the working branch')
  const fetch = calls.find((call) => call.args.includes('fetch'))
  assert(fetch.args.includes('+refs/heads/main:refs/remotes/origin/main'))
  assert(fetch.args.includes('https://github.com/octocat/hello.git'))
  assert(
    !fetch.args.join(' ').includes('do-not-leak-secret'),
    'Credentials never appear in command arguments'
  )
  assert(
    Object.values(fetch.options.env).some(
      (value) =>
        value ===
        'Authorization: Basic ' +
          Buffer.from('x-access-token:do-not-leak-secret').toString('base64')
    )
  )
  calls.length = 0
  await api.githubCheckoutAction(context, 'pull')
  assert.deepEqual(commands(), ['fetch', 'merge'])
  const merge = calls.find((call) => call.args.includes('merge'))
  assert(merge.args.includes('--ff-only'))
  assert(merge.args.includes('filter.demo.smudge='))
  assert(merge.args.includes('credential.https://github.com.helper='))
  assert(merge.args.some((arg) => arg.startsWith('core.hooksPath=')))
  dirty = true
  calls.length = 0
  await assert.rejects(api.githubCheckoutAction(context, 'pull'), /local changes/)
  assert.deepEqual(commands(), [])
  dirty = false
  counts = '1\t1'
  calls.length = 0
  await assert.rejects(api.githubCheckoutAction(context, 'pull'), /diverged/)
  assert.deepEqual(commands(), ['fetch'])
  counts = '0\t1'
  changedDuringFetch = true
  calls.length = 0
  await assert.rejects(api.githubCheckoutAction(context, 'pull'), /changed while fetching/)
  assert.deepEqual(commands(), ['fetch'])
  changedDuringFetch = false
  branch = 'other'
  calls.length = 0
  await assert.rejects(api.githubCheckoutAction(context, 'pull'), /on other/)
  assert.deepEqual(commands(), [])
  branch = 'main'
  remote = 'https://github.com/stranger/hello.git'
  await assert.rejects(api.githubCheckoutAction(context, 'fetch'), /origin/)
  remote = 'https://github.com/octocat/hello.git'
  rewrite = true
  await assert.rejects(api.githubCheckoutAction(context, 'fetch'), /rewrites/)
  rewrite = false
  linked = true
  await assert.rejects(api.githubCheckoutAction(context, 'fetch'), /main checkout/)
  linked = false
  active = true
  await assert.rejects(api.githubCheckoutAction(context, 'fetch'), /current task/)
  active = false
  networkFail = true
  await assert.rejects(
    api.githubCheckoutAction(context, 'fetch'),
    (error) => /could not fetch/.test(error.message) && !error.message.includes('secret')
  )
  await api.githubCheckoutAction(context, 'unlink')
  assert.equal(api.githubCheckoutStatus(context), null)
  console.log(
    'PASS checkout: selected repo/branch, explicit fetch, fast-forward pull, dirty/diverged/racing checkout rejection, disabled hooks/filters, isolated credentials and task guards'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
