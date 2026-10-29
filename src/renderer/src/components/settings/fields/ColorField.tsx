import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export function ColorField({
  value,
  onCommit,
  label
}: {
  value: string
  onCommit: (value: string) => void
  label: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const valid = /^#[0-9a-f]{6}$/i.test(draft)
  const preview = valid ? draft : value
  const channels = [1, 3, 5].map((offset) => parseInt(preview.slice(offset, offset + 2), 16))
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        onClick={() => {
          setDraft(value)
          setOpen(true)
        }}
        className="gap-2 text-xs"
      >
        <span className="size-4 rounded border border-input" style={{ background: value }} />
        Custom
      </Button>
      <DialogContent closeLabel="Cancel color selection" className="max-w-sm gap-5">
        <div className="pr-7">
          <DialogTitle className="text-sm font-medium">{label}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">
            Adjust the color, then apply your choice.
          </DialogDescription>
        </div>
        <div className="h-16 rounded-xl border border-border" style={{ background: preview }} />
        {['Red', 'Green', 'Blue'].map((channel, index) => (
          <div key={channel} className="flex items-center gap-3 text-xs">
            <span className="w-10">{channel}</span>
            <Slider
              value={[channels[index]]}
              min={0}
              max={255}
              step={1}
              thumbProps={{ 'aria-label': `${label} ${channel.toLowerCase()}` }}
              onValueChange={(next) => {
                const rgb = [...channels]
                rgb[index] = Array.isArray(next) ? next[0] : next
                setDraft('#' + rgb.map((part) => part.toString(16).padStart(2, '0')).join(''))
              }}
              className="flex-1 py-2"
            />
            <output className="w-6 text-right tabular-nums">{channels[index]}</output>
          </div>
        ))}
        <Input
          aria-label={`${label} hex`}
          aria-invalid={!valid}
          value={draft}
          maxLength={7}
          onChange={(event) => setDraft(event.target.value)}
          className="font-mono text-xs"
        />
        {!valid && (
          <p role="alert" className="text-xs text-destructive">
            Use six hex digits, such as #a78bfa.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!valid}
            onClick={() => {
              if (!valid) return
              if (draft.toLowerCase() !== value.toLowerCase()) onCommit(draft.toLowerCase())
              setOpen(false)
            }}
          >
            Apply color
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
