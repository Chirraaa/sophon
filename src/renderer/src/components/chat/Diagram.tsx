import { useEffect, useState } from 'react'
import { VisualPanel } from './VisualPanel'
export function Diagram({
  source,
  onAsk
}: {
  source: string
  onAsk?: (question: string) => void
}): React.JSX.Element {
  const [resource, setResource] = useState<{ id: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let id: string | undefined
    void window.api.visuals
      .diagram(source)
      .then((value) => {
        id = value.id
        if (alive) setResource(value)
        else void window.api.visuals.release(value.id)
      })
      .catch((error: Error) => {
        if (alive) setError(error.message)
      })
    return () => {
      alive = false
      if (id) void window.api.visuals.release(id)
    }
  }, [source])
  return (
    <VisualPanel
      title="Diagram"
      source={source}
      error={error}
      onAsk={onAsk}
      onSave={
        resource
          ? () =>
              void window.api.visuals
                .save(resource.id)
                .catch((error: Error) => setError(error.message))
          : undefined
      }
      preview={
        resource ? (
          <iframe
            src={resource.url}
            title="Diagram generated from the conversation"
            sandbox=""
            referrerPolicy="no-referrer"
            className="block h-80 w-full border-0"
          />
        ) : (
          <p role="status" className="p-4 text-xs text-muted-foreground">
            {error ?? 'Drawing diagram in an isolated process...'}
          </p>
        )
      }
    />
  )
}
