import { useEffect, useRef, type RefObject } from 'react'

export function useChatScroll(chatId: string): RefObject<HTMLDivElement | null> {
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = content.current
    const viewport = element?.closest<HTMLElement>(
      '[data-slot="scroll-area-viewport"], [data-chat-viewport]'
    )
    if (!element || !viewport) return
    let pinned = true
    const update = (): void => {
      pinned = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 64
    }
    const observer = new ResizeObserver(() => {
      if (pinned) viewport.scrollTop = viewport.scrollHeight
    })
    observer.observe(element)
    viewport.scrollTop = viewport.scrollHeight
    viewport.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', update)
    }
  }, [chatId])
  return content
}
