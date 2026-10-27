const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const crypto = require('node:crypto')
const context = load('src/main/llm/context.ts', {
  './untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto })
})
const screenshot = (url) => ({
  role: 'user',
  content: [
    { type: 'text', text: JSON.stringify({ kind: 'tool-image', trust: 'untrusted-data' }) },
    { type: 'image_url', image_url: { url } }
  ]
})
const attachment = {
  role: 'user',
  content: [{ type: 'image_url', image_url: { url: 'attachment' } }]
}
const first = screenshot('old')
const latest = screenshot('latest')
const messages = [
  attachment,
  first,
  { role: 'tool', content: 'result', tool_call_id: 'id' },
  latest
]
const compact = context.latestScreenObservation(messages)
assert.equal(compact[0], attachment)
assert.match(compact[1].content, /superseded/)
assert.equal(compact[2], messages[2])
assert.equal(compact[3], latest)
assert(Array.isArray(first.content), 'Do not mutate stored observations')
assert(context.estimateMessages(compact) < context.estimateMessages(messages) - 1900)

let run = { id: 'capture-test' }
let win = {
  hwnd: 1,
  title: 'Fixture',
  exe: 'fixture.exe',
  state: 'normal',
  x: -1920,
  y: 100,
  width: 1920,
  height: 1080
}
const display = { id: 1, index: 1, full: { x: -1920, y: 0, width: 1920, height: 1080 } }
let failCapture = false
let transientFailure = false
let sourceCalls = 0
let requested
const crops = []
class Image {
  constructor(width, height) {
    this.width = width
    this.height = height
  }
  getSize() {
    return { width: this.width, height: this.height }
  }
  isEmpty() {
    return false
  }
  resize({ width }) {
    return new Image(width, Math.round((this.height * width) / this.width))
  }
  crop(rect) {
    crops.push(rect)
    return new Image(rect.width, rect.height)
  }
  toJPEG() {
    return Buffer.from('fixture')
  }
}
const capture = load('src/main/tools/screen.ts', {
  electron: {
    BrowserWindow: { getAllWindows: () => [] },
    desktopCapturer: {
      getSources: async (options) => {
        sourceCalls++
        if (transientFailure) {
          transientFailure = false
          return []
        }
        requested = options.thumbnailSize
        return failCapture
          ? []
          : [
              {
                id: 'window:1:0',
                thumbnail: new Image(requested.width, (requested.width * 9) / 16)
              }
            ]
      }
    }
  },
  '../permissions': { protectedWindowRule: () => null },
  '../security/run-manager': { currentRun: () => run, assertRun: () => {} },
  './win32': { getProcess: () => ({ pid: 42 }) },
  '../services/screen-glow': { hideScreenGlow: () => {}, showScreenGlow: () => {} },
  './windows': {
    activeWindow: () => win,
    findWindow: () => win,
    listWindows: () => [win],
    monitorOf: () => display,
    monitors: () => [display],
    resolveMonitor: () => display
  }
})
async function main() {
  transientFailure = true
  let result = await capture.captureScreen({ window: 'Fixture' })
  assert.equal(sourceCalls, 2, 'Retries a transient unavailable thumbnail')
  assert.equal(requested.width, 1280, 'Overview avoids capturing all windows at 2560px')
  assert.match(result.text, /1280×720/)
  assert.deepEqual(capture.captureCoordinates(640, 360), { x: -960, y: 640, window: win })
  assert.equal(capture.captureCoordinates(1280, 0), null)
  result = await capture.captureScreen({
    window: 'Fixture',
    region: { x: 560, y: 600, width: 160, height: 120 }
  })
  assert.equal(requested.width, 2560)
  assert.deepEqual(crops.at(-1), { x: 1120, y: 1200, width: 320, height: 240 })
  assert.match(result.text, /240×180/, 'Crop retains native detail rather than overview detail')
  assert.deepEqual(capture.captureCoordinates(120, 90), { x: -960, y: 1090, window: win })
  win = { ...win, x: win.x + 10 }
  assert.equal(capture.captureCoordinates(120, 90), null, 'Moved window invalidates coordinates')
  result = await capture.captureScreen({
    window: 'Fixture',
    region: { x: 1270, y: 0, width: 20, height: 20 }
  })
  assert.match(result, /Invalid region/)
  assert.equal(capture.captureCoordinates(1, 1), null, 'Failed refresh invalidates old capture')
  await capture.captureScreen({ window: 'Fixture' })
  run = { id: 'different-task' }
  assert.equal(capture.captureCoordinates(1, 1), null)
  failCapture = true
  assert.match(await capture.captureScreen({ window: 'Fixture' }), /Could not capture/)
  const callsBeforeMinimized = sourceCalls
  win = { ...win, state: 'minimized' }
  assert.match(await capture.captureScreen({ window: 'Fixture' }), /minimized/)
  assert.equal(
    sourceCalls,
    callsBeforeMinimized,
    'Minimized windows give recovery guidance without capturing a different target'
  )
  console.log(
    'PASS screen overview/zoom resolution, coordinate mapping, moved-window/task/failed-refresh invalidation, and screenshot context compaction preserving attachments'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
