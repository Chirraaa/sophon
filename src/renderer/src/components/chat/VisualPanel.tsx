import { ScrollArea } from '@/components/ui/scroll-area'
import { useRef, useState, type ReactNode } from 'react'
import { Code2, Download, Maximize2, Minimize2, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from './CopyButton'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
    <div className="group/visual relative text-left" data-visual-panel>
      <div
        role="toolbar"
        aria-label={title}
        className="absolute top-0 right-0 z-10 flex gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-focus-within/visual:opacity-100 group-hover/visual:opacity-100"
      >
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
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>This visual needs a correction.</AlertTitle>
          <AlertDescription className="space-y-2">
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
          </AlertDescription>
        </Alert>
      )}
      <div className={code ? '' : 'hidden'}>
        <ScrollArea className="max-h-[65vh] rounded-xl border border-border" orientation="both">
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
