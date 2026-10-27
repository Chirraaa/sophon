import type { ChatHistory, ModelMessage } from './types'
import { untrustedData } from './untrusted-data'

export const estimateTextTokens = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, 'utf8') / 3)

export function contextBreakdown(
  messages: ModelMessage[],
  tools: unknown[]
): NonNullable<ContextMeasurements['breakdown']> {
  const buckets = new Map<ContextCategory, number>()
  const add = (category: ContextCategory, tokens: number): void => {
    buckets.set(category, (buckets.get(category) ?? 0) + tokens)
  }
  for (const message of messages) {
    const category: ContextCategory =
      message.role === 'system'
        ? 'instructions'
        : message.role === 'tool'
          ? 'toolResults'
          : (message.contextGroup ?? 'request')
    add('overhead', 12)
    const text = (value: string): void => {
      let kind: unknown
      try {
        const envelope = JSON.parse(value)
        if (envelope?.trust === 'untrusted-data') kind = envelope.kind
      } catch {
        /* Ordinary text. */
      }
      add(
        kind === 'user-selected-file' || kind === 'user-selected-image'
          ? 'attachments'
          : kind === 'saved-memory'
            ? 'memories'
            : category,
        estimateTextTokens(value)
      )
    }
    if (typeof message.content === 'string') text(message.content)
    else
      for (const part of message.content) {
        if (part.type === 'image_url') add('attachments', 2048)
        else text(part.text)
      }
    if (message.tool_calls) add('toolCalls', estimateTextTokens(JSON.stringify(message.tool_calls)))
    if (message.responseState)
      add('reasoning', estimateTextTokens(JSON.stringify(message.responseState)))
  }
  if (tools.length) add('tools', estimateTextTokens(JSON.stringify(tools)) + 32)
  return [...buckets]
    .map(([category, tokens]) => ({ category, tokens }))
    .filter((part) => part.tokens > 0)
}

