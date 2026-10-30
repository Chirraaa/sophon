import { screen } from 'electron'
import { exclusiveFullscreen, foregroundWindow, getProcess, getRect } from '../tools/win32'

export type FullscreenApp = { hwnd: number; displayId: number; exclusive: boolean }

// The foreground app when it fills a whole monitor: a fullscreen or borderless
// game or video. Maximized windows stop at the taskbar and do not count.
export function fullscreenApp(): FullscreenApp | null {
  const hwnd = foregroundWindow()
  if (!hwnd) return null
  const { pid, exe } = getProcess(hwnd)
  if (pid === process.pid || exe.toLowerCase() === 'explorer.exe') return null
  const r = getRect(hwnd)
  const bounds = screen.screenToDipRect(null, {
    x: r.left,
    y: r.top,
    width: r.right - r.left,
    height: r.bottom - r.top
  })
  const display = screen.getDisplayMatching(bounds)
  const d = display.bounds
  if (
    bounds.x > d.x ||
    bounds.y > d.y ||
    bounds.x + bounds.width < d.x + d.width ||
    bounds.y + bounds.height < d.y + d.height
  )
    return null
  return { hwnd, displayId: display.id, exclusive: exclusiveFullscreen() }
}
