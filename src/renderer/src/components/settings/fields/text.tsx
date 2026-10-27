import { useContext, useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLocalValue } from '@/hooks/useLocalValue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RowLabel, inputClass } from './context'
export function TextField({
  value,
  onCommit,
  validate,
  mono,
  width = 'w-64',
  placeholder
}: {
  value: string
  onCommit: (value: string) => void
  validate?: (value: string) => string | null
  mono?: boolean
  width?: string
  placeholder?: string
}): React.JSX.Element {
  const field = useLocalValue(value, onCommit)
  const [error, setError] = useState<string | null>(null)
  const label = useContext(RowLabel)
  const errorId = useId()
  const commit = (): void => {
    const message = validate?.(field.value) ?? null
    setError(message)
    if (!message) field.commit()
  }
  return (
    <div className={cn('min-w-0 max-w-full', width)}>
      <Input
        value={field.value}
        placeholder={placeholder}
        aria-labelledby={label}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={cn(inputClass, mono && 'font-mono text-[11px]')}
        onChange={(event) => {
          field.setValue(event.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            field.cancel()
            setError(null)
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
export function TextArea({
  value,
  onCommit,
  field: supplied,
  ...props
}: {
  value: string
  onCommit: (value: string) => void
  field?: ReturnType<typeof useLocalValue<string>>
  rows?: number
  maxLength?: number
  placeholder?: string
}): React.JSX.Element {
  const local = useLocalValue(value, onCommit)
  const field = supplied ?? local
  const label = useContext(RowLabel)
  return (
    <Textarea
      {...props}
      value={field.value}
      aria-labelledby={label}
      aria-label={label ? undefined : (props.placeholder ?? 'Instructions')}
      onChange={(event) => field.setValue(event.target.value)}
      onBlur={field.commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          field.cancel()
        }
      }}
      className={cn(inputClass, 'selectable h-auto w-full resize-y py-3 text-xs leading-relaxed')}
    />
  )
}
export function NumberField({
  value,
  min,
  max,
  suffix,
  onCommit
}: {
  value: number
  min: number
  max: number
  suffix?: string
  onCommit: (value: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <TextField
        value={String(value)}
        width="w-20"
        validate={(next) =>
          next.trim() && Number.isFinite(Number(next)) && Number(next) >= min && Number(next) <= max
            ? null
            : `Enter a number from ${min} to ${max}.`
        }
        onCommit={(next) => onCommit(Math.round(Number(next)))}
      />
      {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
    </div>
  )
}
