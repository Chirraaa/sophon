import { useEffect } from 'react'
import { MicrophoneRecording, microphoneError } from '@/lib/recording'
export function VoiceCapture(): null {
  useEffect(() => {
    let current: {
      id: string
      recording: MicrophoneRecording
    } | null = null
    const off = window.api.voice.onCapture((event) => {
      if (event.command === 'start') {
        current?.recording.cancel()
        const capture = {
          id: event.id,
          recording: new MicrophoneRecording((level) => window.api.voice.level(event.id, level))
        }
        current = capture
        void window.api
          .getSettings()
          .then((settings) => {
            if (!settings.voice.enabled || current !== capture) return false
            return capture.recording.start(settings.voice.deviceId)
          })
          .then((started) => {
            if (started && current === capture) window.api.voice.ready(capture.id)
          })
          .catch((error: unknown) => {
            capture.recording.cancel()
            if (current === capture) {
              current = null
              window.api.voice.error(capture.id, microphoneError(error))
            }
          })
      } else if (current?.id === event.id) {
        const capture = current
        current = null
        if (event.command === 'cancel') capture.recording.cancel()
        else
          void capture.recording
            .finish()
            .then((audio) => window.api.voice.audio(capture.id, audio))
            .catch((error: unknown) => {
              capture.recording.cancel()
              window.api.voice.error(capture.id, microphoneError(error))
            })
      }
    })
    const escape = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        current &&
        !event.defaultPrevented &&
        !document.querySelector(
          'dialog:modal, [role="dialog"], [role="alertdialog"], [role="listbox"]'
        )
      ) {
        event.preventDefault()
        void window.api.voice.cancel()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      off()
      current?.recording.cancel()
      window.removeEventListener('keydown', escape, true)
    }
  }, [])
  return null
}
