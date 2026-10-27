import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { PillButton, Row } from './controls'

export function ModelKeyField({
  provider,
  endpoint,
  onSaved
}: {
  provider: ModelProvider
  endpoint: string
  onSaved: () => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let alive = true
    void window.api.modelCredentials
      .hasKey(provider, endpoint)
      .then((value) => {
        if (alive) setHasKey(value)
      })
      .catch((reason) => {
        if (alive) setError(reason.message)
      })
    return () => {
      alive = false
    }
  }, [provider, endpoint])
  const commit = (value: string): void => {
    setSaving(true)
    setError('')
    void window.api.modelCredentials
      .setKey(provider, endpoint, value)
      .then(() => {
        setKey('')
        setHasKey(Boolean(value))
        onSaved()
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setSaving(false))
  }
  return (
    <Row
      label="Model API key"
      hint={
        hasKey
          ? 'Stored with Windows credential encryption for this provider and address.'
          : 'Add an API key for this provider and address.'
      }
      stack
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          aria-label="Model API key"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="Enter your API key"
          className="h-9 w-64 max-w-full bg-background/30 text-xs shadow-none"
        />
        <PillButton
          disabled={saving}
          onClick={() => {
            if (!key) {
              setError('Enter an API key first.')
              return
            }
            commit(key)
          }}
        >
          Save key
        </PillButton>
        {hasKey && (
          <PillButton disabled={saving} onClick={() => commit('')}>
            Delete key
          </PillButton>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </Row>
  )
}
