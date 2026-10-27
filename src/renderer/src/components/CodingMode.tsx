import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export function CodingMode({
  value,
  disabled
}: {
  value: AppSettings['coding']['mode']
  disabled: boolean
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <div>
      <Select
        value={value}
        disabled={disabled || saving}
        onValueChange={(mode) => {
          if (mode !== 'auto' && mode !== 'ask-before-edit') return
          setSaving(true)
          setError('')
          void window.api
            .updateSettings({ coding: { mode } })
            .then((result) => {
              if (!result.ok) setError(result.error ?? 'Could not save coding mode.')
            })
            .catch((reason: Error) => setError(reason.message))
            .finally(() => setSaving(false))
        }}
      >
        <SelectTrigger size="sm" aria-label="Coding mode" className="text-xs text-muted-foreground">
          <SelectValue>{value === 'auto' ? 'Auto' : 'Ask before edit'}</SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-40">
          <SelectItem value="auto">Auto</SelectItem>
          <SelectItem value="ask-before-edit">Ask before edit</SelectItem>
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
