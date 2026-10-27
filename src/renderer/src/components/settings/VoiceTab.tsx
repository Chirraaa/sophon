import { HotkeyField } from './HotkeyField'
import { Notice, Row, Section, Segmented } from './controls'
import { save } from './save'
import { MicrophoneSetup } from './MicrophoneSetup'
import { useVoice } from '@/hooks/useVoice'
export function VoiceTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const v = settings.voice
  const voice = useVoice()
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        Hold the microphone button or your voice shortcut, speak, then release to send the command.
        In Toggle mode, press once to record and again to send. Esc cancels. Audio is transcribed
        locally and is not saved. Commands use the same permissions as typed messages.
      </Notice>
      {voice.phase === 'error' && <Notice tone="warn">{voice.error}</Notice>}

      <Section title="Microphone">
        <MicrophoneSetup settings={settings} />
      </Section>
      {v.enabled && (
        <>
          <Section title="Speech recognition">
            <Row
              label="Language"
              hint="Automatic works for most commands. Pick one language if short phrases get misheard."
            >
              <Segmented
                value={v.language}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'en', label: 'English' },
                  { value: 'de', label: 'Deutsch' },
                  { value: 'fr', label: 'Français' }
                ]}
                onChange={(language) => void save({ voice: { language } })}
              />
            </Row>
            <Row
              label="Run on"
              hint="Automatic tries the selected program's GPU support and retries on the processor if startup fails. GPU requires a compatible GPU build."
            >
              <Segmented
                value={v.compute}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'cpu', label: 'Processor' },
                  { value: 'gpu', label: 'GPU' }
                ]}
                onChange={(compute) => void save({ voice: { compute } })}
              />
            </Row>
          </Section>

          <Section title="Push to talk">
            <Row label="Shortcut" hint="Works from anywhere in Windows.">
              <HotkeyField
                value={settings.hotkeys.talk}
                onSave={(talk) => save({ hotkeys: { talk } })}
              />
            </Row>
            <Row
              label="How it works"
              hint="Hold: speak while you hold the keys. Toggle: press once to start and again to stop."
            >
              <Segmented
                value={v.mode}
                options={[
                  { value: 'hold', label: 'Hold' },
                  { value: 'toggle', label: 'Toggle' }
                ]}
                onChange={(mode) => void save({ voice: { mode } })}
              />
            </Row>
          </Section>

          <Section
            title="Verified voice files"
            collapsible
            description="Voice runs the bundled program and multilingual base model after checking their pinned hashes. Custom executables and modified DLLs are rejected."
          >
            <Row label="Program" stack>
              <span className="selectable break-all text-xs">{v.serverPath}</span>
            </Row>
            <Row label="Model" stack>
              <span className="selectable break-all text-xs">{v.modelPath}</span>
            </Row>
          </Section>
        </>
      )}
    </div>
  )
}
