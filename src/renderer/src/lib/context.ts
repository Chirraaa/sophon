import { contextUsedTokens } from '../../../shared/context-usage'

export function contextSummary(report?: ContextReport): string {
  if (!report) return 'Context & usage'
  const used = contextUsedTokens(report)
  // Provider-measured sizes are exact; estimates keep the "~".
  const mark = report.peakTokens !== undefined ? '' : '~'
  return report.contextWindow
    ? `Context ${mark}${((used / report.contextWindow) * 100).toFixed(1)}%`
    : `Context ${mark}${used.toLocaleString()} tokens`
}
