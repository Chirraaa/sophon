import { ScrollArea } from '@/components/ui/scroll-area'
import { useRef, useState, type ReactNode } from 'react'
import { Code2, Download, Maximize2, Minimize2, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from './CopyButton'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export function VisualPanel({
  title,
  source,
  preview,
  footer,
  error,
  onSave,
  onReset,
  onAsk
}: {
  title: string
  source: string
  preview: ReactNode
  footer?: ReactNode
  error?: string | null
  onSave?: () => void
  onReset?: () => void
  onAsk?: (question: string) => void
}): React.JSX.Element {
  const [code, setCode] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const expandedDialog = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLElement>(null)
  const content = (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-card text-left"
      data-visual-panel
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
          {title}
        </span>
        <div className="flex shrink-0 gap-0.5">
          <CopyButton text={source} label="Copy visual source" />
          <Button
            variant="ghost"
            size="icon-xs"
            title={code ? 'Preview visual' : 'View source'}
            aria-label={code ? 'Preview visual' : 'View source'}
            onClick={() => setCode(!code)}
          >
            {code ? <Play /> : <Code2 />}
          </Button>
          {onReset && (
            <Button
              variant="ghost"
              size="icon-xs"
              title="Reset visual"
              aria-label="Reset visual"
              onClick={onReset}
            >
              <RotateCcw />
            </Button>
          )}
          {onSave && (
            <Button
              variant="ghost"
              size="icon-xs"
              title="Save visual"
              aria-label="Save visual"
              onClick={onSave}
            >
              <Download />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            title={expanded ? 'Close expanded visual' : 'Expand visual'}
            aria-label={expanded ? 'Close expanded visual' : 'Expand visual'}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="space-y-2 border-b border-border px-4 py-3 text-xs text-muted-foreground"
        >
          <p>This visual needs a correction.</p>
          <p className="break-words font-mono text-[11px]">{error}</p>
          {onAsk && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setExpanded(false)
                onAsk(
                  'Fix this visual. Error: ' +
                    error +
                    '. Return the complete corrected visual, not a patch. Source:\n\n' +
                    source
                )
              }}
            >
              Ask Sophon to fix it
            </Button>
          )}
        </div>
      )}
      <div className={code ? '' : 'hidden'}>
        <ScrollArea className="max-h-[65vh]" orientation="both">
          <pre className="selectable p-4 text-xs leading-5 whitespace-pre-wrap">{source}</pre>
        </ScrollArea>
      </div>
      <ScrollArea className={code ? 'hidden' : ''} orientation="both">
        {preview}
      </ScrollArea>
      {footer}
    </div>
  )
  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <figure ref={figure} className="my-4 w-full min-w-0">
        {expanded && (
          <div className="rounded-xl border border-border p-6 text-xs text-muted-foreground">
            Visual open in expanded view.
          </div>
        )}
        {!expanded && content}
        <DialogContent
          ref={expandedDialog}
          initialFocus={expandedDialog}
          finalFocus={() =>
            figure.current?.querySelector<HTMLButtonElement>('[aria-label="Expand visual"]') ??
            false
          }
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[1100px] p-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <ScrollArea className="max-h-[calc(100dvh-2rem-2px)]" contentClassName="p-2">
            {content}
          </ScrollArea>
        </DialogContent>
      </figure>
    </Dialog>
  )
}
