import type { ChatHistory, ModelMessage } from './types'
import { untrustedData } from './untrusted-data'

export const estimateTextTokens = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, 'utf8') / 3)

// Budget checks keep this conservative flat cost; the display uses imageTokens.
const IMAGE_TOKENS = 2048

function imageSize(url: string): { width: number; height: number } | undefined {
  const match = /^data:image\/(?:png|jpeg|gif);base64,/.exec(url)
  if (!match) return
  // Dimensions sit in the header; JPEG frames can follow a large EXIF block.
  const bytes = Buffer.from(url.slice(match[0].length, match[0].length + 349528), 'base64')
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'GIF')
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return
    const marker = bytes[at + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
    at += 2 + bytes.readUInt16BE(at + 2)
  }
  return
}

// Each provider encodes images differently; these follow their published rules,
// and calibration against reported counts absorbs the remaining difference.
export function imageTokens(url: string, provider?: ModelProvider): number {
  const size = provider ? imageSize(url) : undefined
  if (!size || !size.width || !size.height) return IMAGE_TOKENS
  let { width, height } = size
  const fit = (scale: number): void => {
    if (scale < 1) {
      width = Math.max(1, Math.floor(width * scale))
      height = Math.max(1, Math.floor(height * scale))
    }
  }
  if (provider === 'anthropic' || provider === 'claude') {
    fit(Math.min(1568 / Math.max(width, height), Math.sqrt(1150000 / (width * height))))
    return Math.ceil((width * height) / 750)
  }
  if (provider === 'openai' || provider === 'chatgpt') {
    fit(2048 / Math.max(width, height))
    fit(768 / Math.min(width, height))
    return 85 + 170 * Math.ceil(width / 512) * Math.ceil(height / 512)
  }
  // Local vision models (Qwen-VL style) merge 28×28 pixel patches into one token.
  return Math.ceil(width / 28) * Math.ceil(height / 28)
}

// One window rule for budgets and the display. Hosted models use their reported
// or published window; local servers use what the server reports it is running
// with (llama.cpp /props), else the window configured in Settings.
export function contextWindow(
  model: AppSettings['model'],
  info?: ModelChoice
): { window: number | null; source: NonNullable<ContextMeasurements['windowSource']> } {
  const provider = model.provider ?? 'local'
  const known = info?.contextWindow
  if (provider === 'chatgpt')
    return known
      ? { window: known, source: info?.contextSource ?? 'documented' }
      : { window: null, source: 'unknown' }
  if (provider === 'anthropic' || provider === 'claude')
    return known
      ? { window: known, source: info?.contextSource ?? 'documented' }
      : { window: 200000, source: 'documented' }
  if (known && (provider === 'openai' || info?.contextSource === 'provider'))
    return { window: known, source: info?.contextSource ?? 'documented' }
  return { window: model.contextWindow ?? 16384, source: 'configured' }
}

// Ratio of provider-reported prompt tokens to Sophon's estimate for the last
// measured request of each model, so pre-request estimates track reality.
const calibrations = new Map<string, number>()
const calibrationKey = (model: AppSettings['model'], id?: string): string =>
  `${model.provider ?? 'local'}\n${model.endpoint ?? ''}\n${id || model.modelId}`
export function calibrateContext(
  model: AppSettings['model'],
  id: string | undefined,
  estimated: number,
  reported: number
): void {
  if (estimated > 0 && reported > 0)
    calibrations.set(calibrationKey(model, id), Math.min(3, Math.max(0.3, reported / estimated)))
}

