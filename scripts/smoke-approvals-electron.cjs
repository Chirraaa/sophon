const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/approval-review')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let state
let failDecision = false
const decisions = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel === 'session:get' && state) return state
    if (channel === 'approval:resolve') {
      if (failDecision) throw new Error('Fixture save failed')
      decisions.push(args.slice(1))
      return
    }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const until = Date.now() + 10000
  while (Date.now() < until) {
    if (await check()) return
    await delay(40)
  }
  throw new Error('Timed out: ' + label)
}
function fixture(npm = false) {
  const id = crypto.randomUUID()
  state = {
    mode: 'assistant',
    chatId: 'fixture',
    busy: true,
    runningChatId: 'fixture',
    chats: [{ id: 'fixture', title: 'Approval review', updatedAt: Date.now() }],
    items: [
      {
        id: 'question',
        from: 'you',
        text: 'Update the designer view.',
        actions: [],
        pending: false
      },
      {
        id: 'reply',
        from: 'agent',
        text:
          'I’ll update the file after you review the change.\n\n' +
          'Earlier task context. '.repeat(150),
        pending: true,
        actions: [
          {
            id,
            name: npm ? 'run_npm' : 'edit_file',
            label: npm ? 'Run npm commands' : 'Edit project files',
            status: 'waiting',
            canAlwaysAllow: !npm,
            preview: JSON.stringify(
              {
                taskId: 'fixture',
                destination: 'C:\\Projects\\Sophon\\app\\ui\\views\\designer_view.py',
                arguments: npm
                  ? { args: ['run', 'build'] }
                  : {
                      path: 'app/ui/views/designer_view.py',
                      old: 'window.title = "Designer"',
                      new: 'window.title = "Sophon Designer"'
                    }
              },
              null,
              2
            )
          }
        ]
      }
    ]
  }
  return id
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  for (const [name, win] of [
    ['full-app', main],
    ['shortcut', compact]
  ]) {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
    const evaluate = (code) => win.webContents.executeJavaScript(code, true)
    await wait(() => evaluate('!!document.querySelector("textarea")'), name + ' ready')
    const publish = async (npm = false) => {
      const id = fixture(npm)
      win.webContents.send('session:update', state)
      await wait(
        () =>
          evaluate(
            `document.querySelector('section[aria-busy] h3')?.textContent.includes('Allow Sophon')`
          ),
        'approval panel'
      )
      await delay(150)
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      await delay(800)
      return id
    }
    const click = (label) =>
      evaluate(
        `Array.from(document.querySelectorAll('section[aria-busy] button')).find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`
      )
    const id = await publish()
    const bounds = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-busy]').getBoundingClientRect();
      const composer = document.querySelector('textarea').getBoundingClientRect();
      return { panelBottom: panel.bottom, composerTop: composer.top, composerBottom: composer.bottom, height: innerHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollY };
    })()`)
    assert(bounds.panelBottom <= bounds.composerTop, name + ' approval above composer')
    assert(
      bounds.composerBottom <= bounds.height,
      name +
        ' composer stays in window: ' +
        JSON.stringify({
          ...bounds,
          nativeBounds: win.getBounds(),
          card: await evaluate(
            "({height:document.querySelector('.compact-arrive')?.offsetHeight,max:document.querySelector('.compact-arrive')?.style.maxHeight})"
          )
        })
    )
    assert(bounds.scrollWidth <= bounds.width, name + ' no horizontal overflow')
    assert.equal(bounds.scrollY, 0, name + ' host window must not scroll')
    fs.writeFileSync(
      path.join(output, name + '.png'),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    )
    await click('Always allow')
    assert.equal(decisions.length, name === 'full-app' ? 0 : 4)
    assert(
      await evaluate(
        `document.querySelector('section[aria-busy]').textContent.includes('in every chat')`
      )
    )
    await click('Always allow this tool')
    await wait(() => decisions.at(-1)?.[1] === 'always', 'permanent decision')
    assert.deepEqual(decisions.at(-1), [id, 'always'])
    await publish()
    failDecision = true
    await click('Allow once')
    await wait(
      () =>
        evaluate(
          `document.querySelector('section [role="alert"]')?.textContent.includes('Fixture save failed')`
        ),
      'decision error'
    )
    failDecision = false
    await click('Allow once')
    await wait(() => decisions.at(-1)?.[1] === 'once', 'retry decision')
    await publish(true)
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('section[aria-busy] button')).some(b => b.textContent.includes('Always allow'))`
      ),
      false
    )
    await click('Deny')
    await wait(() => decisions.at(-1)?.[1] === 'deny', 'denial')
    await publish()
    const beforeKeyboard = decisions.length
    await evaluate(`document.querySelector('textarea').focus();
      document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }));`)
    await delay(100)
    assert.equal(decisions.length, beforeKeyboard, 'Typing and composition cannot approve')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['control'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['control'] })
    await wait(() => decisions.length === beforeKeyboard + 1, 'Ctrl+Enter approval')
    assert.equal(decisions.at(-1)[1], 'once')
  }
  assert.equal(decisions.length, 8)
  console.log(
    'PASS full app and shortcut approval layout, long history scrolling, permanent scope review, npm one-use-only, decision failure/retry and deny; hidden disposable UI fixtures'
  )
}
review()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
