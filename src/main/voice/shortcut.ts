import koffi from 'koffi'
const GetAsyncKeyState = koffi.load('user32.dll').func('int16 __stdcall GetAsyncKeyState(int key)')
const KEYS: Record<string, number> = {
  control: 0x11,
  ctrl: 0x11,
  alt: 0x12,
  shift: 0x10,
  super: 0x5b,
  meta: 0x5b,
  space: 0x20,
  return: 0x0d,
  enter: 0x0d,
  escape: 0x1b,
  tab: 0x09,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  '-': 0xbd,
  plus: 0xbb,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  '\\': 0xdc,
  ';': 0xba,
  "'": 0xde,
  '[': 0xdb,
  ']': 0xdd,
  '`': 0xc0
}
export function shortcutKeys(accelerator: string): number[] {
  return accelerator.split('+').map((part) => {
    const key = part.toLowerCase()
    if (/^[a-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0)
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return 0x70 + Number(key.slice(1)) - 1
    if (KEYS[key] !== undefined) return KEYS[key]
    throw new Error(
      'Choose a shortcut with Ctrl, Alt, Shift, Windows, letters, numbers or navigation keys.'
    )
  })
}
export function waitForRelease(accelerator: string, released: () => void): () => void {
  const keys = shortcutKeys(accelerator)
  const timer = setInterval(() => {
    if (
      keys.every(
        (key) =>
          (GetAsyncKeyState(key) & 0x8000) !== 0 ||
          (key === 0x5b && (GetAsyncKeyState(0x5c) & 0x8000) !== 0)
      )
    )
      return
    clearInterval(timer)
    released()
  }, 25)
  return () => clearInterval(timer)
}
