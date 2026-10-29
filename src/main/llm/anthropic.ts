import type { ModelMessage, ModelReply, ToolCall } from './types'
import { CodingOutputLimitError } from '../../shared/coding-resources'

type Block = Record<string, unknown>
type WireMessage = { role: 'user' | 'assistant'; content: Block[] }

const VERSION = '2023-06-01'

/** API keys use `x-api-key`; Claude Code tokens (`claude setup-token`) are OAuth bearer tokens. */
export function anthropicHeaders(provider: ModelProvider, token: string): Record<string, string> {
  return provider === 'claude'
    ? {
        Authorization: `Bearer ${token}`,
        'anthropic-version': VERSION,
        'anthropic-beta': 'oauth-2025-04-20'
      }
    : { 'x-api-key': token, 'anthropic-version': VERSION }
}

function imagePart(url: string): Block {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (!match) throw new Error('Anthropic accepts only PNG, JPEG, GIF or WebP image data.')
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
}

function parseInput(text: string): Record<string, unknown> {
  try {
    const value = text.trim() ? JSON.parse(text) : {}
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {
    /* Fall through to the shared error. */
  }
  throw new Error('Invalid tool arguments in the conversation history.')
}

export function anthropicInput(
  messages: ModelMessage[],
  model: string,
  scope?: string
): { system?: string; messages: WireMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
    .join('\n\n')
  const wire: WireMessage[] = []
  const push = (role: WireMessage['role'], content: Block[]): void => {
    if (!content.length) return
    const last = wire[wire.length - 1]
    // Tool results and consecutive user turns must share one user message.
    if (last?.role === role) last.content.push(...content)
    else wire.push({ role, content })
  }
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      if (!message.tool_call_id || typeof message.content !== 'string')
        throw new Error('Invalid tool result for the Messages API.')
      push('user', [
        { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }
      ])
      continue
    }
    const blocks: Block[] = []
    if (
      message.role === 'assistant' &&
      message.responseState?.model === model &&
      message.responseState.scope === scope
    )
      blocks.push(...message.responseState.reasoning)
    if (typeof message.content === 'string') {
      if (message.content.trim()) blocks.push({ type: 'text', text: message.content })
    } else
      for (const part of message.content)
        blocks.push(
          part.type === 'text' ? { type: 'text', text: part.text } : imagePart(part.image_url.url)
        )
    for (const call of message.tool_calls ?? [])
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parseInput(call.function.arguments)
      })
    push(message.role, blocks)
  }
  return { ...(system ? { system } : {}), messages: wire }
}

export function anthropicTools(
  tools: { function: { name: string; description?: string; parameters?: unknown } }[]
): Block[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? '',
    input_schema: tool.function.parameters ?? { type: 'object', properties: {} }
  }))
}

export function anthropicUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return
  const usage = raw as Record<string, unknown>
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  const cached = count(usage.cache_read_input_tokens)
  // Anthropic reports cache reads and writes separately from `input_tokens`.
  const input = count(usage.input_tokens) + cached + count(usage.cache_creation_input_tokens)
  const output = count(usage.output_tokens)
  if (typeof usage.input_tokens !== 'number' && typeof usage.output_tokens !== 'number') return
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    ...(usage.cache_read_input_tokens !== undefined ? { cachedInputTokens: cached } : {})
  }
}

function refusal(data: Record<string, unknown>): Error {
  const details = data.stop_details as { category?: unknown } | null | undefined
  const category = typeof details?.category === 'string' ? ` (${details.category})` : ''
  return new Error(`Claude declined this request${category}. Rephrase it or try another model.`)
}

