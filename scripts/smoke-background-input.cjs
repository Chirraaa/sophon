// Background input: which windows and steps go straight to the app as window messages, how
// popups, covering windows and Sophon's overlays are handled, the real-input fallback that
// returns the user's pointer, mixed input batches, and the task's working window. Offline:
// Win32 is simulated.
const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')

let settings = { agents: { input: 'background', pointer: 'instant' } }
let fullscreen = null
const posted = []
const W = { target: 100, cover: 200, popup: 300, overlay: 400, otherWindowSameApp: 500 }
let atPoint = []
let raised = 0
const sim = {
  className: (h) => (h === W.target || h === W.popup ? 'Chrome_WidgetWin_1' : 'Notepad'),
  getProcess: (h) => ({ pid: h === W.overlay ? process.pid : 7 }),
  isClickThrough: (h) => h === W.overlay,
  ownedBy: (h, owner) => h === W.popup && owner === W.target,
  rootWindowAt: () => (atPoint.length > 1 ? atPoint.shift() : atPoint[0]),
  raiseWindow: () => {
    raised++
    return true
  },
  postMouse: (h, message, wParam, x, y) => {
    posted.push({ h, message, wParam, x, y })
    return true
  },
  postChar: (h, code) => {
    posted.push({ h, char: code })
    return true
  },
  postKey: (h, key, up) => {
    posted.push({ h, key, up })
    return true
  }
}
const background = load('src/main/desktop/background-input.ts', {
  '../settings': { getSettings: () => settings },
  '../services/fullscreen': { fullscreenApp: () => fullscreen },
  '../tools/win32': sim
})
const win = (hwnd = W.target, extra = {}) => ({
  hwnd,
  title: 'Stays',
  exe: 'msedge.exe',
  state: 'normal',
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  ...extra
})

async function eligibility() {
  assert.equal(background.backgroundInput(win()), true, 'Chromium windows take background input')
  assert.equal(background.backgroundInput(win(W.cover)), false, 'Other apps use real input')
  assert.equal(background.backgroundInput(win(W.target, { state: 'minimized' })), false)
  fullscreen = { hwnd: W.target }
  assert.equal(background.backgroundInput(win()), false, 'Fullscreen apps and games use real input')
  fullscreen = null
  settings = { agents: { input: 'pointer' } }
  assert.equal(background.backgroundInput(win()), false, 'The Your pointer setting turns it off')
  settings = { agents: { input: 'background', pointer: 'instant' } }

  const step = background.backgroundStep
  assert(step({ action: 'click' }) && step({ action: 'type_text' }) && step({ action: 'scroll' }))
  assert(step({ action: 'press_keys', keys: 'Enter' }) && step({ action: 'wait' }))
  assert(!step({ action: 'click', hold_ms: 500 }), 'Held buttons need the real mouse')
  assert(!step({ action: 'press_keys', keys: 'Ctrl+A' }), 'Shortcuts need the real keyboard')
  assert(!step({ action: 'move_mouse', dx: 5 }), 'Relative movement is real input')
  const action = background.backgroundAction
  assert(action('click', { x: 1, y: 1 }, win()), 'A plain click needs no desktop turn')
  assert(!action('click', { x: 1, y: 1 }, win(W.cover)))
  assert(!action('focus_window', {}, win()))
  assert(action('input_batch', { steps: [{ action: 'click' }, { action: 'type_text' }] }, win()))
  assert(
    !action(
      'input_batch',
      { steps: [{ action: 'click' }, { action: 'press_keys', keys: 'Ctrl+V' }] },
      win()
    ),
    'A batch with any real step takes the desktop turn'
  )
}

async function delivery() {
  atPoint = [W.target]
  assert.equal(await background.backgroundClick(win(), { x: 10, y: 20 }, 'left'), true)
  assert.deepEqual(
    posted.splice(0).map((p) => [p.h, p.message, p.wParam]),
    [
      [W.target, 0x200, 0],
      [W.target, 0x201, 1],
      [W.target, 0x202, 0]
    ],
    'Hover, press and release go to the window'
  )
  assert.equal(raised, 0, 'A visible window is not raised')

  atPoint = [W.popup]
  await background.backgroundClick(win(), { x: 10, y: 20 }, 'right')
  assert.deepEqual(
    posted.splice(0).map((p) => [p.h, p.message]),
    [
      [W.popup, 0x200],
      [W.popup, 0x204],
      [W.popup, 0x205]
    ],
    "A click on the app's own dropdown goes to that popup"
  )

  atPoint = [W.overlay]
  await background.backgroundClick(win(), { x: 10, y: 20 }, 'left')
  assert(
    posted.splice(0).every((p) => p.h === W.target),
    "Sophon's click-through overlay never counts"
  )

  atPoint = [W.otherWindowSameApp, W.target]
  await background.backgroundClick(win(), { x: 10, y: 20 }, 'left')
  assert.equal(raised, 1, 'A covered window is raised (without focus) first')
  assert(
    posted.splice(0).every((p) => p.h === W.target),
    'Another window of the same app is not a popup'
  )

  atPoint = [W.cover]
  assert.equal(
    await background.backgroundClick(win(), { x: 10, y: 20 }, 'left'),
    false,
    'A point that stays covered falls back to real input'
  )
  assert.equal(posted.length, 0)

  atPoint = [W.target]
  await background.backgroundScroll(win(), { x: 30, y: 40 }, -360)
  const wheel = posted.splice(0).at(-1)
  assert.equal(wheel.message, 0x20a)
  assert.equal(wheel.wParam >>> 16, -360 & 0xffff, 'Wheel delta is in the high word')

  await background.backgroundType(win(), 'a\r\nb\nc', () => {})
  assert.deepEqual(
    posted.splice(0).map((p) => p.char),
    [97, 13, 98, 13, 99],
    'Line breaks type Enter once'
  )
  let calls = 0
  await assert.rejects(
    background.backgroundType(win(), 'abc', () => {
      if (++calls === 2) throw new Error('Stopped.')
    }),
    /Stopped/
  )
  posted.length = 0
  await background.backgroundKey(win(), 0x0d)
  assert.deepEqual(posted.splice(0), [
    { h: W.target, key: 0x0d, up: false },
    { h: W.target, key: 0x0d, up: true }
  ])
}

