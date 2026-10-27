import { Kbd } from '@/components/ui/kbd'
import { useEffect, useRef, useState } from 'react'
import { PillButton } from './controls'
import { formatAccelerator, readCombo } from './hotkey'
import type { SaveResult } from './save'
function Keys({ parts, dim }: { parts: string[]; dim?: boolean }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      {parts.map((p, i) => (
        <Kbd key={`${p}-${i}`} className={`h-6 min-w-6 ${dim ? 'opacity-60' : ''}`}>
          {p}
        </Kbd>
      ))}
    </span>
  )
}
type Props = {
  value: string
  onSave: (accelerator: string) => Promise<SaveResult>
}
export function HotkeyField({ value, onSave }: Props): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [held, setHeld] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const saveRef = useRef(onSave)
  useEffect(() => {
    saveRef.current = onSave
  })
  useEffect(() => {
    if (!recording) return
    void window.api.hotkeys.suspend()
    const stop = (): void => {
      setRecording(false)
      setHeld([])
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setMessage(null)
        stop()
        return
      }
      const combo = readCombo(e)
      setHeld(combo.modifiers.map((m) => (m === 'Control' ? 'Ctrl' : m)))
      if (combo.hint) {
        setMessage(combo.hint)
        return
      }
      if (!combo.accelerator) return
      setMessage(null)
      stop()
      void saveRef.current(combo.accelerator).then((res) => {
        if (!res.ok) setMessage(res.error ?? 'That shortcut could not be used.')
      })
    }
    const onBlur = (): void => stop()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
      void window.api.hotkeys.resume()
    }
  }, [recording])
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {recording ? (
          <>
            {held.length > 0 ? (
              <Keys parts={[...held, '…']} dim />
            ) : (
              <span className="text-xs text-muted-foreground">Press the new shortcut…</span>
            )}
            <PillButton
              onClick={() => {
                setMessage(null)
                setRecording(false)
                setHeld([])
              }}
            >
              Cancel
            </PillButton>
          </>
        ) : (
          <>
            <Keys parts={formatAccelerator(value)} />
            <PillButton
              onClick={() => {
                setMessage(null)
                setRecording(true)
              }}
            >
              Change
            </PillButton>
          </>
        )}
      </div>
      {message && <p className="max-w-72 text-right text-xs text-destructive">{message}</p>}
    </div>
  )
}
