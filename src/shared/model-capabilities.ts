export const REASONING_EFFORTS: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
]
export const EFFORT_LABELS: Record<ReasoningEffort | 'auto', string> = {
  auto: 'Auto effort',
  none: 'No reasoning',
  minimal: 'Minimal effort',
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  xhigh: 'Extra high effort',
  max: 'Maximum effort',
  ultra: 'Ultra effort'
}

export function documentedCapabilities(id: string, provider: ModelProvider): ModelCapabilities {
  if (provider === 'anthropic' || provider === 'claude') {
    // Current Claude models take adaptive thinking with an effort level; older ones do not.
    if (!/^claude-(?:fable|opus|sonnet|haiku)-5/.test(id) && !/^claude-opus-4-[678]/.test(id))
      return {}
    return {
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: /^claude-(?:opus|haiku)-5-5/.test(id) ? 'medium' : 'high',
      reasoningSource: 'documented'
    }
  }
  if (!['openai', 'chatgpt'].includes(provider)) return {}
  const model = id.replace(/-\d{4}-\d{2}-\d{2}$/, '')
  let reasoningEfforts: ReasoningEffort[]
  let contextWindow = 1050000
  let defaultReasoningEffort: ReasoningEffort = 'medium'
  if (['gpt-6-astra', 'gpt-6.1-sol'].includes(model)) {
    reasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max']
  } else if (['gpt-6-luna', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.6'].includes(model)) {
    reasoningEfforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  } else if (['gpt-5.2', 'gpt-5.4', 'gpt-5.5'].includes(model)) {
    reasoningEfforts = ['none', 'low', 'medium', 'high', 'xhigh']
    if (model === 'gpt-5.2') contextWindow = 400000
    if (model !== 'gpt-5.5') defaultReasoningEffort = 'none'
  } else return {}
  return {
    reasoningEfforts,
    defaultReasoningEffort,
    contextWindow,
    reasoningSource: 'documented',
    contextSource: 'documented'
  }
}

export function modelCapabilities(
  id: string,
  provider: ModelProvider,
  raw: unknown
): ModelCapabilities {
  const result = documentedCapabilities(id, provider)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  const data = raw as Record<string, unknown>
  const levels = data.supported_reasoning_levels ?? data.supported_reasoning_efforts
  if (Array.isArray(levels)) {
    result.reasoningEfforts = [
      ...new Set(
        levels.flatMap((entry) => {
          const effort = typeof entry === 'string' ? entry : entry?.effort
          return REASONING_EFFORTS.includes(effort) ? [effort as ReasoningEffort] : []
        })
      )
    ]
    result.reasoningSource = 'provider'
    delete result.defaultReasoningEffort
  }
  if (
    typeof data.max_input_tokens === 'number' &&
    Number.isSafeInteger(data.max_input_tokens) &&
    data.max_input_tokens > 0 &&
    data.max_input_tokens <= 100000000
  ) {
    result.contextWindow = data.max_input_tokens
    result.contextSource = 'provider'
  }
  const defaultEffort = data.default_reasoning_level ?? data.default_reasoning_effort
  if (result.reasoningEfforts?.includes(defaultEffort as ReasoningEffort))
    result.defaultReasoningEffort = defaultEffort as ReasoningEffort
  // context_window (OpenAI-style), context_length (OpenRouter-style), max_model_len (vLLM).
  for (const key of ['context_length', 'max_model_len', 'context_window']) {
    const value = data[key]
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 100000000
    ) {
      result.contextWindow = value
      result.contextSource = 'provider'
    }
  }
  return result
}

export function supportedEffort(
  value: AppSettings['model']['reasoningEffort'],
  capabilities: ModelCapabilities
): ReasoningEffort | undefined {
  return value !== 'auto' && capabilities.reasoningEfforts?.includes(value) ? value : undefined
}
