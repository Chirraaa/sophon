const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const environment = require('./desktop-review/environment.cjs')
const { app, BrowserWindow, root, output, failures } = environment
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((window) => window.isResizable())
  main.webContents.setBackgroundThrottling(false)
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  await wait(() => !main.webContents.isLoading(), 'renderer')
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'composer')
  await evaluate('window.api.send("questions regression: help with quantum mechanics")')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Clarifying questions"]')`),
    'native question card'
  )
  assert(await evaluate('document.body.innerText.includes("1 of 3")'))
  assert(
    await evaluate(`(() => {
    const card = document.querySelector('[aria-label="Clarifying questions"]');
    const composer = document.querySelector('.composer-dock textarea');
    return !!card.closest('.composer-dock') &&
      !card.closest('[role="log"]') &&
      card.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top;
  })()`),
    'Questions sit above the main composer outside conversation history'
  )
  assert(!(await evaluate('document.body.innerText.includes("Save a lesson")')))

  assert.equal(await evaluate('document.querySelectorAll("[data-code-block]").length'), 0)
  await evaluate(
    `document.querySelector('[aria-label="Clarifying questions"]').scrollIntoView({block:'center'})`
  )
  await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  await delay(1000)
  fs.writeFileSync(
    path.join(output, 'questions-card.png'),
    (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
  )
  const choose = (text) =>
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes(${JSON.stringify(text)})).click()`
    )
  await choose('Explain the concepts simply')
  await wait(() => evaluate('document.body.innerText.includes("2 of 3")'), 'second question')
  await evaluate(`document.querySelector('[aria-label="Previous question"]').click()`)
  assert(
    await evaluate(
      'document.querySelector("[aria-pressed=true]").textContent.includes("Explain the concepts")'
    )
  )
  await evaluate(`document.querySelector('[aria-label="Next question"]').click()`)
  await evaluate(
    `(() => { const input = document.querySelector('[aria-label="Something else"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'First year university'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`
  )
  await wait(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Use answer")'
      ),
    'custom answer'
  )
  await choose('Use answer')
  await wait(() => evaluate('document.body.innerText.includes("3 of 3")'), 'third question')
  await choose('Skip')
  await wait(async () => !(await evaluate('window.api.getSession()')).busy, 'answer submission')
  const session = await evaluate('window.api.getSession()')
  const answers = session.items.find(
    (item) => item.from === 'you' && item.text.startsWith('My answers:')
  )
  assert(answers.text.includes('Explain the concepts simply'))
  assert(answers.text.includes('First year university'))
  assert(answers.text.includes('Skipped; use a reasonable assumption'))
  await evaluate('window.api.chats.create()')
  await evaluate('window.api.send("questions regression")')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Skip all questions"]')`),
    'second card'
  )
  await evaluate(`document.querySelector('[aria-label="Skip all questions"]').click()`)
  await wait(async () => !(await evaluate('window.api.getSession()')).busy, 'skip all')
  await evaluate('window.api.chats.create()')
  await evaluate('window.api.send("questions regression")')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Skip all questions"]')`),
    'third card'
  )
  await evaluate('window.api.send("Answer directly: explain uncertainty for a beginner")')
  await wait(async () => !(await evaluate('window.api.getSession()')).busy, 'direct reply')
  assert(
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Clarifying questions"] button')).every(button => button.disabled)`
    )
  )
  main.setSize(780, 650)
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'))
  assert.deepEqual(failures, [])
  console.log(
    'PASS native questions: three-step navigation, retained selection, custom answer, skip, skip all, free chat reply, stale-card disabling and narrow layout. Screenshot: .cache/desktop-review/questions-card.png'
  )
}
main()
  .then(() => {
    environment.cleanupWorkspace()
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    environment.cleanupWorkspace()
    app.exit(1)
  })
