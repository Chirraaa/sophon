const { app, BrowserWindow, globalShortcut } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/profile-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = globalShortcut.unregisterAll = () => {}
require(path.join(root, 'out/main/index.js'))
async function wait(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Profile UI wait timed out')
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().some((window) => window.isResizable()))
  const window = BrowserWindow.getAllWindows().find((window) => window.isResizable())
  window.webContents.setBackgroundThrottling(false)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  await window.webContents.insertCSS(
    '*, *::before, *::after { animation: none !important; transition: none !important; }'
  )
  const evaluate = (code) => window.webContents.executeJavaScript(code, true)
  const button = async (label) => {
    const find = `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)} && b.getBoundingClientRect().height && !b.disabled)`
    await wait(() => evaluate(`!!(${find})`))
    await evaluate(`(${find}).click()`)
    await delay(100)
  }
  const field = async (id, value) => {
    await evaluate(
      `(() => { const el = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
    await delay(60)
  }
  const capture = async (name) => {
    await delay(250)
    return fs.writeFileSync(
      path.join(output, name + '.png'),
      (
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).toPNG()
    )
  }
  await wait(() => evaluate(`!!document.getElementById('profile-name')`))
  await capture('onboarding')
  await field('profile-name', 'Alex')
  await button('Continue')
  await button('Coding')
  await button('Learning')
  await button('Continue')
  await field('profile-context', 'I am learning TypeScript. Explain unfamiliar concepts.')
  await button('Back')
  assert(
    await evaluate(
      `document.querySelector('button[value="coding"]')?.getAttribute('aria-pressed') === 'true' || [...document.querySelectorAll('button')].some(b => b.textContent === 'Coding' && b.getAttribute('aria-pressed') === 'true')`
    )
  )
  await button('Continue')
  await button('Continue')
  assert(
    await evaluate(
      `document.body.textContent.includes('Microphone disabled. Whisper will not run.')`
    )
  )
  await capture('microphone-setup')
  await evaluate(`(() => {
    window.microphoneRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.microphoneRequests++; throw new DOMException('Test denied', 'NotAllowedError'); };
    document.querySelector('[role="dialog"] [role="switch"]').click();
  })()`)
  await wait(() => evaluate(`document.body.textContent.includes('Detect microphones')`))
  await wait(() => evaluate(`document.body.textContent.includes('Microphone access was denied.')`))
  assert.equal(
    await evaluate('window.microphoneRequests'),
    1,
    'Enabling automatically discovers microphones'
  )
  await button('Detect microphones')
  await wait(() => evaluate(`document.body.textContent.includes('Microphone access was denied.')`))
  assert.equal(await evaluate('window.microphoneRequests'), 2)
  await evaluate(`document.querySelector('[role="dialog"] [role="switch"]').click()`)
  await wait(() =>
    evaluate(`document.body.textContent.includes('Microphone disabled. Whisper will not run.')`)
  )
  await button('Make yourself at home')
  await wait(() => evaluate(`!document.querySelector('[role="dialog"]')`))
  const saved = await evaluate('window.api.getSettings()')
  assert.equal(saved.profile.name, 'Alex')
  assert.deepEqual(saved.profile.uses, ['coding', 'learning'])
  assert.equal(saved.profile.onboardingComplete, true)
  assert.equal(saved.voice.enabled, false)
  assert(await evaluate(`document.querySelector('.welcome-state').textContent.includes('Alex')`))
  assert.equal(await evaluate(`document.querySelectorAll('.suggestion-card').length`), 0)
  await capture('greeting')
  await window.webContents.reload()
  await wait(() => evaluate(`!!document.querySelector('.welcome-state')`))
  assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false)
  await evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
  await button('Profile')
  await field('profile-name', 'Sam')
  await button('Save profile')
  await wait(() => evaluate(`document.body.textContent.includes('Profile saved.')`))
  await button('General')
  await button('Window & shortcuts')
  assert(await evaluate(`document.body.textContent.includes('Start with Windows')`))
  await button('Privacy')
  assert(await evaluate(`document.body.textContent.includes('Conversation expiry')`))
  await button('Model')
  await button('Generation')
  assert(await evaluate(`document.body.textContent.includes('Steps per request')`))
  await button('Behavior')
  assert.equal(await evaluate(`!!document.querySelector('textarea[rows="16"]')`), false)
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Core instructions')).click()`
  )
  await wait(() => evaluate(`!!document.querySelector('textarea[rows="16"]')`))
  for (const [width, height] of [
    [1120, 760],
    [780, 540]
  ]) {
    window.setSize(width, height)
    await button('General')
    await delay(150)
    const overflow = await evaluate(`document.documentElement.scrollWidth > innerWidth`)
    assert.equal(overflow, false, 'Settings fit the window')
    await capture(`settings-${width}`)
  }
  await evaluate(`document.querySelector('[aria-label="Assistant"]').click()`)
  await wait(() =>
    evaluate(`document.querySelector('.welcome-state')?.textContent.includes('Sam')`)
  )

  await window.webContents.debugger.sendCommand('Page.enable')
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.microphoneRequests = 0;
      window.microphoneReleases = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.microphoneRequests++;
        return { getTracks: () => [{ stop: () => { window.microphoneReleases++; } }] };
      };
      navigator.mediaDevices.enumerateDevices = async () => window.microphoneRequests
        ? [{ kind: 'audioinput', deviceId: 'usb-mic', label: 'USB test microphone', groupId: 'test' }]
        : [{ kind: 'audioinput', deviceId: '', label: '', groupId: '' }];
    `
  })
  await evaluate(`window.api.updateSettings({ voice: { enabled: true, deviceId: 'usb-mic' } })`)
  window.webContents.reload()
  await wait(() => evaluate('window.microphoneReleases === 1'))
  assert.equal(
    await evaluate('window.microphoneRequests'),
    1,
    'Startup discovers enabled devices once'
  )
  await evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
  await button('Voice')
  await wait(() => evaluate(`document.body.textContent.includes('USB test microphone')`))
  assert.equal(await evaluate('window.microphoneRequests'), 1, 'Settings reuse startup discovery')
  await evaluate(`window.api.updateSettings({ voice: { enabled: false } })`)
  window.webContents.reload()
  await wait(() => evaluate(`!!document.querySelector('[aria-label="Settings"]')`))
  await evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
  await button('Voice')
  await wait(() =>
    evaluate(`document.body.textContent.includes('Microphone disabled. Whisper will not run.')`)
  )
  assert.equal(
    await evaluate('window.microphoneRequests'),
    0,
    'Disabled startup never opens a microphone'
  )
  assert(BrowserWindow.getAllWindows().every((window) => !window.isVisible()))
  console.log(
    'PASS hidden UI: onboarding, optional preferences, persistence, editable profile, greetings and compact settings'
  )
}
main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
