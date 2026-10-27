const assert = require('node:assert/strict')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { clipboard } = require('electron')
const environment = require('./desktop-review/environment.cjs')
const { app, BrowserWindow, root, failures } = environment
require(path.join(root, 'out/main/index.js'))

async function wait(check, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}

async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  main.webContents.setBackgroundThrottling(false)
  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  const evaluate = (code) =>
    main.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(`${error.message}\n${code}\n${JSON.stringify(failures)}`)
    })
  const click = (label) => evaluate(`document.querySelector('[aria-label="${label}"]').click()`)
  const setDraft = (text) =>
    evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="Edit prompt"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const menuItem = (label) =>
    evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.startsWith(${JSON.stringify(label)}));
    if (!item || item.getAttribute('aria-disabled') === 'true') throw new Error('Missing enabled menu item');
    item.click();
  })()`)
  const openMenu = async (selector) => {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.x + 10, clientY: rect.y + 10 }));
    })()`)
    await wait(() => evaluate('!!document.querySelector("[role=menu]")'), 'context menu')
  }
  await wait(() => evaluate('!!window.api && !!document.querySelector("textarea")'), 'renderer')
  await evaluate(
    `window.api.updateSettings({motion: 'reduced', profile: {name: 'Alex', onboardingComplete: true}})`
  )
  await evaluate('window.api.send("Original prompt")')
  await wait(
    () => evaluate(`!!document.querySelector('[aria-label="Copy message"]')`),
    'sent message'
  )
  await wait(async () => !(await evaluate('window.api.getSession()')).busy, 'response')
  await click('Copy message')
  await wait(async () => (await clipboard.readText()) === 'Original prompt', 'copy sent message')
  await click('Edit prompt')
  await wait(
    () => evaluate(`!!document.querySelector('textarea[aria-label="Edit prompt"]')`),
    'inline editor'
  )
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.selectable')].filter(el => el.textContent === 'Original prompt').length`
    ),
    0,
    'original user bubble is replaced'
  )
  assert.equal(
    await evaluate(`document.querySelector('textarea[aria-label="Edit prompt"]').value`),
    'Original prompt'
  )
  await setDraft('Unsaved draft')
  await evaluate(
    `[...document.querySelectorAll('button')].find(el => el.textContent === 'Cancel').click()`
  )
  assert.equal((await evaluate('window.api.getSession()')).items[0].text, 'Original prompt')
  await click('Edit prompt')
  await setDraft('Keep selected tail')
  await evaluate(
    `(() => { const el = document.querySelector('textarea[aria-label="Edit prompt"]'); el.focus(); el.setSelectionRange(5, 13); })()`
  )
  await openMenu('textarea[aria-label="Edit prompt"]')
  await menuItem('Copy')
  await wait(async () => (await clipboard.readText()) === 'selected', 'copy selected input text')
  await wait(() => evaluate('!document.querySelector("[role=menu]")'), 'menu closed')
  await clipboard.writeText('pasted')
  await openMenu('textarea[aria-label="Edit prompt"]')
  await menuItem('Paste')
  await wait(
    () =>
      evaluate(
        `document.querySelector('textarea[aria-label="Edit prompt"]').value === 'Keep pasted tail'`
      ),
    'paste replaces selection and updates React'
  )
  await evaluate(
    `(() => { const el = document.querySelector('textarea[aria-label="Edit prompt"]'); el.focus(); el.setSelectionRange(5, 11); })()`
  )
  await openMenu('textarea[aria-label="Edit prompt"]')
  await menuItem('Cut')
  await wait(async () => (await clipboard.readText()) === 'pasted', 'cut writes clipboard')
  await wait(
    () =>
      evaluate(
        `document.querySelector('textarea[aria-label="Edit prompt"]').value === 'Keep  tail'`
      ),
    'cut updates React'
  )
  await openMenu('textarea[aria-label="Edit prompt"]')
  await menuItem('Undo')
  await wait(
    () =>
      evaluate(
        `document.querySelector('textarea[aria-label="Edit prompt"]').value === 'Keep pasted tail'`
      ),
    'undo cut'
  )
  await openMenu('textarea[aria-label="Edit prompt"]')
  await menuItem('Redo')
  await wait(
    () =>
      evaluate(
        `document.querySelector('textarea[aria-label="Edit prompt"]').value === 'Keep  tail'`
      ),
    'redo cut'
  )
  await openMenu('textarea[aria-label="Edit prompt"]')
  await menuItem('Select all')
  await wait(
    () =>
      evaluate(
        `(() => { const el = document.querySelector('textarea[aria-label="Edit prompt"]'); return el.selectionStart === 0 && el.selectionEnd === el.value.length })()`
      ),
    'select all in editor'
  )
  await setDraft('Revised prompt')
  await evaluate(
    `[...document.querySelectorAll('button')].find(el => el.textContent === 'Save and rerun').click()`
  )
  await wait(async () => {
    const session = await evaluate('window.api.getSession()')
    return !session.busy && session.items[0].text === 'Revised prompt'
  }, 'saved prompt reruns')
  assert.equal(
    await evaluate(`!!document.querySelector('textarea[aria-label="Edit prompt"]')`),
    false
  )
  await evaluate(`(() => {
    const el = document.querySelector('.selectable');
    const range = document.createRange(); range.selectNodeContents(el);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  })()`)
  await openMenu('.selectable')
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent.startsWith('Paste'))`
    ),
    false
  )
  await menuItem('Copy')
  await wait(
    async () => (await clipboard.readText()) === 'Revised prompt',
    'copy selected message text'
  )
  assert.deepEqual(failures, [])
  console.log(
    'PASS sent-message copy, inline edit/cancel/save and rerun, selected text copy, cut, paste, undo, redo, select all and React state updates'
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
