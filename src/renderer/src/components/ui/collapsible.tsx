import { Collapsible as Primitive } from '@base-ui/react/collapsible'
import { ChevronRight } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

function Collapsible(props: Primitive.Root.Props): React.JSX.Element {
  return <Primitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  className,
  children,
  showIndicator = true,
  ...props
}: Primitive.Trigger.Props & { showIndicator?: boolean }): React.JSX.Element {
  return (
    <Primitive.Trigger
      data-slot="collapsible-trigger"
      render={<Button variant="ghost" />}
      className={cn(
        'group/collapsible-trigger h-auto max-w-full justify-start gap-2 rounded-md px-1 py-1 text-left text-xs font-normal whitespace-normal',
        className
      )}
      {...props}
    >
      {showIndicator && (
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-aria-expanded/collapsible-trigger:rotate-90"
        />
      )}
      {children}
    </Primitive.Trigger>
  )
}

function CollapsibleContent({ className, ...props }: Primitive.Panel.Props): React.JSX.Element {
  return (
    <Primitive.Panel
      data-slot="collapsible-content"
      className={cn('min-w-0', className)}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