export function measureContext(
  messages: ModelMessage[],
  tools: unknown[],
  model: AppSettings['model'],
  visual: boolean,
  info?: ModelChoice
): ContextMeasurements {
  const budget = contextBudget(model, tools, visual, info)
  const provider = model.provider ?? 'local'
  const hosted = provider === 'chatgpt'
  const window = hosted ? (info?.contextWindow ?? null) : model.contextWindow
  const breakdown = contextBreakdown(messages, tools)
  return {
    model: info?.id || model.modelId,
    provider,
    measuredAt: Date.now(),
    estimatedInputTokens: estimateMessages(messages),
    estimatedTotalTokens: breakdown.reduce((sum, part) => sum + part.tokens, 0),
    inputBudget: Number.isFinite(budget.inputBudget) ? budget.inputBudget : null,
    reservedOutputTokens: budget.reservedOutputTokens,
    contextWindow: window,
    windowSource: hosted ? (info?.contextSource ?? 'unknown') : 'configured',
    headroomTokens: window ? Math.max(256, Math.ceil(window * 0.2)) : 0,
    breakdown
  }
}
export function latestScreenObservation(messages: ModelMessage[]): ModelMessage[] {
  const isScreen = (message: ModelMessage): boolean =>
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.some((part) => {
      if (part.type !== 'text') return false
      try {
        const source = JSON.parse(part.text)
        return source.kind === 'tool-image' && source.trust === 'untrusted-data'
      } catch {
        return false
      }
    })
  const latest = messages.findLastIndex(isScreen)
  return messages.map((message, index) =>
    index < latest && isScreen(message)
      ? {
          ...message,
          content:
            '[Earlier tool screenshot superseded. Its image and click coordinates are stale; use the latest screenshot or inspect_app.]'
        }
      : message
  )
}
export function estimateMessages(messages: ModelMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      12 +
      (typeof message.content === 'string'
        ? estimateTextTokens(message.content)
        : message.content.reduce(
            (sum, part) => sum + (part.type === 'text' ? estimateTextTokens(part.text) : 2048),
            0
          )) +
      (message.tool_calls ? estimateTextTokens(JSON.stringify(message.tool_calls)) : 0) +
      (message.responseState ? estimateTextTokens(JSON.stringify(message.responseState)) : 0),
    0
  )
}
export function contextBudget(
  model: AppSettings['model'],
  tools: unknown[],
  visual: boolean,
  info?: ModelChoice
): {
  inputBudget: number
  reservedOutputTokens: number
} {
  if (model.provider === 'chatgpt' && !info?.contextWindow)
    return { inputBudget: Infinity, reservedOutputTokens: 0 }
  const window =
    model.provider === 'chatgpt' ? info!.contextWindow! : (model.contextWindow ?? 16384)

  const requested = visual ? Math.floor(window / 3) : model.maxTokens
  const reservedOutputTokens = Math.min(requested, Math.floor(window / 3))
  return {
    inputBudget:
      window -
      reservedOutputTokens -
      Math.max(256, Math.ceil(window * 0.2)) -
      (tools.length ? estimateTextTokens(JSON.stringify(tools)) + 32 : 0),
    reservedOutputTokens
  }
}
export function assertContextFits(messages: ModelMessage[], inputBudget: number): void {
  if (estimateMessages(messages) > inputBudget)
    throw new Error(
      'This request exceeds the model context budget. Shorten the message or attachment, request a smaller file excerpt, or choose a larger context window. For local servers, match Context window in Settings > Model to your server. The current request and latest tool results were not silently truncated.'
    )
}
export function assembleContext(options: {
  system: string
  history: ChatHistory
  current: ModelMessage[]
  memories: MemoryRecord[]
  memoryTokens: number
  model: AppSettings['model']
  tools: unknown[]
  visual: boolean
  playbooks: string[]
  guidance?: string[]
  availableTools?: string[]
  summaries?: ModelMessage[]
  info?: ModelChoice
}): { messages: ModelMessage[]; report: ContextReport } {
  const { system, history, memories, model, tools, visual } = options
  const current = latestScreenObservation(options.current)
  const budget = contextBudget(model, tools, visual, options.info)
  const systemMessage: ModelMessage = { role: 'system', content: system }
  if (estimateMessages([systemMessage]) > budget.inputBudget)
    throw new Error(
      'The model context budget cannot fit the application instructions and loaded tool schemas. Load fewer tools, shorten custom instructions, or choose a larger context window in Settings > Model. Shortening the user message alone cannot fix this configuration.'
    )
  const summaries = (options.summaries ?? []).map((message) => ({
    ...message,
    contextGroup: 'history' as const
  }))
  const required = [systemMessage, ...summaries, ...current]
  assertContextFits(required, budget.inputBudget)
  let remaining = budget.inputBudget - estimateMessages(required)
  const kept: ChatHistory = []

  const latest = history.at(-1)
  if (latest && estimateMessages(latest) <= remaining) {
    kept.unshift(latest)
    remaining -= estimateMessages(latest)
  }
  const recalled: ModelMessage[] = []
  const selected: MemoryRecord[] = []
  let memoryRemaining = Math.min(options.memoryTokens, remaining)
  for (const memory of memories) {
    if (selected.length >= 6) break
    const message: ModelMessage = {
      role: 'user',
      content: untrustedData(
        'saved-memory',
        memory.title,
        JSON.stringify({
          id: memory.id,
          kind: memory.kind,
          scope: memory.scope,
          source: memory.source,
          updatedAt: new Date(memory.updatedAt).toISOString(),
          content: memory.content
        })
      )
    }
    const cost = estimateMessages([message])
    if (cost > memoryRemaining) continue
    selected.push(memory)
    recalled.push(message)
    memoryRemaining -= cost
    remaining -= cost
  }

  if (kept.length) {
    for (let i = history.length - 2; i >= 0; i--) {
      const cost = estimateMessages(history[i])
      if (cost > remaining) break
      kept.unshift(history[i])
      remaining -= cost
    }
  }
  const messages = [
    systemMessage,
    ...summaries,
    ...kept.flat().map((message) => ({ ...message, contextGroup: 'history' as const })),
    ...recalled.map((message) => ({ ...message, contextGroup: 'memories' as const })),
    ...current.map((message) => ({ ...message, contextGroup: 'request' as const }))
  ]
  return {
    messages,
    report: {
      ...measureContext(messages, tools, model, visual, options.info),
      droppedTurns: history.length - kept.length,
      memories: selected.map(({ id, title }) => ({ id, title })),
      playbooks: options.playbooks,
      guidance: options.guidance ?? [],
      availableTools: options.availableTools ?? []
    }
  }
}