// interact.ts routes clicks, typing, keys and batches through background input, falls back to
// real input (under the desktop turn) when needed, and returns the pointer afterwards.
async function routing() {
  const target = win()
  const log = []
  let backgroundClicks = true
  let pointer = { x: 900, y: 900 }
  let turns = 0
  const run = { id: 'run-1', agent: { chatId: 'agent-1' } }
  const interact = load('src/main/tools/interact.ts', {
    '../permissions': { protectedWindowRule: () => null, blockedAppRule: () => null },
    '../security/run-manager': { currentRun: () => run, assertRun: () => {} },
    '../settings': { getSettings: () => settings },
    '../desktop/cursors': {
      cursorMove: (_run, point) => log.push(['cursor', point.x, point.y]),
      cursorPulse: () => log.push(['pulse']),
      cursorPosition: () => undefined
    },
    '../desktop/arbiter': {
      withInputTurn: async (_run, fn) => {
        turns++
        return fn()
      }
    },
    '../desktop/background-input': {
      backgroundInput: (w) => background.backgroundInput(w),
      backgroundStep: background.backgroundStep,
      backgroundClick: async (_w, point) => {
        log.push(['bg-click', point.x, point.y])
        return backgroundClicks
      },
      backgroundScroll: async () => true,
      backgroundType: async (_w, text) => {
        log.push(['bg-type', text])
        return true
      },
      backgroundKey: async (_w, key) => {
        log.push(['bg-key', key])
        return true
      }
    },
    '../services/fullscreen': { fullscreenApp: () => null },
    './screen': {
      captureCoordinates: (x, y) => ({ x: x + 1000, y: y + 1000, window: target }),
      invalidateScreenCoordinates: () => log.push(['invalidate'])
    },
    './windows': {
      activeWindow: () => target,
      findWindow: () => target,
      listWindows: () => [target]
    },
    './win32': {
      SW_RESTORE: 9,
      bringToFront: () => log.push(['focus']),
      foregroundWindow: () => target.hwnd,
      keyInput: (key, up) => (log.push(['key', key, !!up]), true),
      mouseInput: (flags) => (log.push(['mouse', flags]), true),
      setCursor: (x, y) => {
        pointer = { x, y }
        log.push(['set-cursor', x, y])
        return true
      },
      cursorPos: () => pointer,
      showWindow: () => {}
    }
  })

  assert.match(
    await interact.clickScreen({ x: 5, y: 6 }, undefined, target),
    /^Clicked left at \(5, 6\)/
  )
  assert.deepEqual(
    log.filter(([kind]) => ['bg-click', 'mouse', 'set-cursor', 'focus'].includes(kind)),
    [['bg-click', 1005, 1006]],
    'A background click neither focuses the window nor touches the real pointer'
  )
  assert.equal(turns, 0, 'A background click takes no desktop turn')
  assert(
    log.some(([kind]) => kind === 'pulse'),
    "Sophon's cursor ripples where it clicked"
  )

  log.length = 0
  backgroundClicks = false
  await interact.clickScreen({ x: 5, y: 6 }, undefined, target)
  assert.equal(turns, 1, 'The real-input fallback takes the desktop turn')
  assert(
    log.some(([kind]) => kind === 'focus'),
    'The fallback focuses the window'
  )
  assert.deepEqual(log.filter(([kind]) => kind === 'set-cursor').at(-1), ['set-cursor', 900, 900])
  assert.deepEqual(pointer, { x: 900, y: 900 }, "The user's pointer goes back where it was")
  backgroundClicks = true

  log.length = 0
  turns = 0
  assert.match(
    await interact.typeText({ text: 'Lisbon' }, undefined, target),
    /^Typed 6 characters/
  )
  assert.match(await interact.pressKeys({ keys: 'Enter' }, undefined, target), /^Pressed Enter/)
  assert.deepEqual(
    log.filter(([kind]) => kind.startsWith('bg-') || kind === 'key' || kind === 'focus'),
    [
      ['bg-type', 'Lisbon'],
      ['bg-key', 0x0d]
    ]
  )
  assert.equal(turns, 0)
  log.length = 0
  await interact.pressKeys({ keys: 'Ctrl+A' }, undefined, target)
  assert.equal(turns, 1, 'A shortcut uses the real keyboard under the desktop turn')
  assert(log.some(([kind]) => kind === 'focus'))

  log.length = 0
  turns = 0
  const steps = [
    { action: 'click' },
    { action: 'type_text', text: 'Lisbon' },
    { action: 'click' },
    { action: 'type_text', text: '2 guests' },
    { action: 'press_keys', keys: 'Enter' }
  ]
  const points = [{ x: 1, y: 1 }, null, { x: 2, y: 2 }, null, null]
  assert.match(await interact.runBatch(steps, points, undefined, target), /^Ran 5 input steps/)
  assert.deepEqual(
    log.filter(([kind]) => kind.startsWith('bg-') || kind === 'focus' || kind === 'mouse'),
    [
      ['bg-click', 1, 1],
      ['bg-type', 'Lisbon'],
      ['bg-click', 2, 2],
      ['bg-type', '2 guests'],
      ['bg-key', 0x0d]
    ],
    'A form filled in one batch never focuses the window or moves the pointer'
  )
  assert.equal(turns, 0)

  log.length = 0
  await interact.runBatch(
    [
      { action: 'click' },
      { action: 'press_keys', keys: 'Ctrl+A' },
      { action: 'type_text', text: 'x' }
    ],
    [{ x: 3, y: 3 }, null, null],
    undefined,
    target
  )
  assert.deepEqual(
    log
      .filter(([kind]) => kind.startsWith('bg-') || kind === 'focus')
      .map(([kind]) => kind)
      .filter((kind, i, all) => kind !== all[i - 1]),
    ['bg-click', 'focus', 'bg-type'],
    'Only the shortcut step focuses the window'
  )

  settings = { agents: { input: 'pointer', pointer: 'instant' } }
  log.length = 0
  pointer = { x: 900, y: 900 }
  await interact.clickScreen({ x: 5, y: 6 }, undefined, target)
  assert(
    !log.some(([kind]) => kind === 'bg-click'),
    'The Your pointer setting uses the real pointer'
  )
  assert.deepEqual(pointer, { x: 1005, y: 1006 }, 'and leaves it where it clicked')
  settings = { agents: { input: 'background', pointer: 'instant' } }
}

