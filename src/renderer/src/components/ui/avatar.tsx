import { Avatar as Primitive } from '@base-ui/react/avatar'
import { cn } from '@/lib/utils'

function Avatar({ className, ...props }: Primitive.Root.Props): React.JSX.Element {
  return (
    <Primitive.Root
      data-slot="avatar"
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
        className
      )}
      {...props}
    />
  )
}
function AvatarImage({ className, ...props }: Primitive.Image.Props): React.JSX.Element {
  return (
    <Primitive.Image
      data-slot="avatar-image"
      className={cn('size-full object-cover', className)}
      {...props}
    />
  )
}
function AvatarFallback({ className, ...props }: Primitive.Fallback.Props): React.JSX.Element {
  return (
    <Primitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-xs text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}
export { Avatar, AvatarImage, AvatarFallback }
