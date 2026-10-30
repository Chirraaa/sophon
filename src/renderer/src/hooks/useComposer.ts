import { useEffect, useState } from 'react'
import { loadPreview } from '@/lib/attachment-preview'
type Draft = {
  text: string
  attachments: ChatAttachment[]
}
const drafts = new Map<string, Draft>()
const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )
const cleared = new Set<(chatId: string) => void>()
export function clearDraft(chatId: string): void {
  drafts.delete(chatId)
  for (const listener of cleared) listener(chatId)
}
export function pruneDrafts(chatIds: Iterable<string>): void {
  const retained = new Set(chatIds)
  for (const id of drafts.keys()) if (!retained.has(id)) clearDraft(id)
}
type ComposerState = Draft & {
  setText: (value: string) => void
  remove: (id: string) => void
  unavailable: (id: string) => void
  attach: (kind: 'file' | 'screen') => Promise<void>
  submit: () => Promise<void>
  loading: boolean
  sending: boolean
  error: string | null
}
export function useComposer(
  chatId: string,
  busy: boolean,
  onSend: (text: string, attachments: string[]) => Promise<void>
): ComposerState {
  const [text, setText] = useState(() => drafts.get(chatId)?.text ?? '')
  const [attachments, setAttachments] = useState<ChatAttachment[]>(
    () => drafts.get(chatId)?.attachments ?? []
  )
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const reset = (id: string): void => {
      if (id !== chatId) return
      setText('')
      setAttachments([])
      setError(null)
    }
    cleared.add(reset)
    return () => {
      cleared.delete(reset)
    }
  }, [chatId])
  useEffect(() => {
    let alive = true
    for (const attachment of drafts.get(chatId)?.attachments ?? []) {
      void loadPreview(attachment.id).catch(() => {
        if (!alive) return
        setAttachments((current) => current.filter((item) => item.id !== attachment.id))
        setError('An attachment is no longer available. Attach the file again before sending.')
      })
    }
    return () => {
      alive = false
    }
  }, [chatId])
  useEffect(() => {
    if (text || attachments.length) drafts.set(chatId, { text, attachments })
    else drafts.delete(chatId)
  }, [chatId, text, attachments])
  const attach = async (kind: 'file' | 'screen'): Promise<void> => {
    if (loading || attachments.length >= 4) return
    setLoading(true)
    setError(null)
    try {
      const incoming =
        kind === 'file'
          ? await window.api.attachments.pick()
          : [await window.api.attachments.screenshot()]
      setAttachments((current) => [...current, ...incoming].slice(0, 4))
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }
  const submit = async (): Promise<void> => {
    if ((!text.trim() && !attachments.length) || busy || sending || loading) return
    const original = { text, attachments }
    setSending(true)
    setError(null)
    setText('')
    setAttachments([])
    try {
      await onSend(
        original.text.trim(),
        original.attachments.map((attachment) => attachment.id)
      )
    } catch (error) {
      setError(errorMessage(error))
      setText(original.text)
      setAttachments(original.attachments)
    } finally {
      setSending(false)
    }
  }
  return {
    text,
    setText,
    attachments,
    remove: (id: string) =>
      setAttachments((current) => current.filter((attachment) => attachment.id !== id)),
    unavailable: (id: string) => {
      setAttachments((current) => current.filter((attachment) => attachment.id !== id))
      setError('An attachment could not be previewed. Attach the file again before sending.')
    },
    attach,
    submit,
    loading,
    sending,
    error
  }
}
