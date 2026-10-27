export function validateShortcut(value: string): void {
  const parts = value.toLowerCase().split('+')
  const modifiers = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'meta'])
  const keys = new Set([
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
    '`'
  ])
  if (
    value.length > 60 ||
    parts.length < 2 ||
    new Set(parts).size !== parts.length ||
    !parts.slice(0, -1).every((part) => modifiers.has(part)) ||
    !parts.some((part) => ['ctrl', 'control', 'alt', 'super', 'meta'].includes(part)) ||
    !(keys.has(parts.at(-1)!) || /^[a-z0-9]$|^f(?:[1-9]|1\d|2[0-4])$/.test(parts.at(-1)!))
  )
    throw new Error('Use a shortcut with Ctrl, Alt or Windows and one supported key.')
}
