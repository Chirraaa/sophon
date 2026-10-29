import { Layers } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Hint } from '@/components/ui/tooltip'

const number = (value: number): string => Math.round(value).toLocaleString()

export function CompactionNotice({
  notice
}: {
  notice: ContextCompactionNotice
}): React.JSX.Element {
  const { info } = notice
  const label =
    notice.status === 'running'
      ? 'Compacting context to stay within the model window…'
      : notice.scope === 'task'
        ? 'Context compacted · coding task trimmed to its saved checkpoint'
        : info
          ? `Context compacted · ${number(info.messages)} earlier ${info.messages === 1 ? 'message' : 'messages'} ${info.method === 'model' ? 'summarized' : 'kept as excerpts'} (about ${number(info.beforeTokens)} → ${number(info.afterTokens)} tokens)`
          : 'Context compacted'
  const detail =
    notice.status === 'running'
      ? undefined
      : notice.scope === 'task'
        ? 'Older tool results were released; the assistant continues from the saved plan and re-reads files it needs.'
        : 'Earlier messages were replaced by a summary so the conversation fits the model context window. Details missing from the summary may need to be repeated or inspected again.'
  return (
    <Hint text={detail}>
      <p
        role="status"
        data-context-compaction-notice={notice.status}
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        {notice.status === 'running' ? (
          <Spinner className="size-3" aria-hidden="true" />
        ) : (
          <Layers className="size-3.5" aria-hidden="true" />
        )}
        <span>{label}</span>
      </p>
    </Hint>
  )
}
