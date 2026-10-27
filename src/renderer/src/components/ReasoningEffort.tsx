import { useState } from 'react'
import {
  EFFORT_LABELS,
  REASONING_EFFORTS,
  supportedEffort
} from '../../../shared/model-capabilities'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

export function ReasoningEffort({
  value,
  model,
  disabled = false
}: {
  value: AppSettings['model']['reasoningEffort']
  model?: ModelChoice
  disabled?: boolean
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = supportedEffort(value, model ?? {}) ?? 'auto'
  const options = [
    'auto' as const,
    ...REASONING_EFFORTS.filter((effort) => model?.reasoningEfforts?.includes(effort))
  ]
  const hint = model?.reasoningSource
    ? `Available for ${model.label}. Higher effort uses more reasoning and may take longer.${model.defaultReasoningEffort ? ' Auto: ' + EFFORT_LABELS[model.defaultReasoningEffort] + '.' : ''}`
    : 'This model has not advertised reasoning levels. Auto uses its default.'
  return (
    <div>
      <Select
        value={selected}
        disabled={disabled || saving}
        onValueChange={(next) => {
          if (!options.includes(next as typeof selected)) return
          setSaving(true)
          setError('')
          void window.api
            .updateSettings({
              model: { reasoningEffort: next as AppSettings['model']['reasoningEffort'] }
            })
            .then((result) => {
              if (!result.ok) setError(result.error ?? 'Could not save reasoning effort.')
            })
            .catch((reason: Error) => setError(reason.message))
            .finally(() => setSaving(false))
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Reasoning effort"
          title={hint}
          className="text-xs text-muted-foreground"
        >
          <SelectValue>{EFFORT_LABELS[selected]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {EFFORT_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value !== 'auto' && selected === 'auto' && (
        <p className="mt-1 text-xs text-muted-foreground">Saved effort unavailable; using Auto.</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
