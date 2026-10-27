import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { inputClass } from './context'
export function ChipList({
  items,
  onChange,
  placeholder
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const next = draft.trim().slice(0, 80)
    if (!next || items.length >= 60) return
    if (!items.some((item) => item.toLowerCase() === next.toLowerCase())) onChange([...items, next])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-3 pb-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="flex items-center gap-2 rounded-lg border border-white/7 bg-white/4 py-1 pr-1 pl-2.5 text-[11px]"
            >
              {item}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((next) => next !== item))}
                className="size-5 text-muted-foreground"
              >
                <X className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Input
          value={draft}
          placeholder={placeholder}
          maxLength={80}
          aria-label={placeholder ?? 'App or window name'}
          onChange={(event) => setDraft(event.target.value)}
          className={cn(inputClass, 'min-w-0 flex-1')}
        />
        <Button
          variant="outline"
          size="sm"
          type="submit"
          disabled={!draft.trim() || items.length >= 60}
        >
          <Plus className="size-3" /> Add
        </Button>
      </form>
    </div>
  )
}