export function contextBreakdown(
  messages: ModelMessage[],
  tools: unknown[],
  provider?: ModelProvider
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
        if (part.type === 'image_url') add('attachments', imageTokens(part.image_url.url, provider))
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
  const { window, source } = contextWindow(model, info)
  const raw = contextBreakdown(messages, tools, provider)
  const rawTotal = raw.reduce((sum, part) => sum + part.tokens, 0)
  const ratio = calibrations.get(calibrationKey(model, info?.id))
  const breakdown = ratio
    ? raw.map((part) => ({ ...part, tokens: Math.round(part.tokens * ratio) }))
    : raw
  return {
    model: info?.id || model.modelId,
    provider,
    measuredAt: Date.now(),
    estimatedInputTokens: estimateMessages(messages),
    estimatedTotalTokens: breakdown.reduce((sum, part) => sum + part.tokens, 0),
    rawEstimatedTokens: rawTotal,
    ...(ratio ? { calibrated: true } : {}),
    inputBudget: Number.isFinite(budget.inputBudget) ? budget.inputBudget : null,
    reservedOutputTokens: budget.reservedOutputTokens,
    contextWindow: window,
    windowSource: source,
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

export function appControlSnapshot(text: string):
  | {
      observation: string
      windowRef: string
      controls: Record<string, unknown>[]
    }
  | undefined {
  try {
    const envelope = JSON.parse(text.slice(text.lastIndexOf('\n{') + 1))
    if (envelope.kind !== 'app-controls' || envelope.trust !== 'untrusted-data') return
    const snapshot = JSON.parse(envelope.content)
    if (
      /^obs-[a-f0-9]{12}$/.test(snapshot.observation) &&
      /^win-[a-f0-9-]{36}$/.test(snapshot.windowRef) &&
      Array.isArray(snapshot.controls) &&
      snapshot.controls.every((control: unknown) => control && typeof control === 'object')
    )
      return snapshot
  } catch {
    // Failed inspections and older saved excerpts are not live observations.
  }
  return undefined
}

// Keep complete results in the action log; only pack useful live references for
// inference. Control actions invalidate every observation in the native layer.
export function latestDesktopObservations(messages: ModelMessage[]): ModelMessage[] {
  const seenWindows = new Set<string>()
  const seenTabs = new Set<string>()
  let invalidated = false
  let browserInvalidated = false
  return latestScreenObservation(messages)
    .map((message) => ({ ...message }))
    .reverse()
    .map((message) => {
      if (message.tool_calls?.some((call) => call.function.name === 'act_on_control'))
        invalidated = true
      if (
        message.tool_calls?.some((call) =>
          ['browser_act', 'browser_open'].includes(call.function.name)
        )
      )
        browserInvalidated = true
      if (message.role !== 'tool' || typeof message.content !== 'string') return message
      try {
        const prefix = message.content.slice(0, message.content.lastIndexOf('\n{') + 1)
        const envelope = JSON.parse(message.content.slice(prefix.length))
        if (envelope.kind === 'browser-dom' && envelope.trust === 'untrusted-data') {
          const state = JSON.parse(envelope.content)
          if (
            /^tab-[a-f0-9]{12}$/.test(state.tab) &&
            /^dom-[a-f0-9]{12}$/.test(state.observation) &&
            Array.isArray(state.controls)
          ) {
            const stale = browserInvalidated || seenTabs.has(state.tab)
            seenTabs.add(state.tab)
            if (!stale) return message
            return {
              ...message,
              content:
                prefix +
                untrustedData(
                  'expired-browser-dom',
                  'Historical browser observation',
                  JSON.stringify({
                    note: 'DOM references expired or superseded. Inspect the current tab before acting; stored action history retains details.',
                    excerpt: state.controls.slice(0, 6).map((control: Record<string, unknown>) => ({
                      name: String(control?.name ?? '').slice(0, 80),
                      valueExcerpt: String(control?.value ?? '').slice(0, 80)
                    }))
                  })
                )
            }
          }
        }
      } catch {
        /* Non-DOM results retain their original evidence. */
      }
      const snapshot = appControlSnapshot(message.content)
      if (!snapshot) return message
      const stale = invalidated || seenWindows.has(snapshot.windowRef)
      seenWindows.add(snapshot.windowRef)
      if (!stale) return message
      return {
        ...message,
        content:
          message.content.slice(0, message.content.lastIndexOf('\n{') + 1) +
          untrustedData(
            'expired-app-controls',
            snapshot.windowRef,
            JSON.stringify({
              note: 'Historical inspection; control references expired or were superseded. Inspect again for actions. Full details remain in action history.',
              excerpt: snapshot.controls.slice(0, 6).map((control) => ({
                name: String(control.name ?? '').slice(0, 80),
                ...(control.value ? { valueExcerpt: String(control.value).slice(0, 80) } : {})
              }))
            })
          )
      }
    })
    .reverse()
}

export function historicalDesktopReferences(messages: ModelMessage[]): ModelMessage[] {
  const expired = (text: string): string =>
    text.replace(
      /\b(?:win-[a-f0-9-]{36}|obs-[a-f0-9]{12}|tab-[a-f0-9]{12}|dom-[a-f0-9]{12})\b/gi,
      '[expired reference; refresh list_windows/inspect_app or browser_tabs/browser_inspect]'
    )
  return messages.map((message) => ({
    ...message,
    ...(message.role === 'tool' && typeof message.content === 'string'
      ? { content: expired(message.content) }
      : {}),
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((call) => ({
            ...call,
            function: { ...call.function, arguments: expired(call.function.arguments) }
          }))
        }
      : {})
  }))
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
  const { window } = contextWindow(model, info)
  if (!window) return { inputBudget: Infinity, reservedOutputTokens: 0 }

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
  const current = latestDesktopObservations(options.current)
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
