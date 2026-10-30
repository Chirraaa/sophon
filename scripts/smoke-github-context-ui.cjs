const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const live = process.argv.includes('--live')
const liveRepositories = (process.env.SOPHON_TEST_REPOSITORIES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
if (
  live &&
  (!liveRepositories.length || liveRepositories.some((repo) => !/^[\w.-]+\/[\w.-]+$/.test(repo)))
)
  throw new Error(
    'Set SOPHON_TEST_REPOSITORIES to comma-separated owner/name repositories owned by the selected account.'
  )
const output = path.join(root, live ? '.cache/github-context-live' : '.cache/github-context-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
const copiedRegistry = path.join(app.getPath('userData'), 'plugins', 'registry.enc')
if (live) {
  fs.mkdirSync(path.dirname(copiedRegistry), { recursive: true })

  fs.copyFileSync(
    path.join(app.getPath('appData'), 'sophon', 'Local State'),
    path.join(app.getPath('userData'), 'Local State')
  )
  fs.copyFileSync(
    path.join(app.getPath('appData'), 'sophon', 'plugins', 'registry.enc'),
    copiedRegistry
  )
  app.on('will-quit', () => {
    if (fs.existsSync(copiedRegistry)) fs.unlinkSync(copiedRegistry)
  })
}

delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = globalShortcut.unregisterAll = () => {}
const serverId = '11111111-1111-1111-1111-111111111111'
const session = {
  mode: 'assistant',
  chatId: '22222222-2222-2222-2222-222222222222',
  chats: [],
  items: [],
  busy: false,
  runningChatId: null
}
const servers = [
  {
    id: serverId,
    name: 'GitHub',
    githubLogin: 'octocat',
    enabled: true,
    status: 'connected',
    configuration: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    credentialNames: [],
    toolCount: 12
  }
]
const calls = []
let failHistory = false
function fixtureCall(id, tool, input) {
  calls.push({ tool, input })
  if (tool === 'list_commits' && failHistory) {
    failHistory = false
    throw new Error('Could not reach GitHub. Check your internet connection and try again.')
  }
  const fixture = {
    get_me: { login: 'octocat' },
    search_repositories: {
      total_count: 2,
      items: [
        { full_name: 'octocat/hello', default_branch: 'main' },
        { full_name: 'foreign/hidden', default_branch: 'main' }
      ]
    },
    list_branches: [
      { name: 'main', commit: { sha: '0000001' } },
      { name: 'feature/chat-context', commit: { sha: '0000001' } },
      { name: 'feature/side', commit: { sha: '0000003' } }
    ],
    list_commits: Array.from({ length: input.page === 2 ? 1 : 20 }, (_, index) => {
      const n = input.page === 2 ? 21 : index + 1
      const sha = (value) => String(value).padStart(7, '0')
      return {
        sha: sha(n),
        parents: (n === 1 ? [2, 3] : n === 2 || n === 3 ? [4] : n === 21 ? [] : [n + 1]).map(
          (value) => ({ sha: sha(value) })
        ),
        commit: {
          message:
            n === 1
              ? 'Merge branch history\n\nKeep the full commit description.'
              : `Improve repository context ${n}`,
          author: { name: 'Octocat', date: '2026-10-26T10:00:00Z' }
        }
      }
    })
  }
  return { content: [{ type: 'text', text: JSON.stringify(fixture[tool]) }] }
}
const { createGithubHistoryCache } = require('./security/load.cjs').load(
  'src/main/plugins/github-history.ts'
)
const historyCache = createGithubHistoryCache(
  async (id, tool, raw) => fixtureCall(id, tool, JSON.parse(raw)),
  () => {}
)
let linkedCheckout = null
const checkoutActions = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (live) {
      if (channel === 'github:history')
        calls.push({ tool: 'history', input: { ...args[1], action: args[2] } })
      if (channel === 'github:checkout')
        assert.equal(args[2], 'status', 'Live checks never modify a real checkout')
      if (channel === 'github:call') {
        assert(
          ['get_me', 'search_repositories', 'list_branches', 'list_commits'].includes(args[2]),
          'Only read operations are authorized in this test'
        )
        calls.push({ tool: args[2], input: JSON.parse(args[3]) })
      }
      return listener(...args)
    }
    if (channel === 'session:get') return session
    if (channel === 'llm:status') return { online: false }
    if (channel === 'plugins:list' || channel === 'github:accounts') return { plugins: [], servers }
    if (channel === 'session:github-context') {
      assert.equal(args[1], session.chatId)
      session.githubContext = args[2] ?? undefined
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('session:update', session)
      return
    }
    if (channel === 'github:call') return fixtureCall(args[1], args[2], JSON.parse(args[3]))
    if (channel === 'github:history')
      return historyCache(args[1], args[2]).then((snapshot) => {
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send('github:history-changed', { context: args[1], snapshot })
        return snapshot
      })
    if (channel === 'github:checkout') {
      const action = args[2]
      checkoutActions.push(action)
      if (action === 'link')
        linkedCheckout = { path: 'M:/Projects/hello', branch: args[1].branch, head: 'fixture-head' }
      if (action === 'unlink') linkedCheckout = null
      if (action !== 'status')
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send('github:checkout-changed', {
            context: args[1],
            checkout: linkedCheckout
          })
      return linkedCheckout
    }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check) {
  for (let i = 0; i < (live ? 1200 : 200); i++) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Context UI wait timed out')
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2)
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  const watchdog = setTimeout(async () => {
    console.error(
      'Live UI state:',
      await evaluate(`document.querySelector('[data-github-context]')?.textContent`)
    )
    if (live && fs.existsSync(copiedRegistry)) fs.unlinkSync(copiedRegistry)
    app.exit(1)
  }, 90000)
  watchdog.unref()
  const click = async (selector) => {
    await wait(() =>
      evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.disabled })()`
      )
    )
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await delay(100)
  }
  const option = async (name) => {
    await wait(() =>
      evaluate(
        `Array.from(document.querySelectorAll('[data-slot="select-content"]:not([data-closed]) [role="option"]')).some(el => el.textContent.trim() === ${JSON.stringify(name)})`
      )
    )
    const position = await evaluate(`(() => {
      const el = Array.from(document.querySelectorAll('[data-slot="select-content"]:not([data-closed]) [role="option"]')).find(el => el.textContent.trim() === ${JSON.stringify(name)})
      el.scrollIntoView({ block: 'nearest' })
      const rect = el.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`)
    await main.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...position
    })
    await main.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...position
    })
    await main.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...position
    })
    await delay(100)
  }
  main.webContents.setBackgroundThrottling(false)
  await main.webContents.insertCSS(
    '*, *::before, *::after { animation: none !important; transition: none !important; }'
  )
  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  const repositories = live ? liveRepositories : ['octocat/hello']
  const readSession = () => evaluate('window.api.getSession()')
  const inCompact = (code) => compact.webContents.executeJavaScript(code, true)
  await wait(() => inCompact(`!!document.querySelector('[aria-label="Show GitHub context"]')`))
  assert.equal(
    await inCompact(`!!document.querySelector('[data-github-context]')`),
    false,
    'No empty repository card on shortcut startup'
  )
  await delay(500)
  const originalBounds = compact.getBounds()
  const originalPanelLeft =
    originalBounds.x +
    (await inCompact(`document.querySelector('[data-compact-size]').getBoundingClientRect().left`))
  assert.equal(
    originalBounds.width,
    680,
    'Empty shortcut bounds fit the visible popup and its shadow padding'
  )
  await inCompact(`(() => {
    const panel = document.querySelector('[data-compact-size]')
    const composer = document.querySelector('textarea')
    const probe = window.__shortcutToggleProbe = { panel, composer, minWidth: panel.offsetWidth, arrivals: 0, running: true }
    panel.addEventListener('animationstart', () => probe.arrivals++)
    const sample = () => {
      probe.minWidth = Math.min(probe.minWidth, panel.offsetWidth)
      if (probe.running) requestAnimationFrame(sample)
    }
    sample()
  })()`)
  await inCompact(`document.querySelector('[aria-label="Show GitHub context"]').click()`)
  await wait(() => inCompact(`!!document.querySelector('[data-github-context]')`))
  await wait(() => compact.getBounds().width === 1016)
  await delay(100)
  assert(
    Math.abs(
      compact.getBounds().x +
        (await inCompact(
          `document.querySelector('[data-compact-size]').getBoundingClientRect().left`
        )) -
        originalPanelLeft
    ) <= 1,
    'Showing a side card preserves the command position'
  )
  assert.equal(
    await inCompact(
      `innerWidth - document.querySelector('[data-compact-size]').getBoundingClientRect().right`
    ),
    20,
    'No empty right wing is included in the drag bounds'
  )
  await inCompact(`document.querySelector('[aria-label="Hide GitHub context"]').click()`)
  await wait(() => inCompact(`!document.querySelector('[data-github-context]')`))
  await wait(() => compact.getBounds().width === 680)
  await delay(200)
  const continuity = await inCompact(`(() => {
    const probe = window.__shortcutToggleProbe
    probe.running = false
    return { samePanel: probe.panel === document.querySelector('[data-compact-size]'),
      sameComposer: probe.composer === document.querySelector('textarea'), minWidth: probe.minWidth, arrivals: probe.arrivals }
  })()`)
  assert(
    continuity.samePanel && continuity.sameComposer,
    'Toggling context preserves the popup and composer'
  )
  assert.equal(continuity.arrivals, 0, 'Toggling context never replays the arrival animation')
  if (originalBounds.width === 680) {
    assert.deepEqual(
      compact.getBounds(),
      originalBounds,
      'Hiding context restores the exact popup bounds'
    )
    assert.equal(continuity.minWidth, 640, 'Main popup never collapses while context is toggled')
  }

  await inCompact(`document.querySelector('[aria-label="Show GitHub context"]').click()`)
  assert.equal(
    await evaluate(`!!document.querySelector('[data-github-context]')`),
    false,
    'Full app starts with the repository card behind a button'
  )
  await click('[aria-label="Show GitHub context"]')
  for (const repository of repositories) {
    if (live) console.log('Checking ' + repository)
    await click('[data-github-context] button[aria-expanded]')
    if (live && repository === repositories[0]) {
      await click('[aria-label="Working GitHub account"]')
      await wait(() =>
        evaluate(
          `Array.from(document.querySelectorAll('[data-slot="select-content"]:not([data-closed]) [role="option"]')).some(el => el.textContent.trim() === '@Chirraaa')`
        )
      )
      await option('@Chirraaa')
      console.log('Chirraaa account selected')
    }
    await wait(() =>
      evaluate(
        `!!document.querySelector('[aria-label="Working repository"]') && !document.querySelector('[aria-label="Working repository"]').disabled`
      )
    )
    await click('[aria-label="Working repository"]')
    assert.equal(await evaluate(`document.body.textContent.includes('foreign/hidden')`), false)
    await option(repository)
    await wait(() => evaluate(`!document.querySelector('[aria-label="Working branch"]').disabled`))
    await click('[aria-label="Working branch"]')
    const branch = live
      ? await evaluate(
          `document.querySelector('[aria-label="Working branch"] [data-slot="select-value"]').textContent.trim()`
        )
      : 'feature/chat-context'
    await option(branch)
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === 'Use in this chat').click()`
    )
    await wait(async () => (await readSession()).githubContext?.repository === repository)
    const selected = (await readSession()).githubContext
    assert.equal(selected.branch, branch)
    assert.equal(selected.account.toLowerCase(), live ? 'chirraaa' : 'octocat')
    await wait(() =>
      compact.webContents.executeJavaScript(
        `document.querySelector('[data-github-context]').textContent.includes(${JSON.stringify(repository)})`
      )
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[data-github-context] [role="tab"]')).find(el => el.textContent === 'History').click()`
    )
    await wait(() =>
      evaluate(`document.querySelectorAll('[data-github-history] [data-commit-sha]').length > 0`)
    )
    await wait(() =>
      evaluate(`!document.querySelector('[aria-label="Fetch branch history"]').disabled`)
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[data-github-context] [role="tab"][aria-selected="true"]').textContent`
      ),
      'History'
    )
    assert(
      calls.some((call) =>
        live
          ? call.tool === 'history' &&
            call.input.branch === branch &&
            call.input.repository === repository
          : call.tool === 'list_commits' &&
            call.input.sha === branch &&
            call.input.repo === repository.split('/')[1]
      ),
      'History is scoped to the selected branch and repository'
    )
    if (!live) {
      assert.equal(await evaluate(`document.querySelectorAll('[data-commit-sha]').length`), 20)
      await evaluate(`document.querySelector('[data-commit-sha] button').click()`)
      assert(
        await evaluate(
          `document.querySelector('[aria-label="Commit details"]').textContent.includes('Keep the full commit description.')`
        )
      )
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'Load older commits').click()`
      )
      await wait(() => evaluate(`document.querySelectorAll('[data-commit-sha]').length === 21`))
      session.busy = true
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('session:update', session)
      await wait(() =>
        evaluate(
          `document.querySelector('[data-github-history]').textContent.includes('available when the task finishes')`
        )
      )
      const pausedCalls = calls.length
      await delay(100)
      assert.equal(
        calls.length,
        pausedCalls,
        'History does not issue GitHub calls during a running task'
      )
      assert.equal(
        await evaluate(`document.querySelectorAll('[data-commit-sha]').length`),
        21,
        'Loaded history stays visible while a task runs'
      )
      session.busy = false
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('session:update', session)
      await delay(150)
      assert.equal(
        await evaluate(`document.querySelectorAll('[data-commit-sha]').length`),
        21,
        'Task completion retains cached history'
      )
      assert.equal(calls.length, pausedCalls, 'Task completion does not refetch history')
      await click('[aria-label="Hide GitHub context"]')
      await click('[aria-label="Show GitHub context"]')
      await evaluate(
        `Array.from(document.querySelectorAll('[data-github-context] [role="tab"]')).find(el => el.textContent === 'History').click()`
      )
      await wait(() => evaluate(`document.querySelectorAll('[data-commit-sha]').length === 21`))
      assert.equal(
        calls.length,
        pausedCalls,
        'Closing and reopening the card reuses cached history'
      )
      failHistory = true
      await click('[aria-label="Fetch branch history"]')
      await wait(() =>
        evaluate(
          `document.querySelector('[data-github-history] [role="alert"]')?.textContent.includes('Could not reach GitHub')`
        )
      )
      await evaluate(
        `Array.from(document.querySelectorAll('[data-github-history] button')).find(el => el.textContent === 'Retry history').click()`
      )
      await wait(() =>
        evaluate(
          `!document.querySelector('[data-github-history] [role="alert"]') && document.querySelectorAll('[data-commit-sha]').length === 20`
        )
      )
    }
    if (live)
      console.log(
        JSON.stringify({
          repository,
          branch,
          account: selected.account,
          saved: true,
          shortcutSynced: true
        })
      )
  }
  if (!live) {
    assert(
      await evaluate(`document.querySelector('[aria-label="Pull linked checkout"]').disabled`),
      'Pull needs a linked checkout'
    )
    await click('[aria-label="Link local checkout"]')
    await wait(() =>
      evaluate(`!document.querySelector('[aria-label="Pull linked checkout"]').disabled`)
    )
    await click('[aria-label="Pull linked checkout"]')
    await wait(() =>
      evaluate(
        `document.querySelector('[data-github-history]').textContent.includes('Pull complete')`
      )
    )
    assert(checkoutActions.includes('pull'), 'Pull invokes the linked-checkout action')
    await click('[aria-label="Unlink local checkout"]')
  }
  const beforeCompactHistory = calls.length
  await inCompact(
    `Array.from(document.querySelectorAll('[data-github-context] [role="tab"]')).find(el => el.textContent === 'History').click()`
  )
  await wait(() => inCompact(`document.querySelectorAll('[data-commit-sha]').length > 0`))
  if (!live)
    assert.equal(calls.length, beforeCompactHistory, 'Shortcut history shares the full app cache')
  if (!live) {
    await inCompact(
      `Array.from(document.querySelectorAll('[data-github-history] button')).find(el => el.textContent === 'Load older commits').click()`
    )
    await wait(() => evaluate(`document.querySelectorAll('[data-commit-sha]').length === 21`))
    assert.equal(
      calls.length,
      beforeCompactHistory + 1,
      'A history update reaches both windows with one request'
    )
  }
  const layout = await compact.webContents.executeJavaScript(`(() => {
    const context = document.querySelector('[data-compact-context]').getBoundingClientRect()
    const popup = document.querySelector('[data-compact-size]').getBoundingClientRect()
    return { gap: popup.left - context.right, center: (popup.left + popup.right) / 2, width: innerWidth, scroll: document.documentElement.scrollWidth }
  })()`)
  if (layout.width >= 1000) assert.equal(layout.gap, 16)
  assert(layout.scroll <= layout.width)
  assert(
    Math.abs(layout.center - (layout.width + (layout.gap === 16 ? 336 : 0)) / 2) <= 1,
    'Main popup stays centered beside GitHub context'
  )
  await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  await compact.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  await delay(200)
  fs.writeFileSync(
    path.join(output, 'chat.png'),
    (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
  )
  fs.writeFileSync(
    path.join(output, 'shortcut.png'),
    (
      await compact.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    ).toPNG()
  )
  const beforeUnlink = calls.length
  await click('[aria-label="Unlink repository from chat"]')
  await wait(async () => !(await readSession()).githubContext)
  await wait(() =>
    inCompact(
      `!document.querySelector('[aria-label="Unlink repository from chat"]') && !document.querySelector('[data-github-history]')`
    )
  )
  assert(
    await evaluate(
      `document.querySelector('[data-github-context]').textContent.includes('Repository unlinked from this chat.')`
    )
  )
  assert.equal(
    calls.length,
    beforeUnlink,
    'Unlinking a repository only changes chat context, with no GitHub requests'
  )
  assert(
    calls
      .filter((call) => call.tool === 'search_repositories')
      .every((call) => call.input.query === '')
  )
  assert(BrowserWindow.getAllWindows().every((win) => !win.isVisible()))
  console.log(
    'PASS GitHub chat context: owned repos, branch selection, cross-window sync, removal and shortcut spacing'
  )
}
main()
  .then(() => app.quit())
  .catch(async (error) => {
    console.error(error)
    const window = BrowserWindow.getAllWindows().find((win) => win.isResizable())
    if (window)
      console.error(
        'Context UI:',
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-github-context]')?.textContent`
        )
      )
    if (live && fs.existsSync(copiedRegistry)) fs.unlinkSync(copiedRegistry)
    app.exit(1)
  })
