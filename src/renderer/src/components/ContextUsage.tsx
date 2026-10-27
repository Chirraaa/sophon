import { ScrollArea } from '@/components/ui/scroll-area'
import { useRef, useState } from 'react'
import { ChartPie } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { Button } from './ui/button'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import { ContextDetails } from './chat/ContextDetails'
import { contextSummary } from '@/lib/context'
import { UsageDetails } from './chat/UsageDetails'

export function ContextUsage({ provider }: { provider?: ModelProvider }): React.JSX.Element {
  const { items } = useSession()
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const latest = items.findLast((item) => item.from === 'agent' && (item.context || item.usage))
  const recorded = items.flatMap((item) => (item.usage ? [item.usage] : []))
  const total = recorded.length
    ? recorded.reduce(
        (sum, usage) => {
          for (const key of Object.keys(sum) as (keyof RequestUsage)[]) sum[key] += usage[key]
          return sum
        },
        {
          calls: 0,
          reportedCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          cachedReportedCalls: 0,
          reasoningReportedCalls: 0
        }
      )
    : undefined
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label="Context and usage"
        className="gap-1.5 text-xs text-muted-foreground"
      >
        <ChartPie className="size-3.5" />
        {contextSummary(latest?.context)}
      </DialogTrigger>
      <DialogContent
        initialFocus={heading}
        closeLabel="Close context and usage"
        className="h-[min(560px,var(--popup-max-height,calc(100dvh-3rem)))] max-w-xl"
      >
        <DialogTitle
          ref={heading}
          tabIndex={-1}
          className="shrink-0 pr-7 text-base font-semibold outline-none"
        >
          Context & usage
        </DialogTitle>
        <DialogDescription className="mt-1 shrink-0 text-xs text-muted-foreground">
          The latest request snapshot and provider-reported tokens.
        </DialogDescription>
        <ScrollArea className="mt-5 min-h-0 flex-1" contentClassName="space-y-5 pr-1">
          {latest?.context ? (
            <ContextDetails report={latest.context} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Send a message to see what is included in the model context.
            </p>
          )}
          <div className="border-t border-border pt-4">
            <UsageDetails usage={latest?.usage} />
          </div>
          {recorded.length > 1 && (
            <div className="border-t border-border pt-4">
              <UsageDetails usage={total} label="Loaded messages in this chat" />
            </div>
          )}
          {provider === 'chatgpt' && (
            <div className="space-y-2 rounded-xl border border-border p-3 text-xs">
              <p className="font-medium">Using ChatGPT plan</p>
              <p className="text-muted-foreground">
                Remaining plan allowance and credits are managed by ChatGPT. These token counts do
                not measure your remaining plan quota.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setError('')
                  void window.api.chatgpt
                    .manageUsage()
                    .catch((reason: Error) => setError(reason.message))
                }}
              >
                Manage usage
              </Button>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
