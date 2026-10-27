const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const environment = require('./desktop-review/environment.cjs')
const { app, BrowserWindow, root, profile, output, failures } = environment
const reviewChat = require('./desktop-review/chat.cjs')
const reviewFiles = require('./desktop-review/files.cjs')
const reviewSettings = require('./desktop-review/settings.cjs')
const reviewPopup = require('./desktop-review/popup.cjs')
const reviewVisuals = require('./desktop-review/visuals.cjs')
const reviewVisualSecurity = require('./desktop-review/visual-security.cjs')
const reviewVisualCapability = require('./desktop-review/visual-capability.cjs')
const reviewVisualToolkit = require('./desktop-review/visual-toolkit.cjs')
require(path.join(root, 'out/main/index.js'))
async function wait(check, label, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => win.isResizable())
  const compact = windows.find((win) => !win.isResizable())
  const evaluate = (code) =>
    main.webContents.executeJavaScript(code, true).catch((error) => {
      console.error('Evaluation failed:', code)
      throw error
    })
  const compactEval = (code) => compact.webContents.executeJavaScript(code, true)
  await wait(
    () => !main.webContents.isLoading() && !compact.webContents.isLoading(),
    'renderer loaded'
  )
  const context = { ...environment, main, compact, evaluate, compactEval, wait, delay }

  await evaluate('window.api.updateSettings({model:{contextWindow:60000}})')
  context.runVisuals = async () => {
    await delay(100)
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Run visual')`
      ),
      false
    )
  }
  Object.assign(context, await reviewChat(context))
  await reviewFiles(context)
  await reviewVisuals(context)
  await reviewVisualToolkit(context)
  await reviewVisualSecurity(context)
  await reviewVisualCapability(context)
  await reviewSettings(context)
  await reviewPopup(context)
  const { second } = context
  await evaluate(`window.api.chats.delete(${JSON.stringify(second.chatId)})`)
  assert.equal((await evaluate('window.api.getSession()')).chats.length, 1)
  assert.deepEqual(failures, [])
  console.log('PASS no renderer errors; isolated profile: ' + profile)
}
review()
  .then(() => {
    environment.cleanupWorkspace()
    app.quit()
  })
  .catch((error) => {
    console.error('FEATURE REVIEW FAILED', error)
    fs.writeFileSync(path.join(output, 'features-failure.txt'), String(error.stack))
    environment.cleanupWorkspace()
    app.exit(1)
  })
