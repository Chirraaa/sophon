import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'

export function PermissionReview(): React.JSX.Element | null {
  const [review, setReview] = useState<ConsentReview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const cancel = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    let changed = false
    let mounted = true
    const detach = window.api.consent.onChange((next) => {
      changed = true
      inFlight.current = false
      setPending(false)
      setError('')
      setReview(next)
    })
    void window.api.consent
      .read()
      .then((next) => {
        if (mounted && !changed) setReview(next)
      })
      .catch(() => {})
    return () => {
      mounted = false
      detach()
    }
  }, [])
  const decide = async (allow: boolean): Promise<void> => {
    if (!review || inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      await window.api.consent.resolve(review.id, allow)
    } catch {
      setError('This request could not be confirmed. Try again or cancel.')
      inFlight.current = false
      setPending(false)
    }
  }
  if (!review) return null
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) void decide(false)
      }}
    >
      <AlertDialogContent
        initialFocus={cancel}
        aria-busy={pending}
        className="min-w-0 gap-4 data-[size=default]:max-w-md [&>*]:min-w-0"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{review.title}</AlertDialogTitle>
          <AlertDialogDescription>{review.summary}</AlertDialogDescription>
        </AlertDialogHeader>
        {!!review.changes.length && (
          <ul
            aria-label="Permission changes"
            className="divide-y divide-border overflow-hidden rounded-xl border border-border"
          >
            {review.changes.map((change, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-4 px-3 py-2.5 text-xs"
              >
                <span className="font-medium">{change.label}</span>
                <span className="text-right text-muted-foreground">
                  {change.before}
                  <span aria-hidden="true" className="mx-2">
                    →
                  </span>
                  <span className="text-foreground">{change.after}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Collapsible defaultOpen={review.showDetails} className="text-xs text-muted-foreground">
          <CollapsibleTrigger className="cursor-pointer">View complete request</CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="mt-3 max-h-48 rounded-lg bg-muted/40" orientation="both">
              <pre className="p-3 text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                {review.detail}
              </pre>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancel}
            disabled={pending}
            onClick={() => void decide(false)}
            value="cancel"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => void decide(true)} value="allow">
            {pending ? 'Saving…' : review.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
