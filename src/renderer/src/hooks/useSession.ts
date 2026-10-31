import { clearDraft, pruneDrafts } from './useComposer'
import { useSyncExternalStore } from 'react'

let state: SessionSnapshot = {
  mode: 'assistant',
  chatId: '',
  chats: [],
  runningChatId: null,
  items: [],
  busy: false
}
let revision = 0
let detach: (() => void) | undefined
const listeners = new Set<() => void>()
const publish = (next: SessionSnapshot): void => {
  if (
    next.chatId === state.chatId &&
    (state.totalItems ?? state.items.length) > 0 &&
    (next.totalItems ?? next.items.length) === 0
  )
    clearDraft(next.chatId)
  // Drafts typed in agent threads belong to their chat's agents.
  pruneDrafts([
    ...next.chats.map((chat) => chat.id),
    ...(next.agents ?? []).map((agent) => agent.chatId),
    next.chatId
  ])
  state = next
  revision++
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!detach) {
    const expected = revision
    const stopSession = window.api.onSession(publish)
    const stopText = window.api.onSessionText((update) => {
      if (state.chatId !== update.chatId) return
      if (!state.items.some((item) => item.id === update.itemId && item.pending)) return
      publish({
        ...state,
        items: state.items.map((item) =>
          item.id === update.itemId ? { ...item, text: update.text } : item
        )
      })
    })
    detach = () => {
      stopSession()
      stopText()
    }
    void window.api.getSession().then((next) => {
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
export function useSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, () => state)
}
