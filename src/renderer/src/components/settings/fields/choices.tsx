import { useContext } from 'react'
import { cn } from '@/lib/utils'
import { useLocalValue } from '@/hooks/useLocalValue'
import { Switch } from '@/components/ui/switch'
import { Slider as SliderControl } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { RowLabel, inputClass, type Option } from './context'
export function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const label = useContext(RowLabel)
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      aria-labelledby={label}
      className="no-drag"
    />
  )
}
export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
}): React.JSX.Element {
  const label = useContext(RowLabel)
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(values) => {
        if (values[0]) onChange(values[0] as T)
      }}
      aria-labelledby={label}
      spacing={1}
      className="max-w-full flex-wrap rounded-lg border border-border bg-background/40 p-1"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="no-drag h-7 min-w-0 rounded-md px-2.5 text-[11px] font-normal text-muted-foreground transition-[background-color,color,box-shadow] duration-200 data-pressed:bg-muted data-pressed:text-foreground data-pressed:shadow-sm"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
export function SelectField({
  value,
  options,
  onChange,
  width = 'w-48'
}: {
  value: string
  options: Option<string>[]
  onChange: (value: string) => void
  width?: string
}): React.JSX.Element {
  const label = useContext(RowLabel)
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger aria-labelledby={label} className={cn(inputClass, 'max-w-full', width)}>
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end" className="p-1 shadow-xl">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="py-2 text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export function Slider({
  value,
  min,
  max,
  step,
  format,
  onCommit
}: {
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onCommit: (value: number) => void
}): React.JSX.Element {
  const field = useLocalValue(value, onCommit)
  const label = useContext(RowLabel)
  return (
    <div className="flex w-44 max-w-full items-center gap-3">
      <SliderControl
        value={[field.value]}
        min={min}
        max={max}
        step={step}
        thumbProps={{
          'aria-labelledby': label,
          getAriaValueText: (_formatted, next) => format(next)
        }}
        onValueChange={(next) => field.setValue(Array.isArray(next) ? next[0] : next)}
        onValueCommitted={(next) => field.commitValue(Array.isArray(next) ? next[0] : next)}
        className="no-drag flex-1 py-2"
      />
      <output className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">
        {format(field.value)}
      </output>
    </div>
  )
}
