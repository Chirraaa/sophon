import { useId, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { RowLabel } from './fields/context'
export { TextField, TextArea, NumberField } from './fields/text'
export { Toggle, Segmented, SelectField, Slider } from './fields/choices'
export { ChipList } from './fields/chips'
export function Section({
  title,
  description,
  children,
  collapsible = false
}: {
  title: string
  description?: string
  children: ReactNode
  collapsible?: boolean
}): React.JSX.Element {
  if (collapsible)
    return (
      <Collapsible className="rounded-2xl border border-border bg-card">
        <CollapsibleTrigger
          showIndicator={false}
          render={<Button variant="ghost" />}
          className="group h-auto w-full justify-between gap-3 rounded-2xl p-5 text-left whitespace-normal"
        >
          <span className="space-y-1.5">
            <span className="block text-[13px] font-medium">{title}</span>
            {description && (
              <span className="block text-[11px] font-normal leading-relaxed text-muted-foreground">
                {description}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-aria-expanded:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-5 pb-3">{children}</CollapsibleContent>
      </Collapsible>
    )
  return (
    <Card className="gap-0 rounded-2xl border border-border bg-card py-0 shadow-[0_4px_20px_-12px_#00000040] ring-0">
      <CardHeader className="gap-1.5 px-5 pt-5 pb-0">
        <h3 className="text-[13px] font-medium tracking-tight">{title}</h3>
        {description && (
          <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </CardHeader>
      <CardContent className="mt-3 px-5 pb-3 [&>[data-setting-row]+[data-setting-row]]:border-t [&>[data-setting-row]+[data-setting-row]]:border-white/5">
        {children}
      </CardContent>
    </Card>
  )
}
export function Row({
  label,
  hint,
  stack,
  children
}: {
  label: string
  hint?: string
  stack?: boolean
  children: ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <RowLabel.Provider value={id}>
      <div
        data-setting-row
        className={cn(
          'flex gap-4 py-4',
          stack
            ? 'flex-col'
            : 'items-center justify-between max-[1000px]:flex-col max-[1000px]:items-start'
        )}
      >
        <div className="min-w-0 flex-1">
          <div id={id} className="text-xs leading-relaxed">
            {label}
          </div>
          {hint && (
            <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {hint}
            </p>
          )}
        </div>
        <div
          role="group"
          aria-labelledby={id}
          className={cn('min-w-0 max-w-full', stack ? 'w-full' : 'shrink-0')}
        >
          {children}
        </div>
      </div>
    </RowLabel.Provider>
  )
}
export function PillButton({
  tone,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  tone?: 'danger'
}): React.JSX.Element {
  return (
    <Button
      variant={tone === 'danger' ? 'destructive' : 'outline'}
      size="sm"
      {...props}
      className={cn('no-drag h-8 rounded-lg px-3 text-[11px] font-normal', className)}
    />
  )
}
export function Notice({
  tone,
  children
}: {
  tone?: 'warn'
  children: ReactNode
}): React.JSX.Element {
  return (
    <Alert
      role="note"
      className={cn(
        'rounded-xl px-3.5 py-3 text-[11px] leading-relaxed',
        tone === 'warn'
          ? 'border-amber-300/15 bg-amber-300/5 text-amber-200'
          : 'border-white/7 bg-white/3 text-muted-foreground'
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0 opacity-70" strokeWidth={1.5} />
      <AlertDescription className="text-[11px] text-inherit">{children}</AlertDescription>
    </Alert>
  )
}
