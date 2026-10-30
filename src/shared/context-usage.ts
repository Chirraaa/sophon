// Tokens the conversation occupies: the provider-measured size (prompt plus
// reply) of the largest main request in this reply, else the estimate.
export function contextUsedTokens(report: ContextMeasurements): number {
  return report.peakTokens ?? report.estimatedTotalTokens ?? report.estimatedInputTokens
}

// Fold a new main-request report into the reply's report. A pre-request estimate
// refreshes the breakdown without discarding sizes already measured in this
// reply; a compaction shrinks the conversation, so earlier sizes stop applying.
export function mergeContext<T extends ContextMeasurements>(
  previous: Partial<ContextReport> | undefined,
  next: T
): T & Partial<ContextReport> {
  const compacted =
    ((next as Partial<ContextReport>).compaction?.count ?? 0) > (previous?.compaction?.count ?? 0)
  const kept = compacted ? undefined : previous
  const reportedInputTokens = next.reportedInputTokens ?? kept?.reportedInputTokens
  const reportedOutputTokens =
    next.reportedInputTokens !== undefined ? next.reportedOutputTokens : kept?.reportedOutputTokens
  const measured =
    next.reportedInputTokens !== undefined
      ? next.reportedInputTokens + (next.reportedOutputTokens ?? 0)
      : 0
  const peak = Math.max(kept?.peakTokens ?? 0, measured)
  return {
    ...previous,
    ...next,
    reportedInputTokens,
    reportedOutputTokens,
    peakTokens: peak || undefined
  }
}
