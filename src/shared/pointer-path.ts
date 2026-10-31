// How a pointer travels between two points: a minimum-jerk ease along a gently curved
// path, like a hand moving a mouse. The physical pointer and each agent's on-screen cursor
// use the same path, so they arrive together.

export type PointerSpeed = 'natural' | 'fast' | 'instant'
export type Point = { x: number; y: number }

// Longer moves take longer, but sub-linearly (Fitts's law shape), within short bounds so
// a click never waits long for the pointer.
export function glideDuration(from: Point, to: Point, speed: PointerSpeed): number {
  if (speed === 'instant') return 0
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance < 3) return 0
  const natural = Math.min(480, Math.max(160, 140 + 30 * Math.log2(1 + distance / 10)))
  return Math.round(speed === 'fast' ? Math.max(70, natural * 0.45) : natural)
}

// A small sideways bow, signed and sized from the endpoints so it is stable for a move.
export function glideCurve(from: Point, to: Point): number {
  const seed =
    Math.sin(from.x * 12.9898 + from.y * 78.233 + to.x * 37.719 + to.y * 4.581) * 43758.5453
  const unit = seed - Math.floor(seed)
  return (unit < 0.5 ? -1 : 1) * (0.04 + (unit % 0.5) * 0.12)
}

const ease = (t: number): number => t * t * t * (10 - 15 * t + 6 * t * t)

// Position at progress t (0..1) of the move.
export function glidePoint(from: Point, to: Point, curve: number, t: number): Point {
  const s = ease(Math.min(1, Math.max(0, t)))
  const dx = to.x - from.x
  const dy = to.y - from.y
  const cx = (from.x + to.x) / 2 - dy * curve
  const cy = (from.y + to.y) / 2 + dx * curve
  const a = (1 - s) * (1 - s)
  const b = 2 * (1 - s) * s
  const c = s * s
  return { x: a * from.x + b * cx + c * to.x, y: a * from.y + b * cy + c * to.y }
}
