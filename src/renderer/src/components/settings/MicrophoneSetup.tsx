import { useState } from 'react'
import { useAvailableMicrophones } from '@/hooks/useAvailableMicrophones'
import { Notice, PillButton, Row, SelectField, Toggle } from './controls'

export function MicrophoneSetup({ settings }: { settings: AppSettings }): React.JSX.Element {
  const voice = settings.voice
  const microphones = useAvailableMicrophones()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function update(patch: SettingsPatch['voice']): Promise<void> {
    setPending(true)
    setError('')
    try {
      const result = await window.api.updateSettings({ voice: patch })
      if (!result.ok)
        throw new Error(result.error || 'Could not save microphone preferences. Try again.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-3">
      <Notice>
        Microphone access is optional and off by default. You can always type. When enabled, Sophon
        briefly opens the microphone on startup and when enabling access to load device names, then
        releases it. Speech is recorded only when you use the microphone button or voice shortcut.
        Whisper transcribes audio locally; audio is not saved. The resulting text goes to your
        selected model, just like a typed message. Disabling access stops recording and Whisper.
      </Notice>
      <fieldset disabled={pending} className="min-w-0">
        <Row label="Enable microphone access" hint="Change this anytime in Settings → Voice.">
          <Toggle checked={voice.enabled} onChange={(enabled) => void update({ enabled })} />
        </Row>
        {voice.enabled && (
          <Row
            label="Preferred microphone"
            hint="Detect briefly opens the microphone to load device names, then releases it. Your choice also applies to the voice shortcut."
            stack
          >
            <div className="flex flex-wrap items-center gap-2">
              <SelectField
                value={voice.deviceId}
                width="w-72"
                options={[
                  {
                    value: '',
                    label: microphones.defaultLabel
                      ? `System default: ${microphones.defaultLabel}`
                      : 'System default microphone'
                  },
                  ...microphones.devices.map((device, index) => ({
                    value: device.deviceId,
                    label: device.label || `Microphone ${index + 1}`
                  })),
                  ...(voice.deviceId &&
                  !microphones.devices.some((device) => device.deviceId === voice.deviceId)
                    ? [{ value: voice.deviceId, label: 'Saved microphone (unavailable)' }]
                    : [])
                ]}
                onChange={(deviceId) => void update({ deviceId })}
              />
              <PillButton
                type="button"
                disabled={microphones.loading}
                onClick={() => void microphones.refresh()}
              >
                {microphones.loading ? 'Detecting…' : 'Detect microphones'}
              </PillButton>
            </div>
          </Row>
        )}
      </fieldset>
      {(error || (voice.enabled && microphones.error)) && (
        <div role="alert">
          <Notice tone="warn">{error || microphones.error}</Notice>
        </div>
      )}
      {!voice.enabled && (
        <p role="status" className="text-xs text-muted-foreground">
          Microphone disabled. Whisper will not run.
        </p>
      )}
    </div>
  )
}
