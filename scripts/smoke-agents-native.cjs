// Native check for parallel-agent desktop pieces, with no model and no input: the GDI window
// sampler reads real pixels, an agent's cursor overlay really draws, and neither the sampler
// (used to settle after input) nor Electron screen capture (used for screenshots) sees it.
// Opens one owned fixture window for a few seconds; never moves the real pointer.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { load } = require('./security/load.cjs')

// The fixture is a flat colour; the cursor is drawn in a colour far from it.
const FIXTURE = [30, 200, 60]
const CURSOR = '#f9160e'
const CURSOR_RGB = [249, 22, 14]

function countNear(bgra, rgb, tolerance = 40) {
  let hits = 0
  for (let i = 0; i < bgra.length; i += 4)
    if (
      Math.abs(bgra[i + 2] - rgb[0]) < tolerance &&
      Math.abs(bgra[i + 1] - rgb[1]) < tolerance &&
      Math.abs(bgra[i] - rgb[2]) < tolerance
    )
      hits++
  return hits
}

async function main() {
  await app.whenReady()
  const win32 = load('src/main/tools/win32.ts', { koffi: require('koffi') })
  const display = screen.getPrimaryDisplay()
  const fixture = new BrowserWindow({
    x: display.workArea.x + 80,
    y: display.workArea.y + 80,
    width: 420,
    height: 300,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: `rgb(${FIXTURE.join(',')})`
  })
  await fixture.loadURL(
    `data:text/html,<body style="margin:0;background:rgb(${FIXTURE.join(',')})"></body>`
  )
  fixture.showInactive()
  await delay(500)
  // Physical pixels of the fixture's inner area, as the sampler and Win32 use them.
  const dip = fixture.getContentBounds()
  const rect = screen.dipToScreenRect(fixture, {
    x: dip.x + 20,
    y: dip.y + 20,
    width: dip.width - 40,
    height: dip.height - 40
  })
  const before = win32.screenSample(rect, 160)
  assert(before, 'GDI sampling works on this machine')
  const pixels = before.length / 4
  assert.equal(pixels, 160 * Math.max(1, Math.round((160 * rect.height) / rect.width)))
  assert(countNear(before, FIXTURE) > pixels * 0.9, 'The sample shows the fixture window')

  const settings = { agents: { cursors: true }, motion: 'reduced' }
  const cursors = load('src/main/desktop/cursors.ts', {
    electron: require('electron'),
    '../settings': { getSettings: () => settings, onSettingsChange: () => () => {} },
    '../services/fullscreen': { fullscreenApp: () => null },
    '../security/run-manager': { onRunFinished: () => () => {} }
  })
  const run = { id: 'native', agent: { chatId: 'native', title: 'Native check', color: CURSOR } }
  const centre = { x: rect.x + Math.round(rect.width / 2), y: rect.y + Math.round(rect.height / 2) }
  cursors.cursorMove(run, centre)
  const overlay = await (async () => {
    for (let i = 0; i < 100; i++) {
      const found = BrowserWindow.getAllWindows().find(
        (win) => win.getTitle() === 'Sophon agent cursors' && win.isVisible()
      )
      if (found) return found
      await delay(50)
    }
    throw new Error('The cursor overlay never appeared')
  })()
  await delay(400)
  assert.equal(overlay.isContentProtected(), true)
  // The overlay itself draws the cursor where the agent acts.
  const drawn = (await overlay.webContents.capturePage()).toBitmap()
  assert(countNear(drawn, CURSOR_RGB, 30) > 20, "The overlay draws the agent's cursor")

  // Neither the settle sampler nor screen capture sees it over the fixture.
  const after = win32.screenSample(rect, 160)
  assert.equal(countNear(after, CURSOR_RGB, 30), 0, 'The settle sampler never sees cursors')
  assert(countNear(after, FIXTURE) > pixels * 0.9)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: display.size
  })
  const shot = sources.find((source) => source.display_id === String(display.id))?.thumbnail
  assert(shot && !shot.isEmpty(), 'Screen capture works on this machine')
  const scale = shot.getSize().width / display.bounds.width
  const crop = shot.crop({
    x: Math.round((dip.x + 20 - display.bounds.x) * scale),
    y: Math.round((dip.y + 20 - display.bounds.y) * scale),
    width: Math.round((dip.width - 40) * scale),
    height: Math.round((dip.height - 40) * scale)
  })
  const captured = crop.toBitmap()
  assert(countNear(captured, FIXTURE) > (captured.length / 4) * 0.9, 'Capture shows the fixture')
  assert.equal(countNear(captured, CURSOR_RGB, 30), 0, 'Screenshots never include cursors')

  // The settle probe before and after: a 320 px monitor thumbnail (cropped to the window)
  // versus a direct sample of the window's rectangle.
  const time = async (fn, runs) => {
    await fn()
    const started = performance.now()
    for (let i = 0; i < runs; i++) await fn()
    return (performance.now() - started) / runs
  }
  const monitorProbe = await time(
    () =>
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: 320,
          height: Math.round((320 * display.size.height) / display.size.width)
        }
      }),
    5
  )
  const windowSample = await time(() => win32.screenSample(rect, 160), 20)
  assert(windowSample < monitorProbe, 'The window sample is faster than the monitor probe')
  console.log(
    `Settle probe: monitor thumbnail ${monitorProbe.toFixed(1)} ms, window sample ${windowSample.toFixed(1)} ms per probe`
  )

  // Screenshots of an uncovered window: the direct copy matches the monitor capture, without
  // the cursor, and is much faster.
  const windowRect = screen.dipToScreenRect(fixture, fixture.getContentBounds())
  const direct = win32.screenPixels(windowRect)
  assert(direct, 'Direct window copies work on this machine')
  assert.equal(direct.width, windowRect.width)
  assert.equal(direct.height, windowRect.height)
  assert(
    direct.bits.every((value, i) => i % 4 !== 3 || value === 255),
    'The copy is opaque'
  )
  assert(countNear(direct.bits, FIXTURE) > (direct.bits.length / 4) * 0.9)
  assert.equal(countNear(direct.bits, CURSOR_RGB, 30), 0, 'Direct copies never include cursors')
  const full = shot.crop({
    x: Math.round((dip.x - display.bounds.x) * scale),
    y: Math.round((dip.y - display.bounds.y) * scale),
    width: Math.round(dip.width * scale),
    height: Math.round(dip.height * scale)
  })
  const monitor = full.resize({ width: direct.width, height: direct.height }).toBitmap()
  let difference = 0
  for (let i = 0; i < monitor.length; i += 4)
    difference +=
      Math.abs(monitor[i] - direct.bits[i]) +
      Math.abs(monitor[i + 1] - direct.bits[i + 1]) +
      Math.abs(monitor[i + 2] - direct.bits[i + 2])
  const meanDifference = difference / (monitor.length / 4) / 3
  assert(meanDifference < 4, `Direct copy matches the monitor capture (mean ${meanDifference})`)
  const image = require('electron').nativeImage.createFromBitmap(direct.bits, {
    width: direct.width,
    height: direct.height
  })
  assert(image.toJPEG(88).length > 0, 'The copy encodes as the screenshot JPEG')
  const fullCapture = await time(
    () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size }),
    3
  )
  const directCopy = await time(() => win32.screenPixels(windowRect), 10)
  console.log(
    `Window screenshot: monitor capture ${fullCapture.toFixed(1)} ms, direct copy ${directCopy.toFixed(1)} ms`
  )

  cursors.cursorRemove(run)
  await delay(1200)
  assert(
    !BrowserWindow.getAllWindows().some(
      (win) => !win.isDestroyed() && win.getTitle() === 'Sophon agent cursors'
    ),
    'The overlay closes when no agent has a cursor'
  )
  fixture.destroy()
  console.log(
    'PASS native agent desktop: GDI window sampling, cursor overlay drawing, overlay excluded from the settle sampler and screen capture, overlay cleanup; pointer untouched'
  )
}
main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
