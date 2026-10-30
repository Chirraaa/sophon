import { BellRing, Timer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useTimers } from '@/hooks/useTimers'
import { describeDuration, formatClock, type TimerInfo } from '../../../shared/timers'

function TimerPill({ timer, now }: { timer: TimerInfo; now: number }): React.JSX.Element {
  const done = timer.state === 'done'
  const remaining = Math.max(0, timer.endsAt - now)
  const name = timer.label || describeDuration(timer.durationMs / 1000)
  const percent = done ? 100 : Math.min(100, Math.max(0, (1 - remaining / timer.durationMs) * 100))
  return (
    <div
      role="timer"
      aria-label={done ? `${name}: time's up` : `${name}: ${formatClock(remaining)} remaining`}
      className={cn(
        'relative flex h-7 min-w-0 items-center gap-1.5 overflow-hidden rounded-full border pr-0.5 pl-2.5 text-xs',
        done ? 'border-success/50 bg-success/10 text-foreground' : 'border-border bg-muted/40'
      )}
    >
      {done ? (
        <BellRing className="size-3.5 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Timer className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      {timer.label && (
        <span className="max-w-28 truncate text-muted-foreground" title={timer.label}>
          {timer.label}
        </span>
      )}
      <span className="font-medium tabular-nums">
        {done ? "Time's up" : formatClock(remaining)}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-6 rounded-full"
        aria-label={done ? `Dismiss ${name}` : `Cancel ${name}`}
        title={done ? 'Dismiss' : 'Cancel timer'}
        onClick={() => void window.api.timers.remove(timer.id)}
      >
        <X className="size-3" />
      </Button>
      <Progress
        value={percent}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        trackClassName="h-0.5 rounded-none bg-transparent"
        indicatorClassName={cn('rounded-none', done ? 'bg-success' : 'bg-tint')}
      />
    </div>
  )
}

/** Running and finished timers as small pills; renders nothing when there are none. */
export function TimerStrip({ className }: { className?: string }): React.JSX.Element | null {
  const { timers, now } = useTimers()
  if (!timers.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {timers.map((timer) => (
        <TimerPill key={timer.id} timer={timer} now={now} />
      ))}
    </div>
  )
}

/** The soonest running timer as a bare clock, for the docked bar. */
export function TimerBarClock(): React.JSX.Element | null {
  const { timers, now } = useTimers()
  const next = timers.find((timer) => timer.state === 'running')
  if (!next) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
      <Timer className="size-3" aria-hidden="true" />
      {formatClock(next.endsAt - now)}
    </span>
  )
}
