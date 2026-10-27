export function formatAccelerator(value: string): string[] {
  return value.split('+').map((key) => (key === 'Control' ? 'Ctrl' : key))
}
type Combo = {
  modifiers: string[]
  accelerator?: string
  hint?: string
}
export function readCombo(e: KeyboardEvent): Combo {
  const modifiers = [
    ...(e.ctrlKey ? ['Control'] : []),
    ...(e.altKey ? ['Alt'] : []),
    ...(e.shiftKey ? ['Shift'] : []),
    ...(e.metaKey ? ['Super'] : [])
  ]
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code)) return { modifiers }
  if (e.repeat) return { modifiers }
  const keys: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: 'Plus',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`'
  }
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit[0-9]$/.test(e.code)
      ? e.code.slice(5)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)
        ? e.code
        : keys[e.code]
  if (!key) return { modifiers, hint: 'Choose a letter, number, function key or navigation key.' }
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    return { modifiers, hint: 'Include Ctrl, Alt or the Windows key in the shortcut.' }
  }
  return { modifiers, accelerator: [...modifiers, key].join('+') }
}
