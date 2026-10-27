export function UsageDetails({
  usage,
  label = 'This task'
}: {
  usage?: RequestUsage
  label?: string
}): React.JSX.Element {
  if (!usage)
    return (
      <p className="text-xs text-muted-foreground">
        Token usage is available for new requests when the provider reports it.
      </p>
    )
  const rows = [
    ['Input', usage.inputTokens],
    ['Output', usage.outputTokens],
    ['Total', usage.totalTokens],
    ['Cached input (part of input)', usage.cachedReportedCalls ? usage.cachedInputTokens : null],
    ['Reasoning (part of output)', usage.reasoningReportedCalls ? usage.reasoningTokens : null]
  ] as const
  return (
    <section className="space-y-2 text-xs" aria-label={`${label} token usage`}>
      <p className="font-medium text-foreground">
        {label} · {usage.calls} model {usage.calls === 1 ? 'call' : 'calls'}
      </p>
      {usage.reportedCalls > 0 ? (
        <dl className="space-y-2 tabular-nums">
          {rows.map(([name, count]) => (
            <div key={name} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{name}</dt>
              <dd>{count === null ? 'Not reported' : count.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">
          The provider has not reported token counts for these calls.
        </p>
      )}
      <p className="text-muted-foreground">
        Provider counts from {usage.reportedCalls}/{usage.calls} calls. Includes tool loops,
        reviews, and specialist calls when reported. Repeated input counts each time; this total is
        not context fullness.
      </p>
      {usage.reportedCalls > 0 &&
        (usage.cachedReportedCalls < usage.reportedCalls ||
          usage.reasoningReportedCalls < usage.reportedCalls) && (
          <p className="text-muted-foreground">
            Cached and reasoning subtotals cover only calls that supplied those details.
          </p>
        )}
    </section>
  )
}
