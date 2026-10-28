const { app, BrowserWindow, globalShortcut, ipcMain, safeStorage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/microsoft-ui')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    if (channel === 'llm:status') return { online: false, model: '' }
    if (channel === 'llm:modelInfo') return { id: 'fixture' }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))

const CLIENT = '11111111-2222-4333-8444-555555555555'
const ONE = '10000000-0000-4000-8000-000000000001'
const TWO = '20000000-0000-4000-8000-000000000002'
const SECRET = 'canary-refresh-token-do-not-show'

async function wait(check, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'application windows')
  const main = BrowserWindow.getAllWindows().find((w) => w.isResizable())
  const errors = []
  main.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  main.webContents.setBackgroundThrottling(false)
  main.webContents.debugger.attach('1.3')
  await main.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  await main.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  const section = `document.querySelector('section[aria-label="Microsoft accounts"]')`
  const click = async (label, scope = section) => {
    const button = `Array.from(${scope}.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)})`
    await wait(() => evaluate(`!!(${button}) && !(${button}).disabled`), 'enabled button: ' + label)
    await evaluate(`(${button}).click()`)
  }
  const setField = (value) =>
    evaluate(
      `(() => { const el = ${section}.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
  const status = () => evaluate('window.api.microsoft.status()')
  const rows = `Array.from(${section}.querySelectorAll('ul[aria-label="Connected Microsoft accounts"] > li'))`
  const row = (email) => `${rows}.find(li => li.textContent.includes(${JSON.stringify(email)}))`

  await wait(
    () => evaluate(`!!document.querySelector('nav[aria-label="Main navigation"]')`),
    'navigation'
  )
  await click('Skip setup', `document.querySelector('[role="dialog"]')`)
  await wait(() => evaluate(`!document.querySelector('[role="dialog"]')`), 'onboarding complete')

  // Seed accounts with the real OS encryption, as a previous session would have saved them.
  const file = path.join(profile, 'microsoft-auth.enc')
  const account = (id, name, email, signedIn) => ({
    id,
    subject: id,
    tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
    name,
    email,
    scopes: ['User.Read', 'Calendars.ReadWrite'],
    ...(signedIn
      ? { accessToken: 'access-canary', refreshToken: SECRET, expiresAt: Date.now() + 3600000 }
      : {})
  })
  const seed = (store) => fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(store)))

  await click('Settings', `document.querySelector('nav[aria-label="Main navigation"]')`)
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('[role="tab"]')).some(el => el.textContent === 'Plugins')`
      ),
    'plugins tab'
  )
  await click('Plugins', 'document')
  await wait(() => evaluate(`!!(${section})`), 'Microsoft section')

  // First run: nothing configured, so sign-in is unavailable and the reason is stated.
  await wait(() => evaluate(`!(${section}).textContent.includes('Checking connections')`), 'status')
  assert(await evaluate(`(${section}).textContent.includes('Save an application ID first.')`))
  assert(
    await evaluate(
      `Array.from(${section}.querySelectorAll('button')).find(b => /Connect a Microsoft account/.test(b.textContent)).disabled`
    )
  )

  // Inline validation: styled alert, no native browser bubble.
  assert.equal(await evaluate(`(${section}).querySelector('form').noValidate`), true)
  await setField('not-a-guid')
  await click('Save')
  await wait(() => evaluate(`!!(${section}).querySelector('[role="alert"]')`), 'inline error')
  assert(
    await evaluate(
      `(${section}).querySelector('[role="alert"]').textContent.includes('Application (client) ID')`
    )
  )
  assert.equal(
    await evaluate(`(${section}).querySelector('input').getAttribute('aria-invalid')`),
    'true'
  )
  assert.equal((await status()).clientId, '')
  await setField(CLIENT)
  await wait(
    () =>
      evaluate(
        `!(${section}).querySelector('input').getAttribute('aria-invalid') || (${section}).querySelector('input').getAttribute('aria-invalid') === 'false'`
      ),
    'error clears on edit'
  )
  await click('Save')
  await wait(async () => (await status()).clientId === CLIENT, 'client id saved')
  await wait(
    () =>
      evaluate(
        `!Array.from(${section}.querySelectorAll('button')).find(b => /Connect a Microsoft account/.test(b.textContent)).disabled`
      ),
    'connect enabled'
  )

  // Accounts load automatically and switching/removal are explicit.
  seed({
    clientId: CLIENT,
    activeId: ONE,
    accounts: [
      account(ONE, 'Ada Lovelace', 'ada@example.test', true),
      account(TWO, 'Grace Hopper', 'grace@example.test', false)
    ]
  })
  await click('General', 'document')
  await wait(() => evaluate(`!(${section})`), 'left Plugins tab')
  await click('Plugins', 'document')
  await wait(() => evaluate(`${rows}.length === 2`), 'accounts listed')
  const ada = await evaluate(`(${row('ada@example.test')}).textContent`)
  const grace = await evaluate(`(${row('grace@example.test')}).textContent`)
  assert(ada.includes('Ada Lovelace') && ada.includes('Active') && ada.includes('Calendar'))
  assert(!ada.includes('Use this account'))
  assert(
    grace.includes('Signed out') &&
      grace.includes('Reconnect') &&
      grace.includes('Use this account')
  )
  assert.equal(await evaluate(`(${section}).querySelector('input').disabled`), true)
  assert(
    await evaluate(
      `(${section}).textContent.includes('Remove the connected accounts to change this ID.')`
    )
  )
  assert(await evaluate(`(${section}).textContent.includes('Add another account')`))
  const page = await evaluate('document.body.innerText + document.documentElement.outerHTML')
  assert(
    !page.includes(SECRET) && !page.includes('access-canary'),
    'tokens never reach the interface'
  )
  assert(!fs.readFileSync(file).includes(Buffer.from(SECRET)), 'credentials are encrypted on disk')

  await click('Use this account', row('grace@example.test'))
  await wait(async () => (await status()).activeId === TWO, 'switched account')
  await wait(
    () => evaluate(`(${row('grace@example.test')}).textContent.includes('Active')`),
    'active badge moved'
  )
  assert(!(await evaluate(`(${row('ada@example.test')}).textContent.includes('Active')`)))

  // Removal asks first; keeping leaves the account alone.
  await click('Remove', row('ada@example.test'))
  await wait(
    () => evaluate(`!!document.querySelector('[role="alertdialog"]')`),
    'removal confirmation'
  )
  const dialog = await evaluate(`document.querySelector('[role="alertdialog"]').textContent`)
  assert(dialog.includes('ada@example.test') && dialog.includes('not changed'))
  await click('Keep account', `document.querySelector('[role="alertdialog"]')`)
  await wait(() => evaluate(`!document.querySelector('[role="alertdialog"]')`), 'dialog closed')
  assert.equal((await status()).accounts.length, 2)
  await click('Remove', row('ada@example.test'))
  await wait(
    () => evaluate(`!!document.querySelector('[role="alertdialog"]')`),
    'second confirmation'
  )
  await click('Remove account', `document.querySelector('[role="alertdialog"]')`)
  await wait(async () => (await status()).accounts.length === 1, 'account removed')
  await wait(() => evaluate(`${rows}.length === 1`), 'row removed')
  await click('Remove', row('grace@example.test'))
  await wait(
    () => evaluate(`!!document.querySelector('[role="alertdialog"]')`),
    'last confirmation'
  )
  await click('Remove account', `document.querySelector('[role="alertdialog"]')`)
  await wait(async () => (await status()).accounts.length === 0, 'all removed')
  await wait(
    () => evaluate(`!(${section}).querySelector('input').disabled`),
    'application ID unlocked'
  )
  assert(await evaluate(`(${section}).textContent.includes('Connect a Microsoft account')`))

  assert.deepEqual(
    errors.filter((message) => !message.startsWith("Loading the font 'data:font/woff2;base64,")),
    []
  )
  assert(
    BrowserWindow.getAllWindows().every((win) => !win.isVisible()),
    'Test windows stay hidden'
  )
  console.log(
    'PASS production Microsoft accounts UI: inline validation, application ID locking, automatic account list, explicit switch, confirmed removal, no token exposure'
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
