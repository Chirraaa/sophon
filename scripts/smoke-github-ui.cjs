const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/github-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = globalShortcut.unregisterAll = () => {}
const calls = []
let oauthConfigured = false
const state = {
  plugins: [],
  servers: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'GitHub · public repositories',
      enabled: true,
      type: 'http',
      configuration: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
      status: 'connected',
      toolCount: 12,
      credentialNames: []
    }
  ]
}

state.servers.unshift({
  ...state.servers[0],
  id: '33333333-3333-3333-3333-333333333333',
  enabled: false,
  status: 'disconnected'
})
state.servers[0].githubLogin = 'saved-user'
const connectedAccount = state.servers[1]
let connectionFails = false
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (channel === 'llm:status') return { online: false }
    if (channel === 'plugins:list' || channel === 'github:accounts') return state
    if (channel === 'github:sign-in-configured') return oauthConfigured
    if (channel === 'plugins:remove-server') {
      calls.push({ tool: 'remove-server', id: args[1] })
      state.servers = state.servers.filter((server) => server.id !== args[1])
      return state
    }
    if (channel === 'plugins:disconnect') {
      connectedAccount.status = 'disconnected'
      return state
    }
    if (channel === 'plugins:enable-server') {
      calls.push({ tool: 'enable-server' })
      connectedAccount.enabled = args[2]
      return state
    }
    if (channel === 'plugins:connect') {
      calls.push({ tool: 'connect' })
      if (connectionFails) {
        connectedAccount.status = 'error'
        connectedAccount.error = 'Fixture connection failed'
      } else {
        connectedAccount.status = 'connected'
        delete connectedAccount.error
      }
      return state
    }
    if (channel === 'github:poll-sign-in') return { serverId: connectedAccount.id }
    if (channel === 'github:sign-in') {
      calls.push({ tool: 'sign-in', clientId: args[1] })
      return {
        id: '22222222-2222-2222-2222-222222222222',
        userCode: 'ABCD-EFGH',
        expiresAt: Date.now() + 900000,
        pollAfterMs: 500
      }
    }
    if (channel === 'github:cancel-sign-in') {
      calls.push({ tool: 'cancel-sign-in' })
      return
    }
    if (channel === 'github:call') {
      const tool = args[2]
      const input = JSON.parse(args[3])
      calls.push({ tool, input })
      if (tool === 'get_me') connectedAccount.githubLogin = 'octocat'
      const fixtures = {
        get_me: { login: 'octocat' },
        search_repositories: { items: [{ full_name: 'octocat/hello', default_branch: 'main' }] },
        list_branches: [
          { name: 'main', protected: true, commit: { sha: 'abcdef123' } },
          { name: 'feature/test', protected: false, commit: { sha: 'def456' } }
        ],
        list_commits: [
          { sha: 'abcdef123', commit: { message: 'Initial commit', author: { name: 'Octocat' } } }
        ],
        list_pull_requests: [
          { number: 7, title: 'Improve onboarding', user: { login: 'octocat' } }
        ],
        pull_request_read: [{ id: 1, user: { login: 'reviewer' }, body: 'Looks good' }]
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(fixtures[tool] ?? { success: true }) }]
      }
    }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('UI wait timed out')
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().some((w) => w.isResizable()))
  const window = BrowserWindow.getAllWindows().find((w) => w.isResizable())
  window.webContents.setBackgroundThrottling(false)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  await window.webContents.insertCSS(
    '*, *::before, *::after { animation: none !important; transition: none !important; }'
  )
  const evaluate = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(`${error.message}\nScript: ${code}`)
    })
  const click = async (selector) => {
    await wait(() =>
      evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el && !el.matches(':disabled')); })()`
      )
    )
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await delay(100)
  }
  const button = async (text) => {
    await wait(() =>
      evaluate(
        `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.matches(':disabled'))`
      )
    )
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`
    )
    await delay(100)
  }
  const field = async (label, value, textarea = false) => {
    await evaluate(
      `(() => { const el = document.querySelector('[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
    await delay(50)
  }
  await wait(() => evaluate(`!!document.querySelector('nav[aria-label="Main navigation"]')`))
  if (await evaluate(`document.body.textContent.includes('Skip setup')`)) await button('Skip setup')
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="New conversation"]')`), false)
  await click('[aria-label="Collapse sidebar"]')
  const centers = await evaluate(
    `['New chat', 'Assistant'].map(label => { const r = document.querySelector('[aria-label="' + label + '"]').getBoundingClientRect(); return r.x + r.width / 2 })`
  )
  assert(Math.abs(centers[0] - centers[1]) < 1, 'Collapsed new chat is centered with navigation')
  await click('[aria-label="GitHub"]')
  await wait(() => evaluate(`document.body.textContent.includes('octocat/hello')`))
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="GitHub account connection"] [data-slot="select-value"]').textContent.trim()`
    ),
    '@octocat'
  )
  await click('[aria-label="GitHub account connection"]')
  await wait(() => evaluate(`document.querySelectorAll('[role="option"]').length === 2`))
  const options = await evaluate(
    `Array.from(document.querySelectorAll('[role="option"]')).map(el => ({text: el.textContent, height: el.getBoundingClientRect().height}))`
  )
  assert(options[0].text.includes('@saved-user') && options[1].text.includes('@octocat'))
  assert(
    options.every((option) => option.height < 40),
    'Account names stay on a single line'
  )
  await evaluate(`document.querySelector('[role="option"][aria-selected="true"]').click()`)
  assert(
    calls.some((c) => c.tool === 'get_me'),
    'Account is identified automatically'
  )
  assert(
    calls.some((c) => c.tool === 'search_repositories' && c.input.query === ''),
    'Repositories load automatically'
  )
  await button('Search')
  assert(
    await evaluate(
      `document.querySelector('[aria-label="Search repositories"]').getAttribute('aria-invalid') === 'true'`
    )
  )
  assert(
    await evaluate(`Array.from(document.querySelectorAll('form')).every(form => form.noValidate)`)
  )
  assert(
    await evaluate(`document.body.textContent.includes('Enter search repositories to continue.')`)
  )
  await button('Add GitHub account')
  assert(await evaluate(`document.body.textContent.includes('switch to that account on GitHub')`))
  await button('Close sign-in')
  await button('Refresh account')
  await wait(() => evaluate(`document.body.textContent.includes('octocat')`))
  await field('Search repositories', 'hello')
  await button('Search')
  await field('Repository owner/name', 'another-account/hello')
  await button('Open repository')
  assert(
    await evaluate(`document.body.textContent.includes('Choose a repository owned by @octocat')`)
  )
  assert(
    !calls.some((call) => call.input?.owner === 'another-account'),
    'Manual entry cannot access another owner'
  )
  await button('octocat/hello')
  await wait(() => evaluate(`document.body.textContent.includes('Protected')`))
  assert(
    calls.some((call) => call.tool === 'list_branches' && call.input.repo === 'hello'),
    'Selecting a repository loads branches automatically'
  )
  await evaluate(`document.querySelector('[data-slot="tabs-list"]').style.width = '280px'`)
  const tabLayout = await evaluate(`(() => {
    const list = document.querySelector('[data-slot="tabs-list"]');
    const bounds = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    return {overflowX:style.overflowX,overflowY:style.overflowY,tabs:[...list.querySelectorAll('[role="tab"]')].map(tab => { const r = tab.getBoundingClientRect(); return { fits:r.right <= bounds.right + 1 && r.bottom <= bounds.bottom + 1, top:r.top }; })};
  })()`)
  assert.equal(tabLayout.overflowX, 'visible')
  assert.equal(tabLayout.overflowY, 'visible')
  assert(
    tabLayout.tabs.every((tab) => tab.fits),
    'Tabs fit without a scrollbar in a narrow container'
  )
  assert(
    new Set(tabLayout.tabs.map((tab) => tab.top)).size > 1,
    'Narrow tabs wrap onto another row'
  )
  await evaluate(`document.querySelector('[data-slot="tabs-list"]').style.width = ''`)
  await button('Select')
  await wait(() => evaluate(`document.body.textContent.includes('Initial commit')`))
  assert(
    calls.some((call) => call.tool === 'list_commits' && call.input.sha === 'main'),
    'Selecting a branch loads its commits automatically'
  )
  for (const branch of ['feature/test', 'main']) {
    await click('[aria-label="Active branch"]')
    await wait(() =>
      evaluate(
        `Array.from(document.querySelectorAll('[role="option"]')).some(option => option.textContent.trim() === ${JSON.stringify(branch)})`
      )
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent.trim() === ${JSON.stringify(branch)}).click()`
    )
    await wait(
      () => calls.filter((call) => call.tool === 'list_commits').at(-1)?.input.sha === branch
    )
  }
  await button('Pull requests')
  await wait(() => calls.some((call) => call.tool === 'list_pull_requests'))
  await button('Comments')
  await wait(() => evaluate(`document.body.textContent.includes('Looks good')`))
  await field('Comment', 'Thanks!', true)
  await button('Post comment')
  assert(
    calls.some(
      (c) =>
        c.tool === 'add_issue_comment' && c.input.issue_number === 7 && c.input.body === 'Thanks!'
    )
  )
  await button('Commit & push')
  await field('File 1 path', 'README.md')
  await field('File 1 contents', '# Hello', true)
  await field('Commit message', 'Update readme')
  await button('Commit & push to main')
  assert(
    calls.some(
      (c) =>
        c.tool === 'push_files' &&
        c.input.branch === 'main' &&
        c.input.files[0].content === '# Hello'
    )
  )
  await button('Branches')
  await wait(() => evaluate(`document.body.textContent.includes('Protected')`))
  await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  await delay(200)
  fs.writeFileSync(
    path.join(output, 'workspace.png'),
    (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
  )
  await button('Disconnect')
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="GitHub account connection"] [data-slot="select-value"]').textContent.trim()`
    ),
    '@octocat',
    'Saved username remains visible after disconnect'
  )
  await wait(() =>
    evaluate(
      `!!document.querySelector('[aria-label="GitHub OAuth client ID"]')?.getBoundingClientRect().height`
    )
  )
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Sign in with GitHub').disabled`
    ),
    true
  )
  await field('GitHub OAuth client ID', 'public-client-id')
  await button('Sign in with GitHub')
  assert.equal(
    await evaluate(`localStorage.getItem('sophon.githubOAuthClientId')`),
    'public-client-id'
  )
  await wait(() => evaluate(`document.body.textContent.includes('ABCD-EFGH')`))
  await button('Cancel sign-in')

  connectedAccount.enabled = false
  await button('Sign in with GitHub')
  await wait(() => evaluate(`document.body.textContent.includes('Refresh account')`))
  assert(calls.some((c) => c.tool === 'enable-server'))
  assert(calls.some((c) => c.tool === 'connect'))
  await button('Disconnect')
  connectionFails = true
  await button('Sign in with GitHub')
  await wait(() => evaluate(`document.body.textContent.includes('Fixture connection failed')`))
  assert(await evaluate(`document.body.textContent.includes('Connection failed')`))
  assert(await evaluate(`document.body.textContent.includes('Connect saved account')`))
  connectionFails = false
  await button('Connect saved account')
  await wait(() => evaluate(`document.body.textContent.includes('Refresh account')`))
  await wait(() => calls.some((c) => c.tool === 'cancel-sign-in'))
  assert.equal(await evaluate(`document.body.textContent.includes('ABCD-EFGH')`), false)
  await button('Disconnect')
  oauthConfigured = true
  await click('[aria-label="Assistant"]')
  await click('[aria-label="GitHub"]')
  await button('Sign in with GitHub')
  assert.equal(
    calls.filter((c) => c.tool === 'sign-in').at(-1).clientId,
    '',
    'Bundled registration takes precedence over a remembered custom ID'
  )
  assert.equal(
    await evaluate(`!!document.querySelector('[aria-label="GitHub OAuth client ID"]')`),
    false
  )
  await button('Cancel sign-in')
  await button('Remove account')
  await button('Keep account')
  assert.equal(state.servers.length, 2, 'Cancelling removal keeps credentials')
  await button('Remove account')
  await evaluate(
    `document.querySelector('[role="alertdialog"] button[data-slot="alert-dialog-action"]').click()`
  )
  await wait(() => state.servers.length === 1)
  assert(calls.some((call) => call.tool === 'remove-server' && call.id === connectedAccount.id))
  assert(BrowserWindow.getAllWindows().every((w) => !w.isVisible()))
  console.log(
    'PASS hidden production UI: sidebar alignment, redundant button removal, account, repository search, branches, commits, PR comments and commit/push payloads (mock GitHub).'
  )
}
main()
  .then(() => app.quit())
  .catch((e) => {
    console.error(e)
    app.exit(1)
  })
