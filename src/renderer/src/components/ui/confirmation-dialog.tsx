import { useRef, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './alert-dialog'

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel: string
  pendingLabel: string
  onConfirm: () => Promise<unknown>
}): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const confirm = async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (inFlight.current) return
        setError('')
        onOpenChange(next)
      }}
    >
      <AlertDialogContent initialFocus={cancel} aria-busy={pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-xs leading-relaxed break-words text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel} disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
