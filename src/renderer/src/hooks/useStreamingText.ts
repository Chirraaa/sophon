import { useEffect, useState } from 'react'
import { useMotionPreference } from './useMotionPreference'

export function useStreamingText(text: string, streaming = true): string {
  const reduced = useMotionPreference()
  const [visible, setVisible] = useState(text)
  useEffect(() => {
    if (visible === text) return
    const frame = requestAnimationFrame(() => {
      if (reduced || !streaming || !text.startsWith(visible)) {
        setVisible(text)
        return
      }
      let length = Math.min(
        text.length,
        visible.length + Math.max(2, Math.ceil((text.length - visible.length) / 4))
      )
      // Avoid cutting a surrogate pair between animation frames.
      if (length < text.length && /[\uD800-\uDBFF]/.test(text[length - 1])) length++
      setVisible(text.slice(0, length))
    })
    return () => cancelAnimationFrame(frame)
  }, [text, reduced, visible, streaming])
  return reduced || !streaming || !text.startsWith(visible) ? text : visible
}
