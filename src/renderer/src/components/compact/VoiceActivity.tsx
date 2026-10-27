import { Spinner } from '@/components/ui/spinner'
import { useEffect, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
export function VoiceActivity({ voice }: { voice: VoiceSnapshot }): React.JSX.Element {
  const [level, setLevel] = useState(0)
  useEffect(() => window.api.voice.onLevel(setLevel), [])
  const listening = voice.phase === 'listening'
  const starting = voice.phase === 'starting'
  return (
    <div className="px-3 pb-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-foreground/90">
          {listening ? (
            <Mic className="size-4 text-tint" />
          ) : (
            <Spinner className="size-4 text-muted-foreground" />
          )}
          {starting ? 'Opening microphone' : listening ? 'Listening' : 'Finding the words'}
        </div>
        <div className="flex h-7 items-center gap-[3px]" aria-hidden="true">
          {[0.4, 0.7, 1, 0.65, 0.9, 0.55, 0.35].map((weight, index) => (
            <span
              key={index}
              className="w-[3px] rounded-full bg-tint/80 transition-[height] duration-100"
              style={{ height: listening ? 3 + Math.max(0, level) * weight * 24 : 3 }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {listening ? 'Speak naturally. I’m here.' : 'This stays on your computer.'}
        </span>
        <div className="flex gap-1">
          {(listening || starting) && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Finish speaking"
              onClick={() => void window.api.voice.stop()}
            >
              <Square className="size-2.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel voice input"
            onClick={() => void window.api.voice.cancel()}
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
