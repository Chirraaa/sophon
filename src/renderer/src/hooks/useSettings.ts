import { useSyncExternalStore } from 'react'

let state: AppSettings | null = null
let revision = 0
let detach: (() => void) | undefined
const listeners = new Set<() => void>()
const publish = (next: AppSettings): void => {
  state = next
  revision++
  document.documentElement.dataset.accent = next.accent
  const style = document.documentElement.style
  if (/^#[0-9a-f]{6}$/i.test(next.accent)) {
    style.setProperty('--tint', next.accent)
    const rgb = [1, 3, 5].map((offset) => parseInt(next.accent.slice(offset, offset + 2), 16) / 255)
    const linear = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    style.setProperty('--tint-fg', luminance > 0.179 ? '#111113' : '#ffffff')
  } else {
    style.removeProperty('--tint')
    style.removeProperty('--tint-fg')
  }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!detach) {
    const expected = revision
    detach = window.api.onSettings(publish)
    void window.api.getSettings().then((next) => {
      if (revision === expected) publish(next)
    })
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      detach?.()
      detach = undefined
    }
  }
}
export function useSettings(): AppSettings | null {
  return useSyncExternalStore(subscribe, () => state)
}
