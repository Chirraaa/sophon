const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/update-ui')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ profile: { onboardingComplete: true } })
)
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
dialog.showMessageBox = async () => {
  throw new Error('Unexpected native dialog')
}
const release = {
  version: '1.1.0',
  title: 'A smoother Sophon',
  url: 'https://github.com/Chirraaa/sophon/releases/tag/v1.1.0',
  notes:
    '## Improvements\n\n- **Faster startup** and smoother conversations.\n- Download updates while you keep working.\n\n### Fixes\n\n| Area | What changed |\n| --- | --- |\n| Voice | More reliable recording |\n| Chat | Better formatting |\n\n> Your preferences and conversations stay with you.\n\n```text\nA fresh start, with everything in place.\n```\n\n![No remote image](https://example.org/tracker.png)\n\n<script>window.UPDATE_XSS = true</script>\n\n[Unsafe link](javascript:alert(1))\n\n' +
    Array.from({ length: 30 }, (_, index) => `- Additional improvement ${index + 1}`).join('\n')
}
let state = {
  currentVersion: '1.0.0',
  status: 'available',
  release,
  installedRelease: null,
  progress: null,
  checkedAt: null,
  error: null
}
let acknowledged = false
const publish = () => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updates:changed', state)
}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => {
  if (channel.startsWith('updates:'))
    return handle(channel, async () => {
      if (channel === 'updates:download') {
        state = {
          ...state,
          status: 'downloading',
          progress: {
            percent: 42,
            transferred: 44_040_192,
            total: 104_857_600,
            bytesPerSecond: 5_242_880
          }
        }
        publish()
      }
      if (channel === 'updates:install') {
        state = {
          ...state,
          currentVersion: release.version,
          status: 'idle',
          release: null,
          installedRelease: release,
          progress: null
        }
        publish()
      }
      if (channel === 'updates:acknowledge') {
        acknowledged = true
        state = { ...state, installedRelease: null }
        publish()
      }
      return state
    })
  return handle(channel, listener)
}
const failures = []
app.on('web-contents-created', (_, contents) => {
  contents.on('render-process-gone', (_, details) => failures.push(details))
  contents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes("Loading the font 'data:"))
      failures.push(details.message)
  })
})
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    if (await check()) return
    await delay(80)
  }
  throw new Error('Timed out: ' + label)
}
async function main() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'app windows')
  const win = BrowserWindow.getAllWindows().find((item) => item.isResizable())
  if (process.argv.includes('--hidden')) {
    for (const window of BrowserWindow.getAllWindows()) window.hide()
  }
  const evaluate = (source) => win.webContents.executeJavaScript(source, true)
  const has = (label) => evaluate(`document.body.innerText.includes(${JSON.stringify(label)})`)
  const click = (label) =>
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`
    )
  const capture = async (name) => {
    await delay(250)
    try {
      fs.writeFileSync(
        path.join(output, `${name}.png`),
        (
          await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG()
      )
    } catch (error) {
      if (!error.message.includes('display surface not available')) throw error
      console.log(
        `Screenshot ${name} unavailable on this display; continuing DOM and layout checks.`
      )
    }
  }
  await wait(() => has('A new version of Sophon is available'), 'available banner')
  await capture('available')
  await click('Download update')
  await wait(
    () =>
      evaluate(
        'document.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow") === "42"'
      ),
    'download progress'
  )
  assert(await has('42.0 MB of 100.0 MB'))
  await capture('downloading')
  state = { ...state, status: 'ready', progress: null }
  publish()
  await wait(() => has('Your update is ready'), 'ready banner')
  await click('Restart & install')
  await wait(() => has('Update installed'), 'post-restart notes')
  assert(
    await evaluate(
      '!!document.querySelector("[role=dialog] h2, [role=dialog] [data-slot=dialog-title]") || !!document.querySelector("[role=dialog]")'
    )
  )
  assert(await evaluate('!!document.querySelector(".release-notes table")'))
  assert(await evaluate('!!document.querySelector(".release-notes strong")'))
  assert(await evaluate('!!document.querySelector(".release-notes pre")'))
  assert(
    await evaluate(
      '!document.querySelector(".release-notes img, .release-notes script, .release-notes a[href^=javascript]") && !window.UPDATE_XSS'
    )
  )
  assert(
    await evaluate(
      'Array.from(document.querySelectorAll("[role=dialog] [data-slot=scroll-area-viewport]")).some(node => node.scrollHeight > node.clientHeight)'
    )
  )
  await capture('installed-notes')
  await click('Let’s go')
  await wait(
    () => (!acknowledged ? false : has('Update installed').then((value) => !value)),
    'notes dismissed'
  )
  assert.deepEqual(failures, [])
  console.log(
    'Update banner, download progress, restart notes, safe Markdown, scroll layout and dismissal passed.'
  )
}
main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
