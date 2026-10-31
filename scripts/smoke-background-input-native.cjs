// Native check of background input: clicks, typing, keys and scrolling sent as window
// messages to a real Edge window while another window is in front of it. Uses a disposable
// Edge profile and its own fixture pages, never the user's browser, and closes what it opened.
// The real pointer is never moved by this route; the check also confirms focus stays with the
// window in front.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { load } = require('./security/load.cjs')

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((file) => fs.existsSync(file))
if (process.platform !== 'win32' || !edge) {
  console.log('SKIP background input: needs Windows with Microsoft Edge')
  process.exit(0)
}

const win32 = load('src/main/tools/win32.ts', { koffi: require('koffi') })
const background = load('src/main/desktop/background-input.ts', {
  '../settings': { getSettings: () => ({ agents: { input: 'background' } }) },
  '../services/fullscreen': { fullscreenApp: () => null },
  '../tools/win32': win32
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophon-bg-input-'))
const fixture = path.join(dir, 'fixture.html')
fs.writeFileSync(
  fixture,
  `<!doctype html><title>Sophon bg fixture ready</title>
<body style="margin:0;font:16px sans-serif">
<button id="b" style="position:absolute;left:40px;top:40px;width:200px;height:60px">Button</button>
<input id="i" style="position:absolute;left:40px;top:140px;width:300px;height:30px">
<div id="s" style="position:absolute;left:40px;top:200px;width:400px;height:200px;overflow:auto">
${Array.from({ length: 80 }, (_, k) => `<p>line ${k}</p>`).join('')}</div>
<script>
const state = { clicks: 0, value: '', enter: 0, scroll: 0, right: 0, dpr: devicePixelRatio, inner: innerHeight }
const show = () => (document.title = 'Sophon bg fixture ' + JSON.stringify(state))
b.onclick = () => { state.clicks++; show() }
b.oncontextmenu = (e) => { e.preventDefault(); state.right++; show() }
i.oninput = () => { state.value = i.value; show() }
i.onkeydown = (e) => { if (e.key === 'Enter') { state.enter++; show() } }
s.onscroll = () => { state.scroll = s.scrollTop; show() }
show()
</script>`
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const children = []
function open(page, x, y, w, h) {
  const child = spawn(
    edge,
    [
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--window-position=${x},${y}`,
      `--window-size=${w},${h}`,
      `--app=file:///${page.replace(/\\/g, '/')}`
    ],
    { detached: false, stdio: 'ignore' }
  )
  children.push(child)
}
function find(prefix) {
  for (const hwnd of win32.enumTopLevelWindows())
    if (win32.isVisible(hwnd) && win32.getTitle(hwnd).startsWith(prefix)) return hwnd
  return 0
}
async function waitFor(check, label, ms = 15000) {
  const end = Date.now() + ms
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await sleep(100)
  }
}
const state = (hwnd) => {
  const title = win32.getTitle(hwnd)
  return title.includes('{') ? JSON.parse(title.slice(title.indexOf('{'))) : {}
}
function info(hwnd) {
  const r = win32.getVisibleRect(hwnd)
  return {
    hwnd,
    title: win32.getTitle(hwnd),
    exe: 'msedge.exe',
    state: 'normal',
    x: r.left,
    y: r.top,
    width: r.right - r.left,
    height: r.bottom - r.top
  }
}

async function main() {
  open(fixture, 60, 60, 700, 600)
  const target = await waitFor(() => find('Sophon bg fixture {'), 'fixture window')
  await sleep(1500)
  // The window in front belongs to another process, as when the user works in another app.
  const coverTitle = `Sophon bg cover ${path.basename(dir)}`
  children.push(
    spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.Text = '${coverTitle}'; $f.StartPosition = 'Manual'; $f.Left = 20; $f.Top = 20; $f.Width = 1000; $f.Height = 800; [Windows.Forms.Application]::Run($f)`
      ],
      { stdio: 'ignore' }
    )
  )
  const front = await waitFor(() => find(coverTitle), 'cover window')
  await sleep(1000)
  win32.bringToFront(front)
  await sleep(300)
  assert.equal(win32.foregroundWindow(), front, 'The cover window starts in front')
  const win = info(target)
  assert.equal(background.backgroundInput(win), true, 'Edge takes background input')
  const pointer = win32.cursorPos()

  // Page content sits below Edge's app title bar, in CSS pixels scaled by the display.
  const { dpr, inner } = state(target)
  const contentTop = Math.round(win.height - inner * dpr)
  const at = (x, y) => ({
    x: Math.round(win.x + x * dpr),
    y: Math.round(win.y + contentTop + y * dpr)
  })

  assert(await background.backgroundClick(win, at(140, 70), 'left'))
  await waitFor(() => state(target).clicks === 1, 'a background click')
  assert.equal(
    win32.foregroundWindow(),
    front,
    `A background click does not take focus (in front: "${win32.getTitle(win32.foregroundWindow())}")`
  )

  assert(await background.backgroundClick(win, at(140, 70), 'right'))
  await waitFor(() => state(target).right === 1, 'a background right click')

  assert(await background.backgroundClick(win, at(190, 155), 'left'))
  await sleep(200)
  assert(await background.backgroundType(win, 'Hello Sophon', () => {}))
  await waitFor(() => state(target).value === 'Hello Sophon', 'background typing')
  assert(await background.backgroundKey(win, 0x08))
  await waitFor(() => state(target).value === 'Hello Sopho', 'a background Backspace')
  assert(await background.backgroundKey(win, 0x0d))
  await waitFor(() => state(target).enter === 1, 'a background Enter')

  assert(await background.backgroundScroll(win, at(240, 300), -360))
  await waitFor(() => state(target).scroll > 0, 'a background scroll')
  assert.equal(win32.foregroundWindow(), front, 'Focus stayed with the window in front')

  // The full tool path: a form filled by one input_batch through interact.ts.
  win32.bringToFront(front)
  await sleep(300)
  let turns = 0
  const run = { id: 'native-batch' }
  const interact = load('src/main/tools/interact.ts', {
    '../permissions': { protectedWindowRule: () => null, blockedAppRule: () => null },
    '../security/run-manager': { currentRun: () => run, assertRun: () => {} },
    '../settings': { getSettings: () => ({ agents: { input: 'background', pointer: 'fast' } }) },
    '../desktop/cursors': {
      cursorMove: () => {},
      cursorPulse: () => {},
      cursorPosition: () => undefined
    },
    '../desktop/arbiter': {
      withInputTurn: async (_run, fn) => {
        turns++
        return fn()
      }
    },
    '../desktop/background-input': background,
    '../services/fullscreen': { fullscreenApp: () => null },
    './screen': { captureCoordinates: () => null, invalidateScreenCoordinates: () => {} },
    './windows': {
      activeWindow: () => info(target),
      findWindow: () => info(target),
      listWindows: () => [info(target)]
    },
    './win32': win32
  })
  const batch = await interact.runBatch(
    [
      { action: 'click' },
      { action: 'type_text', text: ' via batch' },
      { action: 'press_keys', keys: 'Enter' }
    ],
    [at(190, 155), null, null],
    undefined,
    info(target)
  )
  assert.match(batch, /^Ran 3 input steps/)
  await waitFor(() => state(target).value === 'Hello Sopho via batch', 'batch typing')
  await waitFor(() => state(target).enter === 2, 'batch Enter')
  assert.equal(turns, 0, 'A background batch never waited for the shared pointer and keyboard')
  assert.equal(win32.foregroundWindow(), front, 'The batch left focus with the window in front')

  const after = win32.cursorPos()
  console.log(
    `PASS background click, right click, typing, Backspace, Enter, scrolling and a form-filling input_batch in a covered Edge window without taking focus${
      pointer && after && pointer.x === after.x && pointer.y === after.y
        ? '; the real pointer did not move'
        : ' (the pointer moved during the test, likely by hand)'
    }`
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(dir)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
        ],
        { stdio: 'ignore' }
      )
    } catch {
      /* already closed */
    }
    for (const child of children) child.kill()
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1000)
  })
