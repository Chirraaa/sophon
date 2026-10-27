export function contextSummary(report?: ContextReport): string {
  if (!report) return 'Context & usage'
  const total = report.estimatedTotalTokens ?? report.estimatedInputTokens
  return report.contextWindow
    ? `Context ~${((total / report.contextWindow) * 100).toFixed(1)}%`
    : `Context ~${total.toLocaleString()} tokens`
}
