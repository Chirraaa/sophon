const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const util = require('node:util')
const childProcess = require('node:child_process')
const { load } = require('./security/load.cjs')
const execute = util.promisify(childProcess.execFile)
const base = path.resolve('.cache/checkout-git')
let fixture, seed, bare, checkout
async function git(cwd, args) {
  return (
    await execute(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd, windowsHide: true }
    )
  ).stdout.trim()
}
async function main() {
  await fs.mkdir(base, { recursive: true })
  fixture = await fs.mkdtemp(path.join(base, 'run-'))
  seed = path.join(fixture, 'seed')
  bare = path.join(fixture, 'remote.git')
  checkout = path.join(fixture, 'checkout')
  await fs.mkdir(seed)
  await git(fixture, ['init', '--bare', '--initial-branch=main', bare])
  await git(seed, ['init', '--initial-branch=main'])
  await fs.writeFile(path.join(seed, 'file.txt'), 'first\n')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'First'])
  await git(seed, ['remote', 'add', 'origin', bare])
  await git(seed, ['push', 'origin', 'main'])
  await git(fixture, ['clone', bare, checkout])
  await git(checkout, ['remote', 'set-url', 'origin', 'https://github.com/octocat/hello.git'])
  const first = await git(checkout, ['rev-parse', 'HEAD'])
  await fs.writeFile(path.join(seed, 'file.txt'), 'second\n')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'Second'])
  await git(seed, ['push', 'origin', 'main'])
  const second = await git(seed, ['rev-parse', 'HEAD'])
  const marker = path.join(checkout, 'hook-ran')
  await fs.writeFile(
    path.join(checkout, '.git', 'hooks', 'post-merge'),
    '#!/bin/sh\ntouch hook-ran\n',
    { mode: 0o755 }
  )
  const fakeExec = () => {}
  fakeExec[util.promisify.custom] = async (file, args, options) => {
    if (args.includes('fetch')) {
      args = args.map((arg) => (arg === 'https://github.com/octocat/hello.git' ? bare : arg))
      args = ['-c', 'protocol.file.allow=always', ...args]
    }
    return execute(file, args, options)
  }
  const api = load('src/main/plugins/github-checkout.ts', {
    electron: { app: { getPath: () => path.join(fixture, 'profile') } },
    child_process: { execFile: fakeExec },
    util,
    path,
    'fs/promises': fs,
    '../security/private-store': {
      readPrivate: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      writePrivate: () => {}
    },
    '../security/workspace-policy': { validateWorkspaceRoot: fs.realpath },
    '../security/run-manager': { currentRun: () => null },
    '../settings': { settingsRecovery: () => ({ required: false }) },
    './store': {
      serverRecord: () => ({
        githubLogin: 'octocat',
        config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' }
      })
    }
  })
  const context = {
    serverId: 'fixture',
    account: 'octocat',
    repository: 'octocat/hello',
    branch: 'main'
  }
  await api.githubCheckoutAction(context, 'link', checkout)
  await api.githubCheckoutAction(context, 'fetch')
  assert.equal(
    await git(checkout, ['rev-parse', 'HEAD']),
    first,
    'Fetch leaves the working branch unchanged'
  )
  assert.equal(
    await git(checkout, ['rev-parse', 'refs/remotes/origin/main']),
    second,
    'Fetch updates remote-tracking refs'
  )
  await api.githubCheckoutAction(context, 'pull')
  assert.equal(await git(checkout, ['rev-parse', 'HEAD']), second)
  assert.equal(
    (await fs.readFile(path.join(checkout, 'file.txt'), 'utf8')).replace(/\r\n/g, '\n'),
    'second\n'
  )
  assert.equal(fsSync.existsSync(marker), false, 'Repository hooks never run')
  await fs.writeFile(path.join(checkout, 'file.txt'), 'uncommitted\n')
  await assert.rejects(api.githubCheckoutAction(context, 'pull'), /local changes/)
  await fs.writeFile(path.join(checkout, 'file.txt'), 'local\n')
  await git(checkout, ['add', '.'])
  await git(checkout, ['commit', '-m', 'Local'])
  const local = await git(checkout, ['rev-parse', 'HEAD'])
  await fs.writeFile(path.join(seed, 'file.txt'), 'remote\n')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'Remote'])
  await git(seed, ['push', 'origin', 'main'])
  await assert.rejects(api.githubCheckoutAction(context, 'pull'), /diverged/)
  assert.equal(
    await git(checkout, ['rev-parse', 'HEAD']),
    local,
    'Divergent local history is preserved'
  )
  console.log(
    'PASS real Git checkout: fetch refs, fast-forward files, disabled hooks, dirty checkout and divergence guards; local fixture only'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
