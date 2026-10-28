import { BrowserWindow, desktopCapturer } from 'electron'
import { protectedWindowRule } from '../permissions'
import { currentRun, assertRun } from '../security/run-manager'
import { getProcess } from './win32'
import { hideScreenGlow, showScreenGlow } from '../services/screen-glow'
const checkRun = (): void => {
  const run = currentRun()
  if (run) assertRun(run)
}
import {
  activeWindow,
  findWindow,
  listWindows,
  monitorOf,
  monitors,
  resolveMonitor,
  type WinInfo
} from './windows'
type Rect = {
  x: number
  y: number
  width: number
  height: number
}
export type CaptureArgs = {
  monitor?: string | number
  window?: string
  region?: Rect
  if_changed?: boolean
}
export type CapturedScreen = {
  text: string
  image: string
}
let lastCapture: {
  runId: string
  at: number
  pid: number
  bounds: Rect
  image: {
    width: number
    height: number
  }
  window: WinInfo | null
  encoded: string
  clickable: boolean
} | null = null
export function invalidateScreenCoordinates(): void {
  if (lastCapture) lastCapture.clickable = false
}
export function captureCoordinates(
  x: number,
  y: number
): {
  x: number
  y: number
  window: WinInfo | null
} | null {
  if (
    !lastCapture ||
    !lastCapture.clickable ||
    lastCapture.runId !== (currentRun()?.id ?? '') ||
    Date.now() - lastCapture.at > 120000 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    return null
  const { bounds, image, window } = lastCapture
  if (window) {
    const now = listWindows().find((w) => w.hwnd === window.hwnd)
    if (
      !now ||
      now.exe !== window.exe ||
      getProcess(now.hwnd).pid !== lastCapture.pid ||
      now.state === 'minimized' ||
      now.x !== window.x ||
      now.y !== window.y ||
      now.width !== window.width ||
      now.height !== window.height
    )
      return null
  }
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
  return {
    x: Math.round(bounds.x + (x * bounds.width) / image.width),
    y: Math.round(bounds.y + (y * bounds.height) / image.height),
    window
  }
}
function target(
  args: CaptureArgs,
  bound?: WinInfo
):
  | {
      window: WinInfo | null
      display: ReturnType<typeof monitors>[number]
      captureWindow: boolean
    }
  | string {
  if (args.window && args.monitor !== undefined) return 'Choose a window or a monitor, not both.'
  const win =
    bound ??
    (args.window
      ? findWindow(String(args.window))
      : args.monitor === undefined
        ? activeWindow()
        : null)
  if (args.window && !win) return `No window matching "${args.window}".`
  if (win) {
    if (win.state === 'minimized')
      return 'Could not capture the last active window because it is minimized. Restore that window, reopen Sophon, and try again.'
    const rule = protectedWindowRule(win.title, win.exe)
    if (rule) return `Blocked: "${win.title}" is protected by your rule "${rule}".`
  }
  const display =
    args.monitor !== undefined
      ? resolveMonitor(String(args.monitor))
      : win
        ? monitorOf(win)
        : monitors().find((m) => m.primary)
  if (!display) return `Unknown monitor "${args.monitor}".`
  return { window: win, display, captureWindow: Boolean(win) }
}
export async function captureScreen(
  args: CaptureArgs,
  guard?: () => void,
  bound?: WinInfo
): Promise<CapturedScreen | string> {
  const previous = lastCapture
  lastCapture = null
  hideScreenGlow()
  guard?.()
  const choice = target(args, bound)
  if (typeof choice === 'string') return choice
  const { window: win, display, captureWindow } = choice
  if (
    !captureWindow &&
    listWindows().some(
      (w) =>
        w.state !== 'minimized' &&
        monitorOf(w).id === display.id &&
        protectedWindowRule(w.title, w.exe)
    )
  ) {
    return 'A protected window is visible on that monitor. Choose another monitor or window.'
  }
  const hidden: BrowserWindow[] = []
  try {
    if (!captureWindow) {
      for (const own of BrowserWindow.getAllWindows()) {
        if (own.isVisible()) {
          hidden.push(own)
          own.hide()
        }
      }
      if (hidden.length) await new Promise((resolve) => setTimeout(resolve, 120))
    }
    const options = {
      types: [captureWindow ? 'window' : 'screen'],
      thumbnailSize: args.region ? { width: 2560, height: 1600 } : { width: 1280, height: 960 }
    } satisfies Parameters<typeof desktopCapturer.getSources>[0]
    let sources = await desktopCapturer.getSources(options)
    checkRun()
    guard?.()
    const select = (): (typeof sources)[number] | undefined =>
      captureWindow
        ? sources.find((s) => s.id.startsWith(`window:${win!.hwnd}:`))
        : sources.find((s) => s.display_id === String(display.id))
    let source = select()
    if (!source || source.thumbnail.isEmpty()) {
      sources = await desktopCapturer.getSources(options)
      checkRun()
      guard?.()
      source = select()
    }
    if (!source || source.thumbnail.isEmpty())
      return captureWindow
        ? 'Could not capture the last active window. Bring that window to the foreground, reopen Sophon, and try again. You can also attach an image file.'
        : 'Could not capture that monitor. Check that it is connected and try again, or attach an image file.'
    let image = source.thumbnail
    const rawSize = image.getSize()

    const scale = Math.min(
      1,
      1280 / rawSize.width,
      960 / rawSize.height,
      (win ? win.width : display.full.width) / rawSize.width,
      (win ? win.height : display.full.height) / rawSize.height
    )

    const size = {
      width: Math.max(1, Math.round(rawSize.width * scale)),
      height: Math.max(1, Math.round(rawSize.height * scale))
    }
    let bounds: Rect = captureWindow
      ? { x: win!.x, y: win!.y, width: win!.width, height: win!.height }
      : display.full
    if (args.region) {
      const r = args.region
      if (
        ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
        r.x < 0 ||
        r.y < 0 ||
        r.width < 16 ||
        r.height < 16 ||
        r.x + r.width > size.width ||
        r.y + r.height > size.height
      ) {
        return `Invalid region. Image size is ${size.width}×${size.height} pixels.`
      }
      const crop = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      }
      bounds = {
        x: bounds.x + (crop.x * bounds.width) / size.width,
        y: bounds.y + (crop.y * bounds.height) / size.height,
        width: (crop.width * bounds.width) / size.width,
        height: (crop.height * bounds.height) / size.height
      }
      const left = Math.round((crop.x * rawSize.width) / size.width)
      const top = Math.round((crop.y * rawSize.height) / size.height)
      image = image.crop({
        x: left,
        y: top,
        width: Math.min(
          rawSize.width - left,
          Math.round((crop.width * rawSize.width) / size.width)
        ),
        height: Math.min(
          rawSize.height - top,
          Math.round((crop.height * rawSize.height) / size.height)
        )
      })
    }
    const croppedSize = image.getSize()
    const outputScale = Math.min(
      1,
      1280 / croppedSize.width,
      960 / croppedSize.height,
      bounds.width / croppedSize.width,
      bounds.height / croppedSize.height
    )
    if (outputScale < 1)
      image = image.resize({
        width: Math.max(1, Math.round(croppedSize.width * outputScale)),
        quality: 'best'
      })
    const imageSize = image.getSize()
    checkRun()
    guard?.()
    if (win) {
      const current = listWindows().find((candidate) => candidate.hwnd === win.hwnd)
      if (
        !current ||
        current.exe !== win.exe ||
        current.x !== win.x ||
        current.y !== win.y ||
        current.width !== win.width ||
        current.height !== win.height ||
        current.state === 'minimized'
      )
        return 'Could not capture stable window bounds. Refresh the window and capture again.'
    }
    const encoded = image.toJPEG(88).toString('base64')
    lastCapture = {
      runId: currentRun()?.id ?? '',
      at: Date.now(),
      pid: win ? getProcess(win.hwnd).pid : 0,
      bounds,
      image: imageSize,
      window: win ? { ...win } : null,
      encoded,
      clickable: true
    }
    const label = win ? `"${win.title}" on monitor ${display.index}` : `monitor ${display.index}`
    const run = currentRun()
    if (run) showScreenGlow(display.id, run.signal)
    if (
      args.if_changed &&
      previous &&
      previous.runId === lastCapture.runId &&
      previous.pid === lastCapture.pid &&
      previous.window?.hwnd === lastCapture.window?.hwnd &&
      JSON.stringify(previous.bounds) === JSON.stringify(bounds) &&
      JSON.stringify(previous.image) === JSON.stringify(imageSize) &&
      previous.encoded === encoded
    )
      return `Observed ${label}: the fresh screenshot is pixel-identical to the preceding capture of this same region. No duplicate image was sent. Image is ${imageSize.width}×${imageSize.height} pixels; its coordinates have been refreshed. Use the preceding image only if it remains available, otherwise call look_at_screen without if_changed. Unchanged pixels alone do not establish whether an action succeeded.`
    return {
      text: `Captured ${label}${args.region ? ' (zoomed region)' : ''}. Image is ${imageSize.width}×${imageSize.height} pixels. Click coordinates are local to THIS image: x=0..${imageSize.width - 1}, y=0..${imageSize.height - 1}; origin is top-left. Do not use normalized 0–1000 coordinates or desktop coordinates. To zoom, request region in the full overview's image pixels; the region is captured at higher detail. Use inspect_app and act_on_control for named buttons and text instead of estimating clicks.`,
      image: `data:image/jpeg;base64,${encoded}`
    }
  } finally {
    for (const own of hidden) if (!own.isDestroyed()) own.showInactive()
  }
}
