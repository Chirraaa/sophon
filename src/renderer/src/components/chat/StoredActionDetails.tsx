import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useState } from 'react'
import { ActionPreview } from './ActionPreview'

export function StoredActionDetails({ action }: { action: ToolAction }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState<{ preview?: string; detail?: string }>()
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (open)
      void window.api.getActionDetails(action.id).then(
        (value) => {
          if (!cancelled) setDetails(value)
        },
        (failure: Error) => {
          if (!cancelled) setError(failure.message)
        }
      )
    return () => {
      cancelled = true
    }
  }, [open, action.id])
  return (
    <Collapsible
      onOpenChange={(open) => {
        setDetails(undefined)
        setError('')
        setOpen(open)
      }}
      className="mt-2 min-w-0 text-xs"
    >
      <CollapsibleTrigger className="cursor-pointer">Full action details</CollapsibleTrigger>
      <CollapsibleContent>
        {open && (
          <ScrollArea className="mt-2 max-h-96" orientation="both">
            {error ? (
              <p role="alert">{error}</p>
            ) : !details ? (
              <p>Loading details…</p>
            ) : (
              <>
                {details.preview && <ActionPreview preview={details.preview} />}
                {details.detail && (
                  <pre className="selectable whitespace-pre-wrap break-all">{details.detail}</pre>
                )}
              </>
            )}
          </ScrollArea>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
