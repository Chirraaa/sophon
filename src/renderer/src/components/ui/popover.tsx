import { Popover as Primitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverClose = Primitive.Close
export const PopoverTitle = Primitive.Title
export const PopoverDescription = Primitive.Description

export function PopoverContent({
  className,
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  collisionPadding = 12,
  collisionAvoidance,
  ...props
}: Primitive.Popup.Props &
  Pick<
    Primitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'collisionPadding' | 'collisionAvoidance'
  >): React.JSX.Element {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        collisionAvoidance={collisionAvoidance}
        className="z-50"
      >
        <Primitive.Popup
          data-slot="popover-content"
          className={cn(
            'popup-surface grid w-72 max-w-[calc(100vw-24px)] gap-3 rounded-xl p-4 outline-none',
            className
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}
