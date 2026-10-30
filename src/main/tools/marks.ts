// Set-of-Marks overlay: numbered boxes drawn straight into a BGRA bitmap so the
// model can name a target ("mark 7") instead of estimating pixel coordinates.
export type Mark = { label: number; x: number; y: number; width: number; height: number }

// 3×5 digit glyphs, one row per entry, high bit on the left.
const DIGITS = [
  [7, 5, 5, 5, 7],
  [2, 6, 2, 2, 7],
  [7, 1, 7, 4, 7],
  [7, 1, 7, 1, 7],
  [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7],
  [7, 4, 7, 5, 7],
  [7, 1, 1, 1, 1],
  [7, 5, 7, 5, 7],
  [7, 5, 7, 1, 7]
]
// Dark enough for white digits, distinct enough for neighbouring boxes. [B, G, R]
const COLORS = [
  [0x70, 0x00, 0xd0],
  [0xd0, 0x50, 0x00],
  [0x00, 0x40, 0xc0],
  [0x3d, 0x7a, 0x00],
  [0xc8, 0x00, 0x6a],
  [0x00, 0x60, 0xa0]
]
const SCALE = 2
const GLYPH = 3 * SCALE
const GAP = SCALE
const PAD = 2
const TAG_HEIGHT = 5 * SCALE + PAD * 2

export function drawMarks(bitmap: Buffer, width: number, height: number, marks: Mark[]): void {
  if (bitmap.length < width * height * 4) throw new Error('Bitmap is smaller than its size.')
  const fill = (x: number, y: number, w: number, h: number, color: number[]): void => {
    const left = Math.max(0, Math.round(x))
    const top = Math.max(0, Math.round(y))
    const right = Math.min(width, Math.round(x + w))
    const bottom = Math.min(height, Math.round(y + h))
    for (let row = top; row < bottom; row++)
      for (let col = left; col < right; col++) {
        const at = (row * width + col) * 4
        bitmap[at] = color[0]
        bitmap[at + 1] = color[1]
        bitmap[at + 2] = color[2]
        bitmap[at + 3] = 0xff
      }
  }
  const white = [0xff, 0xff, 0xff]
  const visible = marks.filter(
    (m) =>
      m.width >= 4 &&
      m.height >= 4 &&
      m.x < width &&
      m.y < height &&
      m.x + m.width > 0 &&
      m.y + m.height > 0
  )
  // Outlines first, then every tag, so a later box never hides an earlier number.
  for (const m of visible) {
    const color = COLORS[m.label % COLORS.length]
    fill(m.x, m.y, m.width, 2, color)
    fill(m.x, m.y + m.height - 2, m.width, 2, color)
    fill(m.x, m.y, 2, m.height, color)
    fill(m.x + m.width - 2, m.y, 2, m.height, color)
  }
  for (const m of visible) {
    const color = COLORS[m.label % COLORS.length]
    const digits = String(m.label).split('').map(Number)
    const tagWidth = digits.length * (GLYPH + GAP) - GAP + PAD * 2
    const x = Math.min(Math.max(0, m.x), width - tagWidth)
    const y = Math.min(Math.max(0, m.y), height - TAG_HEIGHT)
    fill(x, y, tagWidth, TAG_HEIGHT, color)
    digits.forEach((digit, index) => {
      const left = x + PAD + index * (GLYPH + GAP)
      DIGITS[digit].forEach((row, line) => {
        for (let bit = 0; bit < 3; bit++)
          if (row & (4 >> bit))
            fill(left + bit * SCALE, y + PAD + line * SCALE, SCALE, SCALE, white)
      })
    })
  }
}
