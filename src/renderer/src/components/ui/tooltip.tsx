'use client'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'
import type { ReactElement } from 'react'
function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props): React.JSX.Element {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}
function Tooltip({ ...props }: TooltipPrimitive.Root.Props): React.JSX.Element {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}
function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props): React.JSX.Element {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}
function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset'
  >): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'popup-surface z-50 inline-flex w-fit max-w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] duration-150 has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}
function Hint({ children, text }: { children: ReactElement; text?: string }): React.JSX.Element {
  if (!text) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint }
