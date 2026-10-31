import { protectedWindowRule, blockedAppRule } from '../permissions'
import { currentRun, assertRun } from '../security/run-manager'
import { getSettings } from '../settings'
import { cursorMove, cursorPosition, cursorPulse } from '../desktop/cursors'
import { withInputTurn } from '../desktop/arbiter'
import {
  backgroundClick,
  backgroundInput,
  backgroundKey,
  backgroundScroll,
  backgroundStep,
  backgroundType
} from '../desktop/background-input'
import { fullscreenApp } from '../services/fullscreen'
import { glideCurve, glideDuration, glidePoint } from '../../shared/pointer-path'
const checkRun = (): void => {
  const run = currentRun()
  if (run) assertRun(run)
}
import { captureCoordinates, invalidateScreenCoordinates } from './screen'
import { activeWindow, findWindow, listWindows, type WinInfo } from './windows'
import {
  SW_RESTORE,
  bringToFront,
  cursorPos,
  foregroundWindow,
  keyInput,
  mouseInput,
  setCursor,
  showWindow
} from './win32'
const TAP_MS = 60
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
// The window an action targets, without focusing it, or why it may not be used.
function target(title?: string, fallback?: WinInfo | null): WinInfo | string {
  const win = title ? findWindow(title) : (fallback ?? activeWindow())
  if (!win) return `No window matching "${title ?? 'active window'}".`
  const rule = protectedWindowRule(win.title, win.exe)
  if (rule) return `Blocked: "${win.title}" is protected by your rule "${rule}".`
  if (blockedAppRule(win.exe)) return `Blocked: "${win.exe}" is in your blocked apps.`
  return win
}
async function focus(
  title?: string,
  fallback?: WinInfo | null,
  guard?: () => void
): Promise<WinInfo | string> {
  guard?.()
  const win = target(title, fallback)
  if (typeof win === 'string') return win
  if (win.state === 'minimized') showWindow(win.hwnd, SW_RESTORE)
  bringToFront(win.hwnd)
  await sleep(90)
  checkRun()
  guard?.()
  if (foregroundWindow() !== win.hwnd)
    return `Could not focus "${win.title}". Select it and try again.`
  return win
}
export async function focusWindow(
  title?: string,
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  const win = await focus(bound ? undefined : title, bound, guard)
  return typeof win === 'string' ? win : `Focused "${win.title}".`
}
export async function clickScreen(
  args: {
    x?: number
    y?: number
    button?: string
    hold_ms?: number
  },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  guard?.()
  const { x, y, button = 'left', hold_ms } = args
  const invalidHold = holdError(hold_ms)
  if (invalidHold) return invalidHold
  if (typeof x !== 'number' || typeof y !== 'number')
    return 'Provide x and y from a captured image.'
  const point = captureCoordinates(x, y)
  if (!point) return 'Capture the screen first, then choose coordinates inside that image.'
  const underPointer =
    point.window ??
    listWindows().find(
      (w) =>
        w.state !== 'minimized' &&
        point.x >= w.x &&
        point.x < w.x + w.width &&
        point.y >= w.y &&
        point.y < w.y + w.height
    )
  if (!underPointer) return 'No app window at that location.'
  if (bound && underPointer.hwnd !== bound.hwnd) return 'Denied: screenshot target changed.'
  const done = (title: string): string =>
    `Clicked ${button} at (${Math.round(x)}, ${Math.round(y)}) in "${title}"${hold_ms ? ` (held ${hold_ms} ms)` : ''}.`
  const chosen = bound ?? underPointer
  if (!hold_ms && (button === 'left' || button === 'right') && backgroundInput(chosen)) {
    const win = target(undefined, chosen)
    if (typeof win === 'string') return win
    if (await sendClick(win, point, button, guard)) return done(win.title)
  }
  return withInputTurn(currentRun(), async () => {
    const win = await focus(undefined, chosen, guard)
    if (typeof win === 'string') return win
    const fresh = captureCoordinates(x, y)
    if (!fresh || fresh.x !== point.x || fresh.y !== point.y)
      return 'Denied: capture the moved window again.'
    const home = pointerHome(win)
    try {
      return (await pointerClick(point, button, hold_ms, guard)) ?? done(win.title)
    } finally {
      home()
    }
  })
}
const holdError = (hold: number | undefined): string | null =>
  hold !== undefined && (!Number.isInteger(hold) || hold < 50 || hold > 5000)
    ? 'Invalid hold_ms: use a whole number from 50 to 5000.'
    : null
