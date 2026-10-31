export const DEFAULT_MODEL_TUNING = {
  contextWindow: 32000,
  temperature: 0.7,
  maxTokens: 4096,
  historyTurns: 8,
  maxSteps: 20,
  thinking: false,
  reasoningEffort: 'auto',
  specialists: true,
  codingResources: 'auto',
  verification: 'proof'
} as const

export function qwenSampling(thinking: boolean): {
  top_p: number
  top_k: number
  min_p: number
  repeat_penalty: number
  reasoning_effort: 'medium' | 'none'
  presence_penalty: number
} {
  return {
    top_p: thinking ? 0.95 : 0.8,
    top_k: 20,
    min_p: 0,
    repeat_penalty: 1,
    reasoning_effort: thinking ? 'medium' : 'none',
    presence_penalty: thinking ? 0 : 1.5
  }
}
