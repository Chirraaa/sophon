const MODIFIERS = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'meta'])
const NAMED_KEYS = new Set([
  'space',
  'return',
  'enter',
  'escape',
  'tab',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
  '-',
  'plus',
  ',',
  '.',
  '/',
  '\\',
  ';',
  "'",
  '[',
  ']',
  '`',
  'capslock',
  'numlock',
  'scrolllock',
  'printscreen',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
  'numdec',
  'volumeup',
  'volumedown',
  'volumemute',
  'medianexttrack',
  'mediaprevioustrack',
  'mediastop',
  'mediaplaypause'
])
function isKey(part: string): boolean {
  return NAMED_KEYS.has(part) || /^[a-z0-9]$|^f(?:[1-9]|1\d|2[0-4])$|^num[0-9]$/.test(part)
}
/** Any single key, with or without modifiers, as long as the last part is a real key. */
export function validateShortcut(value: string): void {
  const parts = value.toLowerCase().split('+')
  const key = parts.at(-1)!
  const modifiers = parts.slice(0, -1)
  if (
    value.length > 60 ||
    !isKey(key) ||
    !modifiers.every((part) => MODIFIERS.has(part)) ||
    new Set(modifiers.map(canonicalModifier)).size !== modifiers.length
  )
    throw new Error('Choose one key, optionally combined with Ctrl, Alt, Shift or Windows.')
}
function canonicalModifier(part: string): string {
  return part === 'control' ? 'ctrl' : part === 'meta' ? 'super' : part
}
/** The same keys in any spelling or order compare equal. */
export function sameShortcut(a: string, b: string): boolean {
  const normalize = (value: string): string => {
    const parts = value.toLowerCase().split('+')
    const key = parts.pop()!
    return [...parts.map(canonicalModifier).sort(), key === 'enter' ? 'return' : key].join('+')
  }
  return normalize(a) === normalize(b)
}
export const SHORTCUT_CONFLICT = 'Quick command and voice input need different shortcuts.'
