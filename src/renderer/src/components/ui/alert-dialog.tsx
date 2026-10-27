'use client'
import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from './scroll-area'
function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props): React.JSX.Element {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}
function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props): React.JSX.Element {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}
function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props): React.JSX.Element {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}
function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        'popup-backdrop fixed inset-0 isolate z-50 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className
      )}
      {...props}
    />
  )
}
function AlertDialogContent({
  className,
  children,
  size = 'default',
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: 'default' | 'sm'
}): React.JSX.Element {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          'popup-surface group/alert-dialog-content fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl duration-150 outline-none data-[size=default]:max-w-md data-[size=sm]:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className
        )}
        {...props}
      >
        <ScrollArea contentClassName="grid gap-5 p-6" viewportClassName="overscroll-contain">
          {children}
        </ScrollArea>
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  )
}
function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('grid gap-2 text-left', className)}
      {...props}
    />
  )
}
function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        'flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end *:data-[slot=alert-dialog-action]:h-9 *:data-[slot=alert-dialog-action]:px-4 *:data-[slot=alert-dialog-cancel]:h-9 *:data-[slot=alert-dialog-cancel]:px-4',
        className
      )}
      {...props}
    />
  )
}
function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  )
}
function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        'font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
        className
      )}
      {...props}
    />
  )
}
function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        'text-[13px] leading-relaxed break-words text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}
function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>): React.JSX.Element {
  return <Button data-slot="alert-dialog-action" className={cn(className)} {...props} />
}
function AlertDialogCancel({
  className,
  variant = 'outline',
  size = 'default',
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger
}
