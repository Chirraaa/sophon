import { useState } from 'react'

export function useStoredBoolean(
  key: string,
  fallback = false
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved === null ? fallback : saved === 'true'
    } catch {
      return fallback
    }
  })
  return [
    value,
    (next) => {
      setValue(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // The control still works if local storage is unavailable.
      }
    }
  ]
}