// Keys, text and captures without a named window go to the window the task last worked in,
// not to whatever app the user has in front.
function workingWindow() {
  let run = { id: 'task' }
  const fixtures = {
    100: { title: 'Airbnb', exe: 'msedge.exe' },
    200: { title: 'My notes', exe: 'notepad.exe' }
  }
  const foreground = 200
  let open = [200, 100]
  const windows = load('src/main/tools/windows.ts', {
    '../permissions': { protectedWindowRule: () => null },
    crypto: require('node:crypto'),
    '../security/run-manager': {
      currentRun: () => run,
      assertRun: () => {},
      onRunFinished: () => () => {}
    },
    './monitors': { monitorsText: () => '', monitorOf: () => ({ index: 1 }) },
    './win32': {
      SW_RESTORE: 9,
      bringToFront: () => true,
      enumTopLevelWindows: () => open,
      foregroundWindow: () => foreground,
      getProcess: (h) => ({ pid: h, exe: fixtures[h].exe }),
      getTitle: (h) => fixtures[h].title,
      getVisibleRect: () => ({ left: 0, top: 0, right: 500, bottom: 400 }),
      isCloaked: () => false,
      isMaximized: () => false,
      isMinimized: () => false,
      isToolWindow: () => false,
      isVisible: () => true,
      requestClose: () => true,
      showWindow: () => true
    },
    './window-move': { moveWindow: () => '', POSITIONS: [] }
  })
  assert.equal(
    windows.activeWindow().title,
    'My notes',
    'A new task starts with the window in front'
  )
  windows.rememberWorkingWindow(windows.listWindows().find((w) => w.hwnd === 100))
  assert.equal(windows.activeWindow().title, 'Airbnb', 'Then it keeps to its own window')
  assert.equal(windows.targetWindow().title, 'Airbnb')
  run = { id: 'other-agent' }
  assert.equal(windows.activeWindow().title, 'My notes', 'Each task has its own working window')
  run = { id: 'task' }
  open = [200]
  assert.equal(windows.activeWindow().title, 'My notes', 'A closed working window is not reused')
}

async function main() {
  await eligibility()
  await delivery()
  await routing()
  workingWindow()
  console.log(
    'PASS background input eligibility, popup/cover/overlay delivery, raise-or-fallback, typing and keys, click/type/batch routing without focus or pointer moves, real fallback with pointer return, and per-task working windows'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
