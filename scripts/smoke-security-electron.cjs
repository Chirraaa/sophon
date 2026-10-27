const { app, BrowserWindow, globalShortcut, dialog, net, session, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.cache/security-electron')
fs.mkdirSync(directory, { recursive: true })
const profile = fs.mkdtempSync(path.join(directory, 'profile-'))
const legacyAttachment = 'a0000000-0000-4000-8000-000000000001'
const legacyChat = 'b0000000-0000-4000-8000-000000000001'
fs.mkdirSync(path.join(profile, 'attachments'))
fs.writeFileSync(
  path.join(profile, 'attachments', legacyAttachment + '.bin'),
  'SYNTHETIC_LEGACY_PRIVATE_CANARY'
)
fs.writeFileSync(
  path.join(profile, 'attachments', legacyAttachment + '.json'),
  JSON.stringify({ id: legacyAttachment, name: 'fixture.txt', mimeType: 'text/plain', size: 31 })
)
fs.writeFileSync(
  path.join(profile, 'chats.json'),
  JSON.stringify({
    activeId: legacyChat,
    chats: [
      {
        id: legacyChat,
        mode: 'assistant',
        title: 'SYNTHETIC_CHAT_CANARY',
        updatedAt: Date.now(),
        items: [],
        history: []
      }
    ]
  })
)
fs.writeFileSync(path.join(profile, 'settings.json'), '{corrupt-synthetic-settings')
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let nativeResponse = 1
let nativePrompts = 0
dialog.showMessageBox = async () => {
  nativePrompts++
  return { response: nativeResponse }
}
require('./security/consent-fixture.cjs')(
  app,
  async () => (await dialog.showMessageBox(null, {})).response === 1
)

dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [path.join(root, 'resources/icon.png')]
})
const errors = []
let rejectDiagnostics = false
let diagnosticsCalls = 0
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel === 'privacy:clear-security-events') {
      diagnosticsCalls++
      await delay(200)
      if (rejectDiagnostics) throw new Error('Diagnostics are locked. Please retry.')
    }
    return listener(...args)
  })
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_e, _path, error) => errors.push(error.message))
  contents.on('render-process-gone', (_e, details) => errors.push(details.reason))
})
require(path.join(root, 'out/main/index.js'))
async function wait(check, label, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'two application windows')
  const windows = BrowserWindow.getAllWindows()
  await wait(() => windows.every((w) => !w.webContents.isLoading()), 'application documents loaded')
  const main = windows.find((w) => w.isResizable())
  const evaluate = (code) => main.webContents.executeJavaScript(code, true)
  const recovery = await evaluate('window.api.settingsRecovery()')
  assert.equal(recovery.required, true)
  assert.equal(
    fs.readFileSync(path.join(profile, recovery.backup), 'utf8'),
    '{corrupt-synthetic-settings'
  )
  nativeResponse = 0
  await evaluate('window.api.reviewSettingsRecovery()')
  assert.equal((await evaluate('window.api.settingsRecovery()')).required, true)
  await assert.rejects(evaluate('window.api.attachments.screenshot()'), /Review security settings/)
  nativeResponse = 1
  await evaluate('window.api.reviewSettingsRecovery()')
  assert.equal((await evaluate('window.api.settingsRecovery()')).required, false)
  assert(
    Object.values((await evaluate('window.api.getSettings()')).tools).every((p) => p === 'block')
  )
  for (const filename of [
    'conversations/index.json',
    `attachments/${legacyAttachment}.bin`,
    `attachments/${legacyAttachment}.json`
  ]) {
    const bytes = fs.readFileSync(path.join(profile, filename))
    assert(bytes.subarray(0, 8).equals(Buffer.from('SOPHON2\0')))
    assert(!bytes.includes(Buffer.from('CANARY')))
  }
  assert.equal(
    (await evaluate(`window.api.attachments.preview('${legacyAttachment}')`)).text,
    'SYNTHETIC_LEGACY_PRIVATE_CANARY'
  )
  console.log(
    'PASS real OS-backed storage migration and corrupt-settings backup/native recovery/capture lockout'
  )
  for (const window of windows) {
    const preferences = window.webContents.getLastWebPreferences()
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.webSecurity, true)
    assert.equal(preferences.webviewTag, false)
    assert.equal(window.webContents.getURL().split('#')[0], 'sophon-app://app/index.html')
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        `({generic:typeof window.electron,node:typeof require,api:typeof window.api.send})`
      ),
      { generic: 'undefined', node: 'undefined', api: 'function' }
    )
  }
  await wait(
    () => evaluate('Boolean(document.querySelector("textarea"))'),
    'React application mounted'
  )
  console.log(
    'PASS built main and compact windows: sandbox, context isolation, no Node/generic bridge, trusted app scheme and React mount'
  )
  assert.equal((await evaluate('window.api.getSession()')).mode, 'assistant')
  const initialSettings = await evaluate('window.api.getSettings()')
  nativeResponse = 0
  const promptCount = nativePrompts
  assert.equal((await evaluate('window.api.updateSettings({research:{enabled:true}})')).ok, false)
  assert.equal((await evaluate('window.api.getSettings()')).research.enabled, false)
  const automaticVisual = await evaluate(
    `window.api.visuals.create('<h1>Automatic</h1><script>document.title="automatic"</script>')`
  )
  assert(automaticVisual?.url.startsWith('sophon-visual:'))
  assert.equal(nativePrompts, promptCount + 1, 'Sandboxed visuals do not ask for approval')
  await evaluate(`window.api.visuals.release(${JSON.stringify(automaticVisual.id)})`)
  nativeResponse = 1
  for (const patch of [{ files: { workspace: 'C:\\Users' } }, { hotkeys: { summon: 'A' } }]) {
    const result = await evaluate(
      `window.api.updateSettings(${JSON.stringify(patch)}).catch(e=>({ok:false,error:e.message}))`
    )
    assert.equal(result.ok, false)
  }
  assert.deepEqual(await evaluate('window.api.getSettings()'), initialSettings)
  await evaluate('window.api.updateSettings({research:{enabled:true}})')
  assert.equal((await evaluate('window.api.getSession()')).mode, 'assistant')
  const grant = await evaluate('window.api.updateSettings({tools:{read_file:"allow"}})')
  assert(grant.ok)
  assert.equal(grant.settings.tools.read_file, 'allow')
  await evaluate('window.api.updateSettings({tools:{read_file:"ask"}})')
  assert.equal(await evaluate(`typeof window.api.setMode`), 'undefined')
  console.log(
    'PASS native veto, no generic workspace/bare hotkeys, persistent tool grants and a single assistant mode'
  )
  await assert.rejects(evaluate('window.api.updateSettings({bogus:true})'), /Invalid IPC/)
  assert.equal(
    (await evaluate('window.api.updateSettings({model:{endpoint:"https://example.com/v1"}})')).ok,
    false
  )
  const csp = await evaluate(
    `document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`
  )
  assert(csp.includes("connect-src 'none'"))
  assert.equal(await evaluate(`fetch('http://127.0.0.1:9').then(()=>false,()=>true)`), true)
  assert.equal((await net.fetch('sophon-app://app/forbidden.txt')).status, 403)
  const original = main.webContents.getURL()
  await evaluate(`location.href='https://example.com/blocked-navigation'`)
  await delay(100)
  assert.equal(main.webContents.getURL(), original)
  console.log(
    'PASS real IPC payload/endpoint rejection, production CSP, blocked renderer network, asset allowlist and navigation denial'
  )

  const rogue = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(root, 'out/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await rogue.loadURL('sophon-app://app/index.html')
  await assert.rejects(
    rogue.webContents.executeJavaScript('window.api.getSettings()'),
    /Untrusted IPC sender/
  )
  rogue.destroy()
  const visual = await evaluate(`window.api.visuals.create('<h1>Security fixture</h1>')`)
  await evaluate(
    `(() => { const f=document.createElement('iframe');f.id='security-fixture';f.sandbox='allow-scripts';f.src=${JSON.stringify(visual.url)};document.body.appendChild(f) })()`
  )
  await wait(
    () => main.webContents.mainFrame.frames.some((frame) => frame.url === visual.url),
    'visual subframe committed'
  )
  const frame = main.webContents.mainFrame.frames.find((frame) => frame.url === visual.url)
  assert.notEqual(
    frame.processId,
    main.webContents.mainFrame.processId,
    'Generated scripts must run in a separate renderer process'
  )
  assert.equal(await frame.executeJavaScript('typeof window.api'), 'undefined')
  assert.equal(
    await frame.executeJavaScript(`fetch('http://127.0.0.1:9').then(()=>false,()=>true)`),
    true
  )
  const tcp = require('node:net').createServer((socket) => {
    tcpHits++
    socket.destroy()
  })
  const udp = require('node:dgram').createSocket('udp4')
  let tcpHits = 0,
    udpHits = 0
  udp.on('message', () => udpHits++)
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve))
  const logPath = path.join(profile, 'egress-canary.json')
  await session.defaultSession.netLog.startLogging(logPath)
  try {
    await frame.executeJavaScript(`(() => {
      globalThis.canaryPeers=[];
      for(const url of ['stun:127.0.0.1:${udp.address().port}', 'stun:sophon-dns-canary.invalid:${udp.address().port}', 'turn:127.0.0.1:${tcp.address().port}?transport=tcp', 'turn:sophon-dns-canary.invalid:${tcp.address().port}?transport=tcp']) {
        try { const p=new RTCPeerConnection({iceServers:[{urls:url,username:'canary',credential:'synthetic'}]});canaryPeers.push(p);p.createDataChannel('canary');p.createOffer().then(o=>p.setLocalDescription(o)).catch(()=>{}); } catch {}
      }
      for(const rel of ['dns-prefetch','preconnect']) {const l=document.createElement('link');l.rel=rel;l.href='http://sophon-dns-canary.invalid:${tcp.address().port}/';document.head.append(l)}
      const l=document.createElement('link');l.rel='preconnect';l.href='http://127.0.0.1:${tcp.address().port}/';document.head.append(l);
    })()`)
    await delay(2000)
    assert.equal(tcpHits, 0, 'No direct TCP/preconnect/TURN connection')
    assert.equal(udpHits, 0, 'No STUN packet')
    await frame.executeJavaScript('canaryPeers.forEach(p=>p.close())')
  } finally {
    await session.defaultSession.netLog.stopLogging()
    await new Promise((resolve) => tcp.close(resolve))
    await new Promise((resolve) => udp.close(resolve))
  }
  const log = JSON.parse(fs.readFileSync(logPath, 'utf8'))
  const types = Object.fromEntries(
    Object.entries(log.constants.logEventTypes).map(([key, value]) => [value, key])
  )
  assert(
    !log.events.some((event) => /(?:^|_)M?DNS_TRANSACTION(?:_|$)/.test(types[event.type])),
    'Chromium must not perform actual DNS transactions'
  )
  console.log(
    'PASS real WebRTC STUN/TURN, DNS-prefetch and preconnect canaries: zero UDP/TCP hits and no DNS transaction in Chromium NetLog'
  )
  await evaluate(
    `document.getElementById('security-fixture').remove();window.api.visuals.release(${JSON.stringify(visual.id)})`
  )
  console.log(
    'PASS unowned renderer denied privileged APIs; generated visual has no bridge and no network'
  )

  const isolatedImage = await evaluate('window.api.attachments.pick()')
  assert.equal(isolatedImage[0].mimeType, 'image/png')
  const diagram = await evaluate("window.api.visuals.diagram('flowchart LR; A-->B')")
  await evaluate(`window.api.visuals.release(${JSON.stringify(diagram.id)})`)
  console.log('PASS disposable Windows-limited image and Mermaid parsers')
  const status = await evaluate('window.api.llmStatus()')
  if (status.online) {
    await evaluate(`window.api.send('Reply with just the number: what is 2 + 2?')`)
    const session = await evaluate('window.api.getSession()')
    assert.equal(session.busy, false)
    assert.equal(session.items.at(-1).actions.length, 0)
    assert(!session.items.at(-1).text.startsWith('Error:'), session.items.at(-1).text)
    console.log(
      'PASS real local model answer with no actions: ' + session.items.at(-1).text.slice(0, 200)
    )
  } else
    console.log(
      'SKIP live inference: configured loopback model is offline; no model settings were changed'
    )
  await evaluate('window.api.chats.create()')
  const desktop = await evaluate('window.api.getSession()')
  assert.equal(desktop.mode, 'assistant')
  assert.equal(desktop.items.length, 0)
  await evaluate('window.api.updateSettings({research:{enabled:false}})')
  assert.equal(await evaluate(`typeof window.api.setMode`), 'undefined')
  assert.equal(await evaluate('window.api.research.hasKey()'), false)
  await evaluate(`window.api.research.setKey('SYNTHETIC_TEST_KEY_1234')`)
  assert.equal(await evaluate('window.api.research.hasKey()'), true)
  assert(
    !fs
      .readFileSync(path.join(profile, 'search-key.enc'))
      .includes(Buffer.from('SYNTHETIC_TEST_KEY_1234'))
  )
  await evaluate(`window.api.research.setKey('')`)
  assert(!fs.existsSync(path.join(profile, 'search-key.enc')))
  console.log('PASS fresh unified chat and real OS-encrypted credential save/delete')

  // Exercise the actual settings button through preload/IPC and the real filesystem.
  await evaluate(`window.api.updateSettings({profile:{onboardingComplete:true}})`)
  const clickText = (label) =>
    evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)});
      button.click();
    })()`)
  await clickText('Settings')
  await wait(() => evaluate('Boolean(document.querySelector("[role=tab]"))'), 'settings tabs')
  await clickText('General')
  await clickText('Privacy')
  await wait(
    () => evaluate('document.body.innerText.includes("Delete diagnostics")'),
    'privacy actions'
  )
  const diagnosticsDirectory = path.join(profile, 'security-events')
  fs.mkdirSync(diagnosticsDirectory, { recursive: true })
  const diagnosticFile = path.join(diagnosticsDirectory, '2026-01-01.jsonl')
  fs.writeFileSync(diagnosticFile, 'synthetic diagnostic')
  await clickText('Delete diagnostics')
  await wait(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Deleting…" && b.disabled)'
      ),
    'diagnostics pending state'
  )
  await wait(
    () => evaluate('document.body.innerText.includes("Security diagnostics deleted.")'),
    'deletion confirmation'
  )
  assert(!fs.existsSync(diagnosticFile))
  await clickText('Delete diagnostics')
  await wait(
    () => evaluate('document.body.innerText.includes("No security diagnostics to delete.")'),
    'empty diagnostics feedback'
  )
  rejectDiagnostics = true
  await clickText('Delete diagnostics')
  await wait(
    () =>
      evaluate(
        'Boolean(Array.from(document.querySelectorAll("[role=alert]")).find(e => e.textContent.includes("Diagnostics are locked")))'
      ),
    'deletion error feedback'
  )
  rejectDiagnostics = false
  fs.writeFileSync(diagnosticFile, 'synthetic retry diagnostic')
  await clickText('Delete diagnostics')
  await wait(
    () => evaluate('document.body.innerText.includes("Security diagnostics deleted.")'),
    'deletion retry'
  )
  assert(!fs.existsSync(diagnosticFile))
  assert.equal(diagnosticsCalls, 4)
  console.log(
    'PASS diagnostics button: pending, actual deletion, empty history, inline error and retry'
  )
  assert.deepEqual(errors, [])
  console.log('PASS built Electron security integration; isolated profile: ' + profile)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
