import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof LoaderCircle>): React.JSX.Element {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={cn('size-4 shrink-0 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
