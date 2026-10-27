import { Progress as Primitive } from '@base-ui/react/progress'
import { cn } from '@/lib/utils'

function Progress({
  className,
  indicatorClassName,
  ...props
}: Primitive.Root.Props & {
  indicatorClassName?: string
}): React.JSX.Element {
  return (
    <Primitive.Root data-slot="progress" className={cn('w-full', className)} {...props}>
      <Primitive.Track
        data-slot="progress-track"
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <Primitive.Indicator
          data-slot="progress-indicator"
          className={cn('h-full rounded-full bg-primary transition-[width]', indicatorClassName)}
        />
      </Primitive.Track>
    </Primitive.Root>
  )
}

export { Progress }
