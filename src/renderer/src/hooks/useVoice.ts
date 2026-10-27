import { useEffect, useState } from 'react'
export function useVoice(): VoiceSnapshot {
  const [voice, setVoice] = useState<VoiceSnapshot>({ phase: 'idle' })
  useEffect(() => {
    let alive = true
    let updated = false
    const off = window.api.voice.onState((state) => {
      updated = true
      setVoice(state)
    })
    void window.api.voice.getState().then((state) => {
      if (alive && !updated) setVoice(state)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return voice
}
