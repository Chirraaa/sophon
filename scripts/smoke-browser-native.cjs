// Real browser/DOM test. Only a disposable profile and localhost fixture are used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { chromium } = require('playwright-core')
const { load, root } = require('./security/load.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/browser-native-'))
const dom = load('src/main/tools/browser/dom.ts')
let context,
  permission = 'allow',
  blocked = '',
  protectedTitle = ''
const runtime = load('src/main/tools/browser/runtime.ts', {
  electron: { app: { getPath: () => directory } },
  path,
  crypto,
  'playwright-core': {
    chromium: {
      launchPersistentContext: async (profile, options) => {
        context = await chromium.launchPersistentContext(profile, { ...options, headless: true })
        return context
      }
    }
  },
  '../../security/run-manager': {
    assertRun: (run) => run.signal.throwIfAborted(),
    onRunFinished: () => () => {}
  },
  '../../permissions': {
    toolPermission: () => permission,
    blockedAppRule: (...values) => blocked && values.some((v) => v.includes(blocked)),
    protectedWindowRule: (title) => protectedTitle && title.includes(protectedTitle)
  },
  '../../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto }),
  './dom': dom
})
const decode = (result) => JSON.parse(JSON.parse(result.text).content)
let controller = new AbortController()
let run = { id: 'first', signal: controller.signal }
const call = (name, args) => runtime.executeBrowserTool(name, args, run)
const html = `<!doctype html><title>Sophon DOM fixture</title>
<label>Draft<input id="draft" value="original"></label>
<label>Password<input type="password" value="secret-canary"></label>
<input type="file" aria-label="Upload">
<div hidden><button>Hidden button</button></div>
<button id="play" onclick="this.textContent='Pause'; document.querySelector('#status').textContent='Playback started'">Play</button>
<input id="enabled" type="checkbox" aria-label="Enabled">
<select aria-label="Channel"><option value="general">General</option><option value="dev">Development</option></select>
<div contenteditable="true" role="textbox" aria-label="Message">Draft message</div>
<p id="status">Ready</p><iframe srcdoc="<button>Frame button</button>"></iframe>`
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' }).end(html)
})
async function main() {
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://user:secret@example.com'])
    assert.throws(() => runtime.browserUrl(url))
  assert.deepEqual(decode(await call('browser_tabs', {})).tabs, [])
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  const opened = decode(await call('browser_open', { url }))
  const tab = opened.tab
  const page = context.pages().find((p) => p.url() === url)
  assert(page)
  let state = decode(await call('browser_inspect', { tab }))
  assert.equal(state.omittedFrames, 1)
  assert(!JSON.stringify(state).includes('secret-canary'))
  assert(!state.controls.some((c) => ['Hidden button', 'Upload'].includes(c.name)))
  async function action(name, operation, text, query) {
    state = decode(await call('browser_inspect', { tab, query: name }))
    const element = state.controls.find((c) => c.name === name)
    assert(element, name)
    const args = {
      observation: state.observation,
      element: element.element,
      action: operation,
      ...(text !== undefined ? { text } : {}),
      ...(query ? { query } : {})
    }
    const binding = await runtime.bindBrowserAction('browser_act', args, run)
    await binding.revalidate()
    const result = await call('browser_act', args)
    await assert.rejects(() => call('browser_act', args), /expired|used/)
    return result
  }
  const fill = await action('Draft', 'fill', 'Hello Ω')
  assert.equal(fill.status, 'reported')
  assert.match(fill.text, /Fresh DOM evidence/)
  assert.equal(await page.locator('#draft').inputValue(), 'Hello Ω')
  const played = await action('Play', 'click', undefined, 'Pause')
  assert.match(played.text, /Pause/)
  assert.equal(await page.locator('#status').textContent(), 'Playback started')
  await action('Enabled', 'check')
  assert.equal(await page.locator('#enabled').isChecked(), true)
  await action('Channel', 'select', 'dev')
  assert.equal(await page.locator('select').inputValue(), 'dev')
  await action('Message', 'fill', 'Literal text')
  assert.equal(await page.locator('[contenteditable]').textContent(), 'Literal text')

  state = decode(await call('browser_inspect', { tab, query: 'Draft' }))
  const stale = {
    observation: state.observation,
    element: state.controls[0].element,
    action: 'fill',
    text: 'must not replace'
  }
  const bound = await runtime.bindBrowserAction('browser_act', stale, run)
  await page.locator('#draft').fill('User edit')
  await assert.rejects(bound.revalidate, /changed/)
  await assert.rejects(() => call('browser_act', stale), /changed/)
  assert.equal(await page.locator('#draft').inputValue(), 'User edit')

  permission = 'ask'
  const noRead = await action('Draft', 'fill', 'No implicit read')
  assert.match(noRead.text, /own permission/)
  assert(!noRead.text.includes('browser-dom'))
  permission = 'allow'
  state = decode(await call('browser_inspect', { tab }))
  await page.reload()
  await assert.rejects(
    () =>
      call('browser_act', {
        observation: state.observation,
        element: state.controls[0].element,
        action: 'fill',
        text: ''
      }),
    /expired|used|changed/
  )
  blocked = '127.0.0.1'
  await assert.rejects(() => call('browser_inspect', { tab }), /blocked/)
  assert.deepEqual(decode(await call('browser_tabs', {})).tabs, [])
  blocked = ''
  protectedTitle = 'Sophon DOM fixture'
  await assert.rejects(() => call('browser_inspect', { tab }), /protected/)
  protectedTitle = ''

  run = { id: 'second', signal: controller.signal }
  await assert.rejects(() => call('browser_inspect', { tab }), /expired/)
  const fresh = decode(await call('browser_tabs', {})).tabs[0].tab
  assert.notEqual(fresh, tab)
  // Stop must cancel a waiting action, not leave it queued for a later page state.
  state = decode(await call('browser_inspect', { tab: fresh, query: 'Play' }))
  await page.evaluate(() => {
    const cover = document.createElement('div')
    cover.style = 'position:fixed;inset:0;background:black;z-index:9999'
    document.body.append(cover)
  })
  const pending = call('browser_act', {
    observation: state.observation,
    element: state.controls[0].element,
    action: 'click'
  })
  setTimeout(() => controller.abort(new Error('Stop fixture')), 150)
  await assert.rejects(pending, /Stop fixture/)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert(page.isClosed(), 'Cancellation closes only the controlled tab to terminate pending input')
  console.log(
    'PASS real browser DOM: controls/text, password exclusion, contenteditable, actions/read-back, stale edits, navigation, task refs, policy and cancellation'
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await runtime.closeBrowsers()
    server.close()
  })
