import { useState } from 'react'
import { Notice, PillButton, Row, Section, SelectField } from './controls'
import { save } from './save'

export function PrivacySection({ settings }: { settings: AppSettings }): React.JSX.Element {
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const deleteDiagnostics = async (): Promise<void> => {
    setDeleting(true)
    setError('')
    setMessage('')
    try {
      const deleted = await window.api.clearSecurityEvents()
      setMessage(deleted ? 'Security diagnostics deleted.' : 'No security diagnostics to delete.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not delete security diagnostics. Please try again.'
      )
    } finally {
      setDeleting(false)
    }
  }
  const retention = settings.privacy.chatRetentionDays
  return (
    <Section
      title="Privacy"
      description="Deleting or clearing a chat also deletes its unshared attachment files. Discarded attachment drafts expire after 24 hours. Redacted security events expire after seven days and stay on this computer."
    >
      <Row label="Security diagnostics" hint="Delete the local redacted event history.">
        <PillButton
          disabled={deleting}
          aria-busy={deleting}
          onClick={() => void deleteDiagnostics()}
        >
          {deleting ? 'Deleting…' : 'Delete diagnostics'}
        </PillButton>
      </Row>
      <div role="status" aria-live="polite">
        {message && <Notice>{message}</Notice>}
      </div>
      {error && (
        <div role="alert">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
      <Row
        label="Conversation expiry"
        hint="Applies on next startup. Expired chats and their unshared attachments are deleted."
      >
        <SelectField
          value={String(retention)}
          options={[
            { value: '0', label: 'Keep until I delete' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            ...(![0, 7, 30, 90].includes(retention)
              ? [{ value: String(retention), label: `${retention} days (custom)` }]
              : [])
          ]}
          onChange={(value) => void save({ privacy: { chatRetentionDays: Number(value) } })}
        />
      </Row>
    </Section>
  )
}
