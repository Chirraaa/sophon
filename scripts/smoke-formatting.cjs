const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { clipboard } = require('electron')
const environment = require('./desktop-review/environment.cjs')
const { app, BrowserWindow, root, output, failures } = environment
const fixture = require('./desktop-review/formatting-fixtures.cjs')
const { load } = require('./security/load.cjs')
const { normalizeMath } = load('src/renderer/src/lib/markdown.ts')
const literal = '```python\n\\(x\\)\n\\[x\\]\n```\n`\\(inline\\)`'
assert.equal(normalizeMath(literal), literal)
const unfinished = '~~~python\n\\(x\\)\n\\[x\\]'
assert.equal(normalizeMath(unfinished), unfinished)
assert.equal(normalizeMath('\\(x^2\\)'), '$x^2$')
assert.match(normalizeMath('\\[x^2\\]'), /\$\$\nx\^2\n\$\$/)
let copied
clipboard.writeText = (text) => {
  copied = text
}
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  main.webContents.setBackgroundThrottling(false)
  compact.webContents.setBackgroundThrottling(false)
  await wait(
    () => !main.webContents.isLoading() && !compact.webContents.isLoading(),
    'renderers loaded'
  )
  const evaluate = (code) =>
    main.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Evaluation failed:', code, failures)
      throw error
    })
  const capture = async (name) => {
    const frame = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await main.webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true
          })
        } catch (error) {
          if (attempt >= 2 || !String(error).includes('UnknownVizError')) throw error
          await delay(300)
        }
      }
    }
    await frame()
    await delay(400)
    fs.writeFileSync(path.join(output, name + '.png'), (await frame()).toPNG())
  }
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'composer')
  assert.equal(await evaluate('!!document.querySelector("select")'), false)
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Task mode"]')`), false)
  assert.equal((await evaluate('window.api.getSession()')).mode, 'assistant')
  await capture('formatting-home')
  await wait(
    () => evaluate('document.body.innerText.includes("Open an app")'),
    'general assistant suggestions'
  )
  await evaluate('window.api.send("formatting regression")')
  const chat = await evaluate('window.api.getSession()')
  await wait(
    () => evaluate('document.querySelectorAll(".katex-display").length >= 6'),
    'math render'
  )
  await evaluate('document.fonts.ready')
  await wait(
    () => evaluate('document.querySelectorAll("[data-code-block]").length === 6'),
    'complete streamed formatting reply'
  )
  await wait(
    () => evaluate('document.querySelectorAll(".chat-markdown table").length === 1'),
    'streamed table at end of reply'
  )
  assert.equal(await evaluate('document.querySelectorAll(".katex-error").length'), 0)
  assert(await evaluate('document.querySelectorAll("math").length >= 8'))
  assert.equal(await evaluate('document.querySelectorAll("[data-code-block]").length'), 6)
  assert.equal(await evaluate('document.querySelectorAll(".hljs-keyword").length > 5'), true)
  assert.equal(
    await evaluate(
      '!!document.querySelector(".hljs-addition") && !!document.querySelector(".hljs-deletion")'
    ),
    true
  )
  assert.equal(
    await evaluate('document.querySelector("[data-code-block] pre").textContent'),
    fixture.python
  )
  await evaluate(`document.querySelector('[aria-label="Copy code"]').click()`)
  await wait(() => Promise.resolve(copied === fixture.python), 'exact copied source')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Code copied"]')`),
    'copy feedback'
  )
  assert.equal(await evaluate('window.bad'), undefined)
  assert.equal(await evaluate('document.querySelectorAll(".chat-markdown table").length'), 1)
  assert.equal(
    await evaluate('document.querySelectorAll(".chat-markdown p code")[0].textContent'),
    '\\(also literal\\)'
  )
  await delay(600)
  await evaluate(`(() => {
    const viewport = document.querySelector('.chat-markdown').closest('[data-slot="scroll-area-viewport"]')
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll'))
  })()`)
  await wait(
    () =>
      evaluate(
        `document.querySelector('.chat-markdown').closest('[data-slot="scroll-area-viewport"]').scrollTop < 5`
      ),
    'math in view'
  )
  await capture('formatting-math')
  await evaluate('document.querySelector("[data-code-block]").scrollIntoView({block:"start"})')
  await capture('formatting-code')
  main.setSize(780, 650)
  await delay(250)
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  assert(
    await evaluate(
      'Array.from(document.querySelectorAll("[data-code-block]")).every(n => n.getBoundingClientRect().right <= innerWidth)'
    )
  )
  await capture('formatting-narrow')
  await evaluate('window.api.updateSettings({research:{enabled:true}})')
  await evaluate('window.api.chats.create()')
  await evaluate('window.api.send("formatting regression")')
  await wait(
    () => evaluate('document.querySelectorAll("[data-code-block]").length === 6'),
    'formatting with web search enabled'
  )
  assert(await evaluate('document.querySelectorAll(".katex-display").length >= 6'))
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0)
  await evaluate(`window.api.chats.select(${JSON.stringify(chat.chatId)})`)
  await compact.webContents.executeJavaScript('window.api.getSession()', true)
  await wait(
    () =>
      compact.webContents.executeJavaScript(
        'document.querySelectorAll(".katex-display").length >= 6',
        true
      ),
    'compact rendering'
  )
  assert.deepEqual(failures, [])
  console.log(
    'PASS unified assistant suggestions, inline/display TeX, aligned equations, matrices, cases, local fonts, six code languages, exact copy, diff colors, literal code, Markdown tables, narrow and compact layouts; no model loaded'
  )
}
review()
  .then(() => {
    environment.cleanupWorkspace()
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    environment.cleanupWorkspace()
    app.exit(1)
  })
