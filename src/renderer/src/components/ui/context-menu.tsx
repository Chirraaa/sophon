import { ContextMenu as Primitive } from '@base-ui/react/context-menu'
import { cn } from '@/lib/utils'

export const ContextMenu = Primitive.Root
export const ContextMenuTrigger = Primitive.Trigger

export function ContextMenuContent({
  className,
  ...props
}: Primitive.Popup.Props): React.JSX.Element {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
        <Primitive.Popup
          data-slot="context-menu-content"
          className={cn('popup-surface min-w-48 rounded-lg p-1 outline-none', className)}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}

export function ContextMenuItem({ className, ...props }: Primitive.Item.Props): React.JSX.Element {
  return (
    <Primitive.Item
      data-slot="context-menu-item"
      className={cn(
        'flex cursor-default items-center justify-between gap-6 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
