import { useRef, useState } from 'react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose
} from '@/components/ui/popover'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clearDraft } from '@/hooks/useComposer'

export function DeleteChatPopover({
  id,
  title,
  disabled
}: {
  id: string
  title: string
  disabled: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const remove = async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await window.api.chats.delete(id)
      clearDraft(id)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this chat.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  return (
    <Popover
      open={open}
      modal="trap-focus"
      onOpenChange={(next) => {
        if (inFlight.current) return
        setError('')
        setOpen(next)
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={'Delete ' + title}
        render={<Button variant="ghost" size="icon-xs" />}
      >
        <Trash2 className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
        role="alertdialog"
        initialFocus={cancel}
        aria-busy={pending}
      >
        <PopoverTitle className="text-sm font-medium">Delete this chat?</PopoverTitle>
        <PopoverDescription className="text-xs leading-relaxed break-words text-muted-foreground">
          <span className="font-medium text-foreground">{title}</span> will be removed from Sophon.
          This cannot be undone.
        </PopoverDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <PopoverClose
            ref={cancel}
            disabled={pending}
            data-slot="alert-dialog-cancel"
            render={<Button variant="outline" size="sm" />}
          >
            Keep chat
          </PopoverClose>
          <Button
            variant="destructive"
            size="sm"
            data-slot="alert-dialog-action"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending ? 'Deleting…' : 'Delete chat'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
