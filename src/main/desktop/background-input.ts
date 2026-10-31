import { getSettings } from '../settings'
import { fullscreenApp } from '../services/fullscreen'
import {
  className,
  getProcess,
  isClickThrough,
  ownedBy,
  postChar,
  postKey,
  postMouse,
  raiseWindow,
  rootWindowAt
} from '../tools/win32'
import type { WinInfo } from '../tools/window-types'

// Background input: clicks, scrolling, typing and plain keys go straight to an app's window
// as window messages. The real pointer and keyboard stay with the user, and only Sophon's
// own cursor overlay shows where an agent acts. Chromium-based windows (Chrome, Edge and
// Electron apps such as VS Code, Discord or Slack) handle these messages like real input,
// even while another window is in front. Other apps, games, held buttons, relative mouse
// movement and shortcuts with modifiers keep using real input.

const CHROMIUM = /^Chrome_WidgetWin_\d+$/
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Whether input to this window can be sent in the background.
export function backgroundInput(win: WinInfo | null | undefined): boolean {
  if (!win || win.state === 'minimized' || getSettings().agents?.input === 'pointer') return false
  try {
    if (fullscreenApp()?.hwnd === win.hwnd) return false
    return CHROMIUM.test(className(win.hwnd))
  } catch {
    return false
  }
}

const MODIFIER = /^(ctrl|control|shift|alt)$/i
type Step = { action?: string; keys?: string; hold_ms?: number }
// Whether one input step can run in the background in a window that supports it.
export function backgroundStep(step: Step): boolean {
  if (step.action === 'type_text' || step.action === 'scroll' || step.action === 'wait') return true
  if (step.action === 'click') return step.hold_ms === undefined
  if (step.action === 'press_keys')
    return (
      step.hold_ms === undefined &&
      !String(step.keys ?? '')
        .split('+')
        .slice(0, -1)
        .some((part) => MODIFIER.test(part.trim()))
    )
  return false
}

// Whether a whole tool call runs in the background, so it needs no turn at the shared real
// pointer and keyboard (it still claims its window).
export function backgroundAction(
  name: string,
  args: Record<string, unknown>,
  win: WinInfo | null | undefined
): boolean {
  if (!backgroundInput(win)) return false
  if (name === 'input_batch')
    return Array.isArray(args.steps) && (args.steps as Step[]).every(backgroundStep)
  if (['click', 'scroll', 'type_text', 'press_keys'].includes(name))
    return backgroundStep({ ...(args as Step), action: name })
  return false
}

// The window that receives input at a screen point: the target, or a popup it owns (a menu
// or dropdown drawn above it). Another window of the same app does not count. When another app covers the point, the target is
// raised without taking focus. Sophon's click-through overlays never count.
// Null when the point stays covered (for example by an always-on-top window).
function receiver(win: WinInfo, x: number, y: number): number | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    const at = rootWindowAt(x, y)
    if (at === win.hwnd || (at && ownedBy(at, win.hwnd))) return at
    if (at && getProcess(at).pid === process.pid && isClickThrough(at)) return win.hwnd
    if (attempt === 0) raiseWindow(win.hwnd)
  }
  return null
}

const BUTTONS = {
  left: { down: 0x0201, up: 0x0202, held: 0x0001 },
  right: { down: 0x0204, up: 0x0205, held: 0x0002 }
} as const

// Clicks at a screen point (physical pixels). Returns false when the click could not be
// delivered in the background, so the caller can fall back to real input.
export async function backgroundClick(
  win: WinInfo,
  point: { x: number; y: number },
  button: 'left' | 'right'
): Promise<boolean> {
  const target = receiver(win, point.x, point.y)
  if (!target) return false
  const { down, up, held } = BUTTONS[button]
  if (!postMouse(target, 0x0200, 0, point.x, point.y)) return false
  await sleep(15)
  if (!postMouse(target, down, held, point.x, point.y)) return false
  await sleep(40)
  return postMouse(target, up, 0, point.x, point.y)
}

// Scrolls the content under a screen point.
export async function backgroundScroll(
  win: WinInfo,
  point: { x: number; y: number },
  delta: number
): Promise<boolean> {
  const target = receiver(win, point.x, point.y)
  if (!target) return false
  if (!postMouse(target, 0x0200, 0, point.x, point.y)) return false
  await sleep(15)
  return postMouse(target, 0x020a, ((delta & 0xffff) << 16) >>> 0, point.x, point.y)
}

// Types text into the focused control of the window, one UTF-16 unit at a time. A line break
// is Enter. `check` runs between characters and throws to stop.
export async function backgroundType(
  win: WinInfo,
  text: string,
  check: () => void
): Promise<boolean> {
  for (let i = 0; i < text.length; i++) {
    check()
    const code = text.charCodeAt(i)
    if (code === 13 && text.charCodeAt(i + 1) === 10) continue
    if (!postChar(win.hwnd, code === 10 ? 13 : code)) return false
    await sleep(8)
  }
  return true
}

// Presses one key without modifiers.
export async function backgroundKey(win: WinInfo, key: number): Promise<boolean> {
  if (!postKey(win.hwnd, key, false)) return false
  await sleep(60)
  return postKey(win.hwnd, key, true)
}
