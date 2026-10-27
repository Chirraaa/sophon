import { useEffect, useRef, useState } from 'react'
export function useLocalValue<T>(
  saved: T,
  onCommit: (value: T) => void
): {
  value: T
  setValue: (value: T) => void
  commitValue: (next: T) => void
  commit: () => void
  cancel: () => void
} {
  const [value, setValue] = useState(saved)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setValue(saved)
  }, [saved])
  return {
    value,
    setValue: (next) => {
      dirty.current = true
      setValue(next)
    },
    commitValue: (next) => {
      dirty.current = false
      setValue(next)
      if (next !== saved) onCommit(next)
    },
    commit: () => {
      dirty.current = false
      if (value !== saved) onCommit(value)
    },
    cancel: () => {
      dirty.current = false
      setValue(saved)
    }
  }
}
