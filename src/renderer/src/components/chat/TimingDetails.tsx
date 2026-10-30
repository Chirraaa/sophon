import { seconds } from '@/lib/duration'

export function TimingDetails({ timing }: { timing: RequestTiming }): React.JSX.Element {
  const share = (ms: number): string =>
    timing.wallMs ? ` · ${Math.round((ms / timing.wallMs) * 100)}%` : ''
  const average = (ms: number, count: number): string =>
    count > 1 ? ` · ${seconds(Math.round(ms / count))} each` : ''
  const rows = [
    ['Model', timing.modelMs, timing.modelCalls, 'call', true],
    ['Tools', timing.toolMs, timing.toolCalls, 'call', true],
    ['Screen capture (in tools)', timing.captureMs, timing.captures, 'capture', false],
    ['App controls (in tools)', timing.automationMs, timing.automationCalls, 'request', false],
    ['Waiting for approval', timing.approvalMs, timing.approvals, 'approval', true]
  ] as const
  const other = Math.max(0, timing.wallMs - timing.modelMs - timing.toolMs - timing.approvalMs)
  return (
    <section className="space-y-2 text-xs" aria-label="This task timing">
      <p className="font-medium text-foreground">This task · {seconds(timing.wallMs)} total</p>
      <dl className="space-y-2 tabular-nums">
        {rows
          .filter(([, , count]) => count > 0)
          .map(([name, ms, count, unit, top]) => (
            <div key={name} className="flex justify-between gap-4">
              <dt className={top ? 'text-muted-foreground' : 'pl-3 text-muted-foreground'}>
                {name} · {count} {count === 1 ? unit : `${unit}s`}
              </dt>
              <dd>
                {seconds(ms)}
                {top ? share(ms) : average(ms, count)}
              </dd>
            </div>
          ))}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Other (context, checks, streaming)</dt>
          <dd>
            {seconds(other)}
            {share(other)}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        Measured in Sophon. Model time includes network and provider queueing; tool time includes
        the screen capture and app-control time listed under it.
      </p>
    </section>
  )
}
