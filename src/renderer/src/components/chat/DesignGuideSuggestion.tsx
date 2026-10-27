import { Palette } from 'lucide-react'
import { Button } from '../ui/button'
import { useSession } from '@/hooks/useSession'

export function DesignGuideSuggestion({
  reason,
  onAsk
}: {
  reason: string
  onAsk?: (text: string) => void
}): React.JSX.Element {
  const { chatId, busy } = useSession()
  return (
    <section aria-label="Suggested design guide" className="space-y-3 p-1">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Palette className="size-4" />
        Find a visual direction
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{reason}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !onAsk}
          aria-label="Open design guide"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('open-design-guide', { detail: chatId }))
          }}
        >
          Explore styles
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !onAsk}
          onClick={() =>
            onAsk?.(
              'Continue the previous task; reuse the existing design system, or choose a suitable direction if none exists. Do not suggest the guide again for this task.'
            )
          }
        >
          Use your judgment
        </Button>
      </div>
    </section>
  )
}
