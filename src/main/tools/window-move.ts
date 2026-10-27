import { protectedWindowRule } from '../permissions'
import { currentRun, assertRun } from '../security/run-manager'
const checkRun = (): void => {
  const run = currentRun()
  if (run) assertRun(run)
}
import { findWindow, listWindowsText } from './windows'
import { monitorOf, monitorsText, resolveMonitor, type Area, type Mon } from './monitors'
import type { WinInfo } from './window-types'
import {
  SW_MAXIMIZE,
  SW_MINIMIZE,
  SW_RESTORE,
  bringToFront,
  getVisibleRect,
  isMinimized,
  isMaximized,
  showWindow,
  placeWindow
} from './win32'
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function waitForWindow(query: string, timeoutMs = 4000): Promise<WinInfo | null> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const w = findWindow(query)
    if (w) return w
    if (Date.now() >= end) return null
    await sleep(250)
    checkRun()
  }
}
function refresh(w: WinInfo): WinInfo {
  const r = getVisibleRect(w.hwnd)
  return {
    ...w,
    state: isMinimized(w.hwnd) ? 'minimized' : isMaximized(w.hwnd) ? 'maximized' : 'normal',
    x: r.left,
    y: r.top,
    width: r.right - r.left,
    height: r.bottom - r.top
  }
}
export const POSITIONS = [
  'left_third',
  'center_third',
  'right_third',
  'left_two_thirds',
  'right_two_thirds',
  'left_half',
  'right_half',
  'top_half',
  'bottom_half',
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
  'center',
  'maximize',
  'minimize',
  'restore'
] as const
function presetRect(position: string, a: Area): Area | null {
  const hw = Math.floor(a.width / 2)
  const hh = Math.floor(a.height / 2)
  const third = Math.floor(a.width / 3)
  switch (position) {
    case 'left_third':
      return { x: a.x, y: a.y, width: third, height: a.height }
    case 'center_third':
      return { x: a.x + third, y: a.y, width: third, height: a.height }
    case 'right_third':
      return { x: a.x + third * 2, y: a.y, width: a.width - third * 2, height: a.height }
    case 'left_two_thirds':
      return { x: a.x, y: a.y, width: third * 2, height: a.height }
    case 'right_two_thirds':
      return { x: a.x + third, y: a.y, width: a.width - third, height: a.height }
    case 'left_half':
      return { x: a.x, y: a.y, width: hw, height: a.height }
    case 'right_half':
      return { x: a.x + hw, y: a.y, width: a.width - hw, height: a.height }
    case 'top_half':
      return { x: a.x, y: a.y, width: a.width, height: hh }
    case 'bottom_half':
      return { x: a.x, y: a.y + hh, width: a.width, height: a.height - hh }
    case 'top_left':
      return { x: a.x, y: a.y, width: hw, height: hh }
    case 'top_right':
      return { x: a.x + hw, y: a.y, width: a.width - hw, height: hh }
    case 'bottom_left':
      return { x: a.x, y: a.y + hh, width: hw, height: a.height - hh }
    case 'bottom_right':
      return { x: a.x + hw, y: a.y + hh, width: a.width - hw, height: a.height - hh }
    case 'center': {
      const w = Math.floor(a.width * 0.6)
      const h = Math.floor(a.height * 0.7)
      return {
        x: a.x + Math.floor((a.width - w) / 2),
        y: a.y + Math.floor((a.height - h) / 2),
        width: w,
        height: h
      }
    }
    default:
      return null
  }
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : undefined
}
export type MoveArgs = {
  title?: string
  position?: string
  monitor?: string | number
  x?: number
  y?: number
  width?: number
  height?: number
}
export async function moveWindow(
  args: MoveArgs,
  guard?: () => void,
  bound?: WinInfo
): Promise<string> {
  guard?.()
  const query = String(args.title ?? '').trim()
  if (!query) return 'Missing window title.'
  const position = args.position?.toLowerCase().trim()
  const x = num(args.x)
  const y = num(args.y)
  const width = num(args.width)
  const height = num(args.height)
  const hasCoords = [x, y, width, height].some((v) => v !== undefined)
  const monitorSpec =
    args.monitor !== undefined && args.monitor !== null && String(args.monitor).trim() !== ''
      ? String(args.monitor)
      : undefined
  if (position && !(POSITIONS as readonly string[]).includes(position)) {
    return `Unknown position "${position}". Valid: ${POSITIONS.join(', ')}`
  }
  let targetMon: Mon | null = null
  if (monitorSpec) {
    targetMon = resolveMonitor(monitorSpec)
    if (!targetMon) return `Unknown monitor "${monitorSpec}".\n${monitorsText()}`
  }
  if (!position && !hasCoords && !targetMon) {
    return 'Provide a position, a monitor, or x/y/width/height.'
  }
  let win = bound ?? (await waitForWindow(query))
  checkRun()
  guard?.()
  if (!win) return `No window matching "${query}". Open windows:\n${listWindowsText()}`
  const h = win.hwnd
  const verified = async (
    message: string,
    matches: (observed: WinInfo) => boolean
  ): Promise<string> => {
    for (const delay of [80, 120, 200, 300]) {
      await sleep(delay)
      checkRun()
      try {
        guard?.()
        const observed = refresh(win!)
        if (matches(observed)) return message + ' Verified window state.'
      } catch {
        checkRun()
        break
      }
    }
    return 'Unverified: Windows accepted the request, but its resulting window state could not be confirmed. Inspect the window before retrying.'
  }
  const protectedBy = protectedWindowRule(win.title, win.exe)
  if (protectedBy) return `Blocked: "${win.title}" is protected by your rule "${protectedBy}".`
  if (position === 'minimize') {
    showWindow(h, SW_MINIMIZE)
    return verified(`Minimized "${win.title}"`, (observed) => observed.state === 'minimized')
  }
  if (position === 'restore') {
    showWindow(h, SW_RESTORE)
    bringToFront(h)
    return verified(`Restored "${win.title}"`, (observed) => observed.state === 'normal')
  }
  if (win.state !== 'normal') {
    showWindow(h, SW_RESTORE)
    await sleep(150)
    checkRun()
    guard?.()
    win = refresh(win)
  }
  const mon = targetMon ?? monitorOf(win)
  if (position === 'maximize') {
    if (targetMon && monitorOf(win).index !== targetMon.index) {
      const w = Math.min(win.width, targetMon.work.width - 80)
      const hh = Math.min(win.height, targetMon.work.height - 80)
      placeWindow(h, targetMon.work.x + 40, targetMon.work.y + 40, w, hh)
      await sleep(100)
      checkRun()
      guard?.()
    }
    showWindow(h, SW_MAXIMIZE)
    bringToFront(h)
    return verified(
      `Maximized "${win.title}" on monitor ${mon.index}`,
      (observed) => observed.state === 'maximized' && monitorOf(observed).index === mon.index
    )
  }
  let target: Area | null = null
  if (position) {
    target = presetRect(position, mon.work)
  } else if (hasCoords) {
    target = {
      x: x ?? win.x,
      y: y ?? win.y,
      width: width ?? win.width,
      height: height ?? win.height
    }
  } else if (targetMon) {
    const w = Math.min(win.width, mon.work.width)
    const hh = Math.min(win.height, mon.work.height)
    target = {
      x: mon.work.x + Math.floor((mon.work.width - w) / 2),
      y: mon.work.y + Math.floor((mon.work.height - hh) / 2),
      width: w,
      height: hh
    }
  }
  if (!target) return `Could not compute a position for "${position}".`
  if (
    target.width < 80 ||
    target.height < 60 ||
    target.x < mon.work.x ||
    target.y < mon.work.y ||
    target.x + target.width > mon.work.x + mon.work.width ||
    target.y + target.height > mon.work.y + mon.work.height
  )
    return 'Invalid window bounds: keep the window inside the selected monitor work area, at least 80 by 60 pixels. Select a monitor when placing it on another screen.'
  const ok = placeWindow(h, target.x, target.y, target.width, target.height)
  bringToFront(h)
  if (!ok) return `Windows refused to move "${win.title}" (it may be running as administrator).`
  const expected = target
  return verified(
    `Moved "${win.title}" to ${position ?? 'custom position'} on monitor ${mon.index} (${target.x},${target.y} ${target.width}x${target.height})`,
    (observed) =>
      observed.state === 'normal' &&
      (['x', 'y', 'width', 'height'] as const).every(
        (key) => Math.abs(observed[key] - expected[key]) <= 4
      )
  )
}
