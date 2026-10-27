import { Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
export function VoiceButton({
  disabled,
  recording,
  hold
}: {
  disabled: boolean
  recording: boolean
  hold: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={recording ? 'Stop recording' : hold ? 'Hold to speak' : 'Start recording'}
            aria-pressed={recording}
            onPointerDown={(event) => {
              if (!hold || event.button !== 0) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              void window.api.voice.start()
            }}
            onPointerUp={(event) => {
              if (hold && event.button === 0) void window.api.voice.stop()
            }}
            onPointerCancel={() => {
              if (hold) void window.api.voice.cancel()
            }}
            onClick={(event) => {
              if (!hold || event.detail === 0) void window.api.voice.toggle()
            }}
            className={cn(
              'size-8 touch-none rounded-full text-muted-foreground',
              recording && 'bg-red-400/15 text-red-300'
            )}
          />
        }
      >
        <Mic className="size-4" strokeWidth={1.6} />
      </TooltipTrigger>
      <TooltipContent>
        {hold ? 'Hold to speak · release to send' : 'Click to start or stop recording'}
      </TooltipContent>
    </Tooltip>
  )
}
