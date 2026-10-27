import { useEffect, useState } from 'react'
import { useVisualFrame } from '@/hooks/useVisualFrame'
import { Button } from '@/components/ui/button'
import { VisualPanel } from './VisualPanel'
import { VisualLoading } from './VisualLoading'
import { DialogClose } from '@/components/ui/dialog'

function ActiveVisual({
  source,
  onAsk,
  resource: visual
}: {
  source: string
  onAsk?: (question: string) => void
  resource: { id: string; url: string }
}): React.JSX.Element {
  const { frame, resource, title, height, error, question, setQuestion, setError } =
    useVisualFrame(visual)
  const [revision, setRevision] = useState(0)
  const [stopped, setStopped] = useState(false)
  return (
    <div>
      <VisualPanel
        title={title}
        source={source}
        error={error}
        onAsk={onAsk}
        onReset={() => {
          setError(null)
          setStopped(false)
          setQuestion(null)
          setRevision((value) => value + 1)
        }}
        onSave={
          resource
            ? () => {
                void window.api.visuals
                  .save(resource!.id)
                  .catch((error: Error) => setError(error.message))
              }
            : undefined
        }
        preview={
          resource && !stopped ? (
            <iframe
              key={revision}
              ref={frame}
              src={resource.url}
              title={title}
              sandbox="allow-scripts"
              allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
              referrerPolicy="no-referrer"
              className="block w-full border-0"
              style={{ height: height }}
            />
          ) : (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              {error ? 'Use the source view to inspect the response.' : 'Visual paused.'}
            </p>
          )
        }
        footer={
          resource && (
            <>
              <div className="border-t border-white/8 px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => setStopped((value) => !value)}>
                  {stopped ? 'Resume visual' : 'Stop visual'}
                </Button>
              </div>
              {question && onAsk && (
                <div className="flex items-center gap-2 border-t border-white/8 px-3 py-2">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">{question}</p>
                  <DialogClose
                    render={<Button size="sm" />}
                    onClick={() => {
                      onAsk(question!)
                      setQuestion(null)
                    }}
                  >
                    Ask Sophon
                  </DialogClose>
                  <Button variant="ghost" size="sm" onClick={() => setQuestion(null)}>
                    Dismiss
                  </Button>
                </div>
              )}
            </>
          )
        }
      />
    </div>
  )
}
export function InteractiveVisual(props: {
  source: string
  onAsk?: (question: string) => void
}): React.JSX.Element {
  const [resource, setResource] = useState<{ id: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const incomplete = /<html[\s>]/i.test(props.source) && !/<\/html\s*>\s*$/i.test(props.source)
  useEffect(() => {
    if (incomplete) return
    let disposed = false
    let created: { id: string; url: string } | null = null
    void window.api.visuals
      .create(props.source)
      .then((value) => {
        if (disposed) {
          if (value) void window.api.visuals.release(value.id).catch(() => undefined)
        } else {
          created = value
          setResource(value)
        }
      })
      .catch((error: Error) => {
        if (!disposed) setError(error.message)
      })
    return () => {
      disposed = true
      if (created) void window.api.visuals.release(created.id).catch(() => undefined)
    }
  }, [props.source, incomplete])
  if (resource) return <ActiveVisual {...props} resource={resource} />
  if (!incomplete && !error) return <VisualLoading />
  return (
    <VisualPanel
      title="Visual"
      source={props.source}
      error={
        incomplete
          ? 'The model stopped before finishing this visual. Ask it to complete the HTML document.'
          : error
      }
      onAsk={props.onAsk}
      preview={
        <p role="status" className="p-4 text-xs text-muted-foreground">
          {incomplete || error
            ? 'Use the source view to inspect the response.'
            : 'Preparing visual…'}
        </p>
      }
    />
  )
}
