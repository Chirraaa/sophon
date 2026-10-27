import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import { cn } from '@/lib/utils'
function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportProps,
  contentClassName,
  contentProps,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string
  viewportProps?: ScrollAreaPrimitive.Viewport.Props
  contentClassName?: string
  contentProps?: ScrollAreaPrimitive.Content.Props
  orientation?: 'vertical' | 'horizontal' | 'both'
}): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn(
        'group/scroll-area relative flex min-h-0 min-w-0 flex-col overflow-hidden',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        {...viewportProps}
        className={cn(
          'min-h-0 w-full flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1',
          viewportClassName,
          viewportProps?.className
        )}
      >
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          {...contentProps}
          className={cn('flow-root', contentClassName, contentProps?.className)}
          style={{ minWidth: '100%', ...contentProps?.style }}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' && <ScrollBar />}
      {orientation !== 'vertical' && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'z-10 flex touch-none p-0.5 select-none opacity-0 transition-opacity duration-150 group-focus-within/scroll-area:opacity-100 data-hovering:opacity-100 data-scrolling:opacity-100 data-horizontal:h-2.5 data-horizontal:flex-col data-vertical:w-2.5',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/35 transition-colors hover:bg-muted-foreground/55 active:bg-muted-foreground/65"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}
export { ScrollArea, ScrollBar }
