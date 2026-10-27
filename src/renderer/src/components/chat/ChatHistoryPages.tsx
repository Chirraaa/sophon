import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef, useState } from 'react'
import { Message } from '../Message'
import { Button } from '../ui/button'

export function ChatHistoryPages({
  chatId,
  before
}: {
  chatId: string
  before: number
}): React.JSX.Element {
  const [page, setPage] = useState<{ items: ChatItem[]; start: number; total: number }>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const revision = useRef(0)
  useEffect(
    () => () => {
      revision.current++
    },
    []
  )
  const load = async (end: number): Promise<void> => {
    const expected = ++revision.current
    setLoading(true)
    setError('')
    try {
      const next = await window.api.getChatPage(chatId, end)
      if (revision.current === expected) setPage(next)
    } catch (failure) {
      if (revision.current === expected) setError((failure as Error).message)
    } finally {
      if (revision.current === expected) setLoading(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || page?.start === 0}
          onClick={() => void load(page?.start ?? before)}
        >
          Earlier messages
        </Button>
        {page && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading || page.start + page.items.length >= before}
              onClick={() => void load(Math.min(before, page.start + 120))}
            >
              Newer messages
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                revision.current++
                setLoading(false)
                setPage(undefined)
              }}
            >
              Close history
            </Button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {page && (
        <ScrollArea
          className="max-h-[65vh] rounded-xl border border-border"
          orientation="both"
          contentClassName="space-y-6 p-4"
        >
          <p className="text-xs text-muted-foreground">
            Messages {page.start + 1}–{page.start + page.items.length}
          </p>
          {page.items.map((item) => (
            <Message key={item.id} item={item} dockQuestions />
          ))}
        </ScrollArea>
      )}
    </div>
  )
}
