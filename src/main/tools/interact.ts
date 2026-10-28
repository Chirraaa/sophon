import { protectedWindowRule, blockedAppRule } from '../permissions'
import { currentRun, assertRun } from '../security/run-manager'
const checkRun = (): void => {
  const run = currentRun()
  if (run) assertRun(run)
}
import { captureCoordinates, invalidateScreenCoordinates } from './screen'
import { activeWindow, findWindow, listWindows, type WinInfo } from './windows'
import {
  SW_RESTORE,
  bringToFront,
  foregroundWindow,
  keyInput,
  mouseInput,
  setCursor,
  showWindow
} from './win32'
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function focus(
  title?: string,
  fallback?: WinInfo | null,
  guard?: () => void
): Promise<WinInfo | string> {
  guard?.()
  const win = title ? findWindow(title) : (fallback ?? activeWindow())
  if (!win) return `No window matching "${title ?? 'active window'}".`
  const rule = protectedWindowRule(win.title, win.exe)
  if (rule) return `Blocked: "${win.title}" is protected by your rule "${rule}".`
  if (blockedAppRule(win.exe)) return `Blocked: "${win.exe}" is in your blocked apps.`
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
  },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  guard?.()
  const { x, y, button = 'left' } = args
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
  const win = await focus(undefined, bound ?? underPointer, guard)
  if (typeof win === 'string') return win
  const fresh = captureCoordinates(x, y)
  if (!fresh || fresh.x !== point.x || fresh.y !== point.y)
    return 'Denied: capture the moved window again.'
  if (!setCursor(point.x, point.y)) return 'Windows could not move the pointer.'
  const flags = button === 'right' ? [0x0008, 0x0010] : button === 'left' ? [0x0002, 0x0004] : null
  if (!flags) return 'Button must be left or right.'
  invalidateScreenCoordinates()
  return mouseInput(flags[0]) && mouseInput(flags[1])
    ? `Clicked ${button} at (${Math.round(x)}, ${Math.round(y)}) in "${win.title}".`
    : 'Windows refused the click (the app may be running as administrator).'
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
  const win = await focus(bound ? undefined : args.window, bound, guard)
  if (typeof win === 'string') return win
  if (!setCursor(Math.round(win.x + win.width / 2), Math.round(win.y + win.height / 2)))
    return 'Windows could not move the pointer.'
  invalidateScreenCoordinates()
  return mouseInput(0x0800, (args.direction === 'up' ? 1 : -1) * steps * 120)
    ? `Scrolled ${args.direction} ${steps} steps in "${win.title}".`
    : 'Windows refused the scroll.'
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
  args: { keys?: string; window?: string },
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
  const win = await focus(bound ? undefined : args.window, bound, guard)
  if (typeof win === 'string') return win
  const held: number[] = []
  invalidateScreenCoordinates()
  try {
    for (const mod of mods) {
      if (!keyInput(mod)) return 'Windows refused the shortcut.'
      held.push(mod)
    }
    if (!keyInput(key) || !keyInput(key, true)) return 'Windows refused the shortcut.'
    return `Pressed ${parts.join('+')} in "${win.title}".`
  } finally {
    for (const mod of held.reverse()) keyInput(mod, true)
  }
}
export async function typeText(
  args: { text?: string; window?: string },
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  const text = String(args.text ?? '')
  if (!text || text.length > 2000) return 'Provide between 1 and 2000 characters.'
  const win = await focus(bound ? undefined : args.window, bound, guard)
  if (typeof win === 'string') return win
  invalidateScreenCoordinates()
  for (let i = 0; i < text.length; i++) {
    checkRun()
    if (foregroundWindow() !== win.hwnd) return 'Windows stopped the typing: focus changed.'
    const code = text.charCodeAt(i)
    if (!keyInput(code, false, true) || !keyInput(code, true, true))
      return 'Windows stopped the typing.'

    await sleep(8)
  }
  return `Typed ${text.length} characters in "${win.title}".`
}