// Glides only Sophon's cursor to a point and waits for it to arrive; the real pointer stays.
async function overlayGlide(point: { x: number; y: number }, guard?: () => void): Promise<void> {
  const run = currentRun()
  if (!run) return
  const from = cursorPosition(run) ?? point
  const duration = glideDuration(from, point, getSettings().agents?.pointer ?? 'natural')
  cursorMove(run, point, { duration, curve: glideCurve(from, point) })
  for (const end = performance.now() + duration; performance.now() < end;) {
    await sleep(Math.max(1, Math.min(40, end - performance.now())))
    checkRun()
    guard?.()
  }
}
// A click sent straight to the window (background input): Sophon's cursor glides there and
// ripples, and the real pointer never moves. False when it could not be delivered that way.
async function sendClick(
  win: WinInfo,
  point: { x: number; y: number },
  button: 'left' | 'right',
  guard?: () => void
): Promise<boolean> {
  await overlayGlide(point, guard)
  if (!(await backgroundClick(win, point, button))) return false
  const run = currentRun()
  if (run) cursorPulse(run)
  invalidateScreenCoordinates()
  return true
}
// When agents keep the user's mouse free but an app needs the real pointer, the pointer
// goes back to where the user left it once the input is done. Fullscreen apps and games
// keep it where it is, and so does the 'Your pointer' setting.
function pointerHome(win: WinInfo): () => void {
  if (getSettings().agents?.input === 'pointer' || fullscreenApp()?.hwnd === win.hwnd)
    return () => {}
  const home = cursorPos()
  return () => {
    if (home) setCursor(home.x, home.y)
  }
}
// Moves the real pointer to a screen point the way a hand would: a short eased glide on a
// slight curve, at the speed chosen in Settings > Agents ('instant' jumps as before). The
// agent's own cursor travels the same path. Stop and window changes interrupt it.
async function glideTo(point: { x: number; y: number }, guard?: () => void): Promise<boolean> {
  const run = currentRun()
  const from = cursorPos() ?? point
  const duration = glideDuration(from, point, getSettings().agents?.pointer ?? 'natural')
  const curve = glideCurve(from, point)
  if (run) cursorMove(run, point, { duration, curve })
  if (duration > 0) {
    const started = performance.now()
    for (let t = 0; t < 1;) {
      await sleep(8)
      checkRun()
      guard?.()
      t = Math.min(1, (performance.now() - started) / duration)
      const step = glidePoint(from, point, curve, t)
      if (!setCursor(Math.round(step.x), Math.round(step.y))) return false
    }
  }
  return setCursor(point.x, point.y)
}
// Moves the pointer and clicks; returns a failure message, or null on success.
async function pointerClick(
  point: { x: number; y: number },
  button: string,
  hold?: number,
  guard?: () => void
): Promise<string | null> {
  const flags = button === 'right' ? [0x0008, 0x0010] : button === 'left' ? [0x0002, 0x0004] : null
  if (!flags) return 'Button must be left or right.'
  if (!(await glideTo(point, guard))) return 'Windows could not move the pointer.'
  invalidateScreenCoordinates()
  const refused = 'Windows refused the click (the app may be running as administrator).'
  const run = currentRun()
  if (run) cursorPulse(run)
  if (!mouseInput(flags[0])) return refused
  // Mining or attacking in a game needs the button down for the whole span. The button is
  // always released, even if the wait is interrupted.
  let released: boolean
  try {
    if (hold) await sleep(hold)
  } finally {
    released = mouseInput(flags[1])
  }
  return released ? null : refused
}
export type BatchStep = {
  action?: string
  button?: string
  keys?: string
  hold_ms?: number
  text?: string
  direction?: string
  amount?: number
  dx?: number
  dy?: number
  duration_ms?: number
  ms?: number
}
// Waits in short slices so Stop and a window change still interrupt a long pause. `focused`
// is the window that must stay in front (none while the batch uses background input).
async function pause(
  ms: number,
  focused: WinInfo | null,
  guard?: () => void
): Promise<string | null> {
  const end = Date.now() + ms
  for (let left = ms; left > 0; left = end - Date.now()) {
    await sleep(Math.min(left, 100))
    checkRun()
    guard?.()
    if (focused && foregroundWindow() !== focused.hwnd) return 'focus changed.'
  }
  return null
}
class FocusError extends Error {}
// Runs steps decided from one screenshot, in order, in a single window. Click
// points were resolved against that screenshot when the batch was approved, so
// the clicks that would otherwise invalidate it stay usable. The first failing
// step stops the batch, because later steps assumed its effect. In a window that takes
// background input, steps that can go straight to the window do; the window is focused
// (and the real pointer used) only for a step that needs it.
export async function runBatch(
  steps: BatchStep[],
  points: ({ x: number; y: number } | null)[],
  guard: (() => void) | undefined,
  bound: WinInfo
): Promise<string> {
  const win = target(undefined, bound)
  if (typeof win === 'string') return win
  const background = backgroundInput(win)
  const run = currentRun()
  let focused: WinInfo | null = null
  let home: (() => void) | null = null
  const ensureFocus = async (): Promise<WinInfo> => {
    if (focused) return focused
    const result = await focus(undefined, win, guard)
    if (typeof result === 'string') throw new FocusError(result)
    focused = result
    home = pointerHome(result)
    return result
  }
  try {
    if (!background) await ensureFocus()
    for (const [i, step] of steps.entries()) {
      checkRun()
      guard?.()
      const failure =
        background && backgroundStep(step)
          ? await backgroundBatchStep(step, points[i], win, guard, () =>
              withInputTurn(run, async () => {
                await ensureFocus()
                return pointerClick(points[i]!, step.button ?? 'left', undefined, guard)
              })
            )
          : await withInputTurn(run, async () => {
              const front = await ensureFocus()
              return foregroundWindow() !== front.hwnd
                ? 'focus changed.'
                : realBatchStep(step, points[i], front, guard)
            })
      if (failure)
        return `Unverified: stopped at step ${i + 1} of ${steps.length} (${step.action}): ${failure} Steps 1-${i} ran.`
      // Give the app a moment to apply this step before the next lands.
      if (step.action !== 'wait') await sleep(step.action === 'click' ? 120 : 60)
    }
  } catch (error) {
    if (error instanceof FocusError) return error.message
    throw error
  } finally {
    ;(home as (() => void) | null)?.()
  }
  return `Ran ${steps.length} input steps in "${win.title}".`
}
// One batch step sent straight to the window; a click that cannot be delivered that way
// falls back to the real pointer.
async function backgroundBatchStep(
  step: BatchStep,
  point: { x: number; y: number } | null,
  win: WinInfo,
  guard: (() => void) | undefined,
  realClick: () => Promise<string | null>
): Promise<string | null> {
  if (step.action === 'wait') return pause(Number(step.ms), null, guard)
  if (step.action === 'click') {
    if (!point) return 'no resolved click point.'
    return (await sendClick(win, point, step.button === 'right' ? 'right' : 'left', guard))
      ? null
      : realClick()
  }
  if (step.action === 'scroll') {
    const result = await scrollWindow({ direction: step.direction, steps: step.amount }, guard, win)
    return /^Scrolled /.test(result) ? null : result
  }
  const result =
    step.action === 'press_keys'
      ? await pressKeys({ keys: step.keys }, guard, win)
      : await typeText({ text: step.text }, guard, win)
  return /^(Pressed|Typed) /.test(result) ? null : result
}
// One batch step with real input in the focused window.
async function realBatchStep(
  step: BatchStep,
  point: { x: number; y: number } | null,
  win: WinInfo,
  guard: (() => void) | undefined
): Promise<string | null> {
  if (step.action === 'click')
    return (
      holdError(step.hold_ms) ??
      (point
        ? await pointerClick(point, step.button ?? 'left', step.hold_ms, guard)
        : 'no resolved click point.')
    )
  if (step.action === 'wait') return pause(Number(step.ms), win, guard)
  const result =
    step.action === 'press_keys'
      ? await pressKeys({ keys: step.keys, hold_ms: step.hold_ms }, guard, win)
      : step.action === 'type_text'
        ? await typeText({ text: step.text }, guard, win)
        : step.action === 'move_mouse'
          ? await moveMouse({ dx: step.dx, dy: step.dy, duration_ms: step.duration_ms }, guard, win)
          : await scrollWindow({ direction: step.direction, steps: step.amount }, guard, win)
  return /^(Pressed|Typed|Scrolled|Moved) /.test(result) ? null : result
}
export async function scrollWindow(
  args: {
    direction?: string
    steps?: number
    window?: string
  },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  const steps = args.steps ?? 3
  if (!Number.isInteger(steps) || steps < 1 || steps > 8) return 'Steps must be from 1 to 8.'
  if (args.direction !== 'up' && args.direction !== 'down') return 'Direction must be up or down.'
  const delta = (args.direction === 'up' ? 1 : -1) * steps * 120
  const named = target(bound ? undefined : args.window, bound)
  if (typeof named === 'string') return named
  const centre = (w: WinInfo): { x: number; y: number } => ({
    x: Math.round(w.x + w.width / 2),
    y: Math.round(w.y + w.height / 2)
  })
  const done = (w: WinInfo): string => `Scrolled ${args.direction} ${steps} steps in "${w.title}".`
  if (backgroundInput(named)) {
    guard?.()
    await overlayGlide(centre(named), guard)
    if (await backgroundScroll(named, centre(named), delta)) {
      invalidateScreenCoordinates()
      return done(named)
    }
  }
  return withInputTurn(currentRun(), async () => {
    const win = await focus(undefined, named, guard)
    if (typeof win === 'string') return win
    const home = pointerHome(win)
    try {
      if (!(await glideTo(centre(win), guard))) return 'Windows could not move the pointer.'
      invalidateScreenCoordinates()
      return mouseInput(0x0800, delta) ? done(win) : 'Windows refused the scroll.'
    } finally {
      home()
    }
  })
}
const MOVE_MAX = 5000
const MOVE_FRAME_MS = 8
// Relative movement, so it also turns a game camera, which locks the pointer and reads deltas.
// The distance is eased over the duration in small steps; rounding is carried between steps so
// the total lands exactly on (dx, dy). Always real input.
export async function moveMouse(
  args: { dx?: number; dy?: number; duration_ms?: number; window?: string },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  const { dx = 0, dy = 0, duration_ms: duration = 300 } = args
  if (![dx, dy].every((n) => Number.isInteger(n) && Math.abs(n) <= MOVE_MAX) || (!dx && !dy))
    return `Invalid movement: give dx and/or dy as whole pixels, at most ${MOVE_MAX} each.`
  if (!Number.isInteger(duration) || duration < 0 || duration > 5000)
    return 'Invalid duration_ms: use a whole number from 0 to 5000.'
  return withInputTurn(currentRun(), async () => {
    const win = await focus(bound ? undefined : args.window, bound, guard)
    if (typeof win === 'string') return win
    invalidateScreenCoordinates()
    const frames = Math.max(1, Math.round(duration / MOVE_FRAME_MS))
    let sentX = 0
    let sentY = 0
    for (let i = 1; i <= frames; i++) {
      checkRun()
      guard?.()
      if (foregroundWindow() !== win.hwnd) return 'Windows stopped the movement: focus changed.'
      const t = i / frames
      const eased = t * t * (3 - 2 * t)
      const x = Math.round(dx * eased)
      const y = Math.round(dy * eased)
      if ((x !== sentX || y !== sentY) && !mouseInput(0x0001, 0, x - sentX, y - sentY))
        return 'Windows refused the mouse movement (the app may be running as administrator).'
      sentX = x
      sentY = y
      if (i < frames) await sleep(MOVE_FRAME_MS)
    }
    return `Moved the mouse ${dx} px right and ${dy} px down over ${duration} ms in "${win.title}".`
  })
}
const VK: Record<string, number> = {
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  escape: 0x1b,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2e,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  plus: 0xbb,
  minus: 0xbd,
  '=': 0xbb,
  '-': 0xbd
}
const MOD: Record<string, number> = { ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12 }
function keyCode(value: string): number | null {
  const key = value.toLowerCase()
  if (VK[key] !== undefined) return VK[key]
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0)
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return 0x70 + Number(key.slice(1)) - 1
  return null
}
export async function pressKeys(
  args: { keys?: string; window?: string; hold_ms?: number },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  const parts = String(args.keys ?? '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  const key = keyCode(parts[parts.length - 1] ?? '')
  const mods = parts.slice(0, -1).map((p) => MOD[p.toLowerCase()])
  if (
    !key ||
    mods.some((m) => m === undefined) ||
    new Set(mods).size !== mods.length ||
    parts.length > 4
  ) {
    return 'Use a key or a shortcut such as PageDown, Ctrl+Tab or Ctrl+Plus.'
  }
  const hold = args.hold_ms
  if (hold !== undefined && (!Number.isInteger(hold) || hold < 50 || hold > 5000))
    return 'Invalid hold_ms: use a whole number from 50 to 5000.'
  const named = target(bound ? undefined : args.window, bound)
  if (typeof named === 'string') return named
  // A single key goes straight to the window; shortcuts with modifiers need the real
  // keyboard, because apps read modifier state from it.
  if (!mods.length && hold === undefined && backgroundInput(named)) {
    guard?.()
    typingCursor(named)
    if (await backgroundKey(named, key)) {
      invalidateScreenCoordinates()
      return `Pressed ${parts.join('+')} in "${named.title}".`
    }
  }
  return withInputTurn(currentRun(), async () => {
    const win = await focus(undefined, named, guard)
    if (typeof win === 'string') return win
    typingCursor(win)
    const held: number[] = []
    invalidateScreenCoordinates()
    try {
      for (const mod of mods) {
        if (!keyInput(mod)) return 'Windows refused the shortcut.'
        held.push(mod)
        await sleep(20)
      }
      if (!keyInput(key)) return 'Windows refused the shortcut.'
      // Held keys (camera rotation in games) need the key down for the whole span. Games
      // poll key state once per frame, so even a tap must stay down for a few frames. The key
      // is always released, even if the wait is interrupted.
      let released: boolean
      try {
        await sleep(hold ?? TAP_MS)
      } finally {
        released = keyInput(key, true)
      }
      if (!released) return 'Windows refused the shortcut.'
      return `Pressed ${parts.join('+')}${hold ? ` (held ${hold} ms)` : ''} in "${win.title}".`
    } finally {
      for (const mod of held.reverse()) keyInput(mod, true)
    }
  })
}
// Keyboard input has no pointer position: the agent's cursor shows it typing where it last
// was in this window, or near the window's centre.
function typingCursor(win: WinInfo): void {
  const run = currentRun()
  if (!run) return
  const at = cursorPosition(run)
  const inside =
    at && at.x >= win.x && at.x < win.x + win.width && at.y >= win.y && at.y < win.y + win.height
  cursorMove(
    run,
    inside ? at : { x: Math.round(win.x + win.width / 2), y: Math.round(win.y + win.height / 3) },
    { typing: true }
  )
}
export async function typeText(
  args: { text?: string; window?: string },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  const text = String(args.text ?? '')
  if (!text || text.length > 2000) return 'Provide between 1 and 2000 characters.'
  const named = target(bound ? undefined : args.window, bound)
  if (typeof named === 'string') return named
  const done = (w: WinInfo): string => `Typed ${text.length} characters in "${w.title}".`
  if (backgroundInput(named)) {
    guard?.()
    typingCursor(named)
    invalidateScreenCoordinates()
    return (await backgroundType(named, text, () => {
      checkRun()
      guard?.()
    }))
      ? done(named)
      : 'Windows stopped the typing.'
  }
  return withInputTurn(currentRun(), async () => {
    const win = await focus(undefined, named, guard)
    if (typeof win === 'string') return win
    typingCursor(win)
    invalidateScreenCoordinates()
    for (let i = 0; i < text.length; i++) {
      checkRun()
      if (foregroundWindow() !== win.hwnd) return 'Windows stopped the typing: focus changed.'
      const code = text.charCodeAt(i)
      if (!keyInput(code, false, true) || !keyInput(code, true, true))
        return 'Windows stopped the typing.'

      await sleep(8)
    }
    return done(win)
  })
}