export function anthropicReply(
  data: Record<string, unknown>,
  model: string,
  scope?: string
): ModelReply {
  if (data.type !== 'message' || !Array.isArray(data.content))
    throw new Error('The Messages API did not return a message.')
  if (data.stop_reason === 'refusal') throw refusal(data)
  let content = ''
  const calls: ToolCall[] = []
  const thinking: Block[] = []
  for (const block of data.content as Block[]) {
    if (!block || typeof block !== 'object') throw new Error('Invalid Messages content block.')
    if (block.type === 'text' && typeof block.text === 'string') content += block.text
    else if (block.type === 'thinking' || block.type === 'redacted_thinking') thinking.push(block)
    else if (block.type === 'tool_use') {
      if (
        typeof block.id !== 'string' ||
        typeof block.name !== 'string' ||
        !block.input ||
        typeof block.input !== 'object'
      )
        throw new Error('Invalid Messages tool call.')
      calls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) }
      })
    } else throw new Error('Unsupported Messages content block.')
  }
  const truncated = data.stop_reason === 'max_tokens'
  if (truncated && calls.length) throw new CodingOutputLimitError()
  if (
    !['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn'].includes(
      String(data.stop_reason)
    )
  )
    throw new Error('The Messages API returned an unknown stop reason.')
  const usage = anthropicUsage(data.usage)
  return {
    content,
    ...(usage ? { usage } : {}),
    finishReason: truncated ? 'length' : calls.length ? 'tool_calls' : 'stop',
    ...(calls.length ? { tool_calls: calls } : {}),
    // Thinking blocks must be replayed unchanged alongside tool results.
    ...(thinking.length && calls.length
      ? { responseState: { model, ...(scope ? { scope } : {}), reasoning: thinking } }
      : {})
  }
}

export function anthropicStream(
  onText: (text: string) => void,
  model: string,
  scope?: string,
  onProgress?: (progress: ModelProgress) => void
): {
  accept: (data: string) => void
  reply: () => ModelReply
  usage: () => TokenUsage | undefined
} {
  const blocks = new Map<number, Block & { json?: string }>()
  let text = ''
  let generatedChars = 0
  let stopReason: unknown
  let details: unknown
  let usage: Record<string, unknown> = {}
  let ended = false
  return {
    usage: () => anthropicUsage(usage),
    accept(data) {
      const event = JSON.parse(data)
      if (!event || typeof event !== 'object' || typeof event.type !== 'string')
        throw new Error('Invalid Messages stream envelope.')
      if (event.type === 'error') throw new Error('The Messages API stream failed.')
      if (event.type === 'message_start') usage = { ...(event.message?.usage ?? {}) }
      if (event.type === 'content_block_start') {
        if (!Number.isInteger(event.index) || event.index < 0 || event.index >= 1000)
          throw new Error('Invalid Messages block index.')
        if (event.content_block?.type === 'tool_use')
          onProgress?.({ toolName: event.content_block.name ?? '', generatedChars })
        blocks.set(event.index, {
          ...event.content_block,
          ...(event.content_block?.type === 'tool_use' ? { json: '' } : {})
        })
      }
      if (event.type === 'content_block_delta') {
        const block = blocks.get(event.index)
        const delta = event.delta
        if (!block || !delta || typeof delta !== 'object')
          throw new Error('Invalid Messages block delta.')
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          block.text = `${block.text ?? ''}${delta.text}`
          text += delta.text
          onText(text)
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          block.json = (block.json ?? '') + delta.partial_json
          generatedChars += delta.partial_json.length
          onProgress?.({ toolName: String(block.name ?? ''), generatedChars })
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string')
          block.thinking = `${block.thinking ?? ''}${delta.thinking}`
        else if (delta.type === 'signature_delta' && typeof delta.signature === 'string')
          block.signature = delta.signature
      }
      if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason
        details = event.delta?.stop_details ?? details
        usage = { ...usage, ...(event.usage ?? {}) }
      }
      if (event.type === 'message_stop') ended = true
    },
    reply() {
      if (!ended || !stopReason)
        throw new Error('The model stream ended before completing its answer.')
      const content = [...blocks]
        .sort(([a], [b]) => a - b)
        .map(([, block]) => {
          const { json, ...rest } = block
          if (rest.type !== 'tool_use') return rest
          try {
            return { ...rest, input: json?.trim() ? JSON.parse(json) : {} }
          } catch {
            throw new Error('The model returned an unfinished tool call. No tools were executed.')
          }
        })
      const result = anthropicReply(
        { type: 'message', content, stop_reason: stopReason, stop_details: details, usage },
        model,
        scope
      )
      if (!result.content?.trim() && !result.tool_calls?.length)
        throw new Error(
          'The model completed without answer text or tool calls. Please retry the request.'
        )
      return result
    }
  }
}
