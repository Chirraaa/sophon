const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function tokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const usage = raw as Record<string, unknown>
  const input = usage.input_tokens ?? usage.prompt_tokens
  const output = usage.output_tokens ?? usage.completion_tokens
  if (!count(input) || !count(output) || !count(input + output)) return
  const details = (usage.input_tokens_details ?? usage.prompt_tokens_details) as
    Record<string, unknown> | undefined
  const generated = (usage.output_tokens_details ?? usage.completion_tokens_details) as
    Record<string, unknown> | undefined
  const cached = details?.cached_tokens
  const reasoning = generated?.reasoning_tokens
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    ...(count(cached) && cached <= input ? { cachedInputTokens: cached } : {}),
    ...(count(reasoning) && reasoning <= output ? { reasoningTokens: reasoning } : {})
  }
}

export function addUsage(previous?: RequestUsage, usage?: TokenUsage): RequestUsage {
  return {
    calls: (previous?.calls ?? 0) + 1,
    reportedCalls: (previous?.reportedCalls ?? 0) + (usage ? 1 : 0),
    inputTokens: (previous?.inputTokens ?? 0) + (usage?.inputTokens ?? 0),
    outputTokens: (previous?.outputTokens ?? 0) + (usage?.outputTokens ?? 0),
    totalTokens: (previous?.totalTokens ?? 0) + (usage?.totalTokens ?? 0),
    cachedInputTokens: (previous?.cachedInputTokens ?? 0) + (usage?.cachedInputTokens ?? 0),
    reasoningTokens: (previous?.reasoningTokens ?? 0) + (usage?.reasoningTokens ?? 0),
    cachedReportedCalls:
      (previous?.cachedReportedCalls ?? 0) + (usage?.cachedInputTokens !== undefined ? 1 : 0),
    reasoningReportedCalls:
      (previous?.reasoningReportedCalls ?? 0) + (usage?.reasoningTokens !== undefined ? 1 : 0)
  }
}
