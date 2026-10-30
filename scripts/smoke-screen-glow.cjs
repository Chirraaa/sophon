const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { load } = require('./security/load.cjs')

const windows = []
const listeners = new Set()
const settings = { screenGlow: { enabled: true, color: '#a78bfa' }, motion: 'full' }
const screen = Object.assign(new EventEmitter(), {
  getAllDisplays: () => [{ id: 7, bounds: { x: -1280, y: 0, width: 1280, height: 800 } }]
})
class Window extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: () => {} })
    windows.push(this)
  }
  setIgnoreMouseEvents(value) {
    this.clickThrough = value
  }
  setAlwaysOnTop(value) {
    this.alwaysOnTop = value
  }
  setContentProtection(value) {
    this.protected = value
  }
  loadURL(url) {
    this.url = decodeURIComponent(url)
    return Promise.resolve()
  }
  showInactive() {
    this.shown = true
  }
  isDestroyed() {
    return !!this.destroyed
  }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}
const glow = load('src/main/services/screen-glow.ts', {
  electron: { BrowserWindow: Window, screen },
  './fullscreen': { fullscreenApp: () => null },
  '../settings': {
    getSettings: () => settings,
    onSettingsChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
})
const controller = new AbortController()
glow.showScreenGlow(7, controller.signal)
const first = windows.at(-1)
assert.equal(first.options.x, -1280, 'Use the observed display, including negative coordinates')
assert.equal(first.options.focusable, false)
assert.equal(first.clickThrough, true)
assert.equal(first.protected, true)
assert.match(first.url, /animation:breathe/)
first.emit('ready-to-show')
assert.equal(first.shown, true)
controller.abort()
assert(first.destroyed)
assert.equal(listeners.size, 0)
assert.equal(screen.listenerCount('display-removed'), 0)

settings.motion = 'system'
glow.showScreenGlow(7, new AbortController().signal)
assert.match(windows.at(-1).url, /@media\(prefers-reduced-motion:reduce\)/)
const pending = windows.at(-1)
glow.hideScreenGlow()
pending.emit('ready-to-show')
assert(!pending.shown, 'A delayed renderer cannot reveal a stopped glow')

settings.motion = 'reduced'
glow.showScreenGlow(7, new AbortController().signal)
assert.doesNotMatch(windows.at(-1).url, /animation:breathe/)
glow.hideScreenGlow()

glow.showScreenGlow(7, new AbortController().signal)
const previous = windows.at(-1)
glow.showScreenGlow(7, new AbortController().signal)
assert(previous.destroyed, 'Repeated observations replace the overlay')
screen.emit('display-metrics-changed')
assert(windows.at(-1).destroyed)

glow.showScreenGlow(7, new AbortController().signal)
for (const fn of [...listeners]) fn()
assert(windows.at(-1).destroyed, 'Settings changes immediately dismiss the effect')
settings.screenGlow.enabled = false
const count = windows.length
glow.showScreenGlow(7, new AbortController().signal)
assert.equal(windows.length, count)
settings.screenGlow.enabled = true
glow.showScreenGlow(99, new AbortController().signal)
glow.showScreenGlow(7, controller.signal)
assert.equal(windows.length, count, 'Unknown displays and cancelled runs create no window')
console.log('Screen glow lifecycle checks passed')
