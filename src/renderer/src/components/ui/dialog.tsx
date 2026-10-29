import { Dialog as Primitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

export const Dialog = Primitive.Root
export const DialogTrigger = Primitive.Trigger
export const DialogTitle = Primitive.Title
export const DialogDescription = Primitive.Description
export const DialogClose = Primitive.Close
export function DialogContent({
  children,
  className,
  closeLabel = 'Close coding details',
  showCloseButton = true,
  ...props
}: Primitive.Popup.Props & { closeLabel?: string; showCloseButton?: boolean }): React.JSX.Element {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="popup-backdrop fixed inset-0 z-50 motion-safe:data-open:animate-in data-open:fade-in-0" />
      <Primitive.Popup
        {...props}
        data-slot="dialog-content"
        className={cn(
          'popup-surface fixed top-1/2 left-[var(--popup-center-x,50%)] z-50 flex max-h-[min(var(--popup-max-height,100dvh),calc(100dvh-3rem))] w-[calc(100%-3rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl p-5 outline-none motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
          className
        )}
      >
        {children}
        {showCloseButton && (
          <Primitive.Close
            render={<Button variant="ghost" size="icon-sm" />}
            aria-label={closeLabel}
            className="absolute top-3 right-3 text-muted-foreground"
          >
            <X className="size-4" />
          </Primitive.Close>
        )}
      </Primitive.Popup>
    </Primitive.Portal>
  )
}
