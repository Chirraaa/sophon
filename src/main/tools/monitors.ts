import { screen } from 'electron'
import type { WinInfo } from './window-types'
export type Area = {
  x: number
  y: number
  width: number
  height: number
}
export type Mon = {
  index: number
  id: number
  primary: boolean
  work: Area
  full: Area
}
export function monitors(): Mon[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .slice()
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d, i) => ({
      index: i + 1,
      id: d.id,
      primary: d.id === primaryId,
      work: screen.dipToScreenRect(null, d.workArea),
      full: screen.dipToScreenRect(null, d.bounds)
    }))
}
export function monitorsText(): string {
  return monitors()
    .map(
      (m) =>
        `Monitor ${m.index}${m.primary ? ' (primary)' : ''}: ${m.full.width}x${m.full.height} at (${m.full.x},${m.full.y})`
    )
    .join('\n')
}
export function monitorOf(w: WinInfo): Mon {
  const mons = monitors()
  const cx = w.x + w.width / 2
  const cy = w.y + w.height / 2
  const inside = mons.find(
    (m) =>
      cx >= m.full.x &&
      cx < m.full.x + m.full.width &&
      cy >= m.full.y &&
      cy < m.full.y + m.full.height
  )
  if (inside) return inside
  const d = screen.getDisplayNearestPoint(
    screen.screenToDipPoint({ x: Math.round(cx), y: Math.round(cy) })
  )
  return mons.find((m) => m.id === d.id) ?? mons[0]
}
export function resolveMonitor(spec: string): Mon | null {
  const mons = monitors()
  const s = spec.toLowerCase().trim()
  if (s === 'primary' || s === 'main') return mons.find((m) => m.primary) ?? null
  if (s === 'left' || s === 'first') return mons[0]
  if (s === 'right' || s === 'last') return mons[mons.length - 1]
  const n = Number(s)
  if (Number.isInteger(n) && n >= 1 && n <= mons.length) return mons[n - 1]
  return null
}
