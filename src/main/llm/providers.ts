import type { ModelMessage, ModelReply, ToolCall } from './types'
import { CodingOutputLimitError } from '../../shared/coding-resources'
import { tokenUsage } from '../../shared/model-usage'

type ResponseItem = Record<string, unknown>
export function responsesInput(
  messages: ModelMessage[],
  model: string,
  namespace?: string,
  scope?: string
): ResponseItem[] {
  return messages.flatMap((message): ResponseItem[] => {
    if (message.role === 'tool') {
      if (!message.tool_call_id || typeof message.content !== 'string')
        throw new Error('Invalid tool result for Responses API.')
      return [
        { type: 'function_call_output', call_id: message.tool_call_id, output: message.content }
      ]
    }
    const items: ResponseItem[] = []
    if (
      message.role === 'assistant' &&
      message.responseState?.model === model &&
      message.responseState.scope === scope
    )
      items.push(...message.responseState.reasoning)
    if (message.content && (!Array.isArray(message.content) || message.content.length)) {
      items.push({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) =>
                part.type === 'text'
                  ? {
                      type: message.role === 'assistant' ? 'output_text' : 'input_text',
                      text: part.text
                    }
                  : { type: 'input_image', image_url: part.image_url.url, detail: 'auto' }
              )
      })
    }
    for (const call of message.tool_calls ?? [])
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        ...(namespace ? { namespace } : {}),
        arguments: call.function.arguments
      })
    return items
  })
}

export function responsesReply(
  data: Record<string, unknown>,
  model: string,
  namespace?: string,
  scope?: string
): ModelReply {
  if (
    !data ||
    !['completed', 'incomplete'].includes(String(data.status)) ||
    !Array.isArray(data.output)
  )
    throw new Error('The Responses API did not complete successfully.')
  if (
    data.status === 'incomplete' &&
    (data.incomplete_details as { reason?: string } | undefined)?.reason !== 'max_output_tokens'
  )
    throw new Error('The Responses API returned an incomplete response.')
  let content = ''
  const calls: ToolCall[] = []
  const callIds = new Set<string>()
  const reasoning: ResponseItem[] = []
  for (const item of data.output as ResponseItem[]) {
    if (!item || typeof item !== 'object') throw new Error('Invalid Responses output item.')
    if (item.type === 'reasoning') {
      if (typeof item.encrypted_content === 'string') reasoning.push(item)
    } else if (item.type === 'function_call') {
      if (namespace && item.namespace !== namespace)
        throw new Error('The model requested an unknown tool namespace. No tools were executed.')
      if (
        typeof item.call_id !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.arguments !== 'string'
      )
        throw new Error('Invalid Responses tool call.')
      if (!item.call_id || !item.name || callIds.has(item.call_id))
        throw new Error('Invalid or duplicate Responses tool call. No tools were executed.')
      callIds.add(item.call_id)
      calls.push({
        id: item.call_id,
        type: 'function',
        function: { name: item.name, arguments: item.arguments }
      })
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content))
        throw new Error('Invalid Responses message.')
      for (const part of item.content) {
        if (!part || typeof part !== 'object') throw new Error('Invalid Responses message content.')
        if (part.type === 'output_text' && typeof part.text === 'string') content += part.text
        else if (part.type === 'refusal' && typeof part.refusal === 'string')
          content += part.refusal
        else throw new Error('Unsupported Responses message content.')
      }
    } else throw new Error('Unsupported Responses output item.')
  }

  if (data.status === 'incomplete' && calls.length) throw new CodingOutputLimitError()
  return {
    content,
    ...(tokenUsage(data.usage) ? { usage: tokenUsage(data.usage) } : {}),
    finishReason: data.status === 'incomplete' ? 'length' : calls.length ? 'tool_calls' : 'stop',
    ...(calls.length ? { tool_calls: calls } : {}),
    ...(reasoning.length
      ? { responseState: { model, ...(scope ? { scope } : {}), reasoning } }
      : {})
  }
}

export function responsesStream(
  onText: (text: string) => void,
  model: string,
  namespace?: string,
  scope?: string
): {
  accept: (data: string) => void
  reply: () => ModelReply
  usage: () => TokenUsage | undefined
} {
  let content = ''
  let usage: TokenUsage | undefined
  let result: ModelReply | undefined
  const completedItems = new Map<number, ResponseItem>()
  const pendingTools = new Set<number>()
  const identity = (item: ResponseItem): unknown =>
    item.type === 'function_call' ? (item.call_id ?? item.id) : item.id
  return {
    usage: () => usage,
    accept(data) {
      if (data === '[DONE]') return
      const event = JSON.parse(data)
      if (!event || typeof event !== 'object' || typeof event.type !== 'string')
        throw new Error('Invalid Responses stream envelope.')
      if (event.type === 'error' || event.type === 'response.failed')
        throw namespace
          ? chatgptFailure(event.response?.error ?? event.error ?? event)
          : new Error('The Responses API stream failed.')
      if (result) return
      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        if (
          !Number.isInteger(event.output_index) ||
          event.output_index < 0 ||
          event.output_index >= 1000
        )
          throw new Error('Invalid Responses tool index.')
        pendingTools.add(event.output_index)
      }
      if (event.type === 'response.function_call_arguments.delta') {
        if (
          !Number.isInteger(event.output_index) ||
          event.output_index < 0 ||
          event.output_index >= 1000 ||
          typeof event.delta !== 'string'
        )
          throw new Error('Invalid Responses tool argument delta.')
        if (completedItems.has(event.output_index))
          throw new Error(
            'Tool arguments arrived after the tool item completed. No tools were executed.'
          )
        pendingTools.add(event.output_index)
      }
      if (event.type === 'response.output_item.done') {
        if (
          !Number.isInteger(event.output_index) ||
          event.output_index < 0 ||
          event.output_index >= 1000 ||
          !event.item ||
          typeof event.item !== 'object' ||
          Array.isArray(event.item)
        )
          throw new Error('Invalid completed Responses output item.')
        if (completedItems.has(event.output_index))
          throw new Error('Duplicate completed Responses output item.')
        if (pendingTools.has(event.output_index) && event.item.type !== 'function_call')
          throw new Error('Conflicting completed Responses tool item. No tools were executed.')
        completedItems.set(event.output_index, event.item)
        pendingTools.delete(event.output_index)
      }
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        if (typeof event.delta !== 'string') throw new Error('Invalid Responses text delta.')
        content += event.delta
        onText(content)
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        const response = event.response
        usage = tokenUsage(response?.usage)
        if (
          !response ||
          typeof response !== 'object' ||
          response.status !== (event.type === 'response.completed' ? 'completed' : 'incomplete')
        )
          throw new Error('Invalid terminal Responses status.')

        let output = response?.output
        if (output === undefined && content) output = []
        if (completedItems.size && (output === undefined || Array.isArray(output))) {
          const merged = new Map(completedItems)
          const terminalIds = new Set<unknown>()
          for (const [index, item] of (output ?? []).entries()) {
            if (!item || typeof item !== 'object') throw new Error('Invalid Responses output item.')
            if (identity(item) !== undefined) {
              if (terminalIds.has(identity(item)))
                throw new Error('Duplicate terminal Responses output item. No tools were executed.')
              terminalIds.add(identity(item))
            }
            const match = [...merged].find(([key, saved]) =>
              identity(item) !== undefined
                ? identity(item) === identity(saved)
                : key === index && saved.type === item.type && identity(saved) === undefined
            )
            if (match) {
              const [key, saved] = match
              if (
                saved.type !== item.type ||
                (saved.type === 'function_call' &&
                  ['call_id', 'name', 'namespace', 'arguments'].some(
                    (field) => saved[field] !== item[field]
                  ))
              )
                throw new Error(
                  'Conflicting completed Responses output item. No tools were executed.'
                )

              merged.set(
                key,
                item.type === 'message' && Array.isArray(item.content) && !item.content.length
                  ? saved
                  : item
              )
            } else {
              let key = index
              while (merged.has(key)) key++
              merged.set(key, item)
            }
          }
          output = [...merged].sort(([a], [b]) => a - b).map(([, item]) => item)
        }
        for (const index of pendingTools) {
          if (!Array.isArray(response.output) || response.output[index]?.type !== 'function_call') {
            if (
              response.status === 'incomplete' &&
              response.incomplete_details?.reason === 'max_output_tokens'
            )
              throw new CodingOutputLimitError()
            throw new Error('The model returned an unfinished tool call. No tools were executed.')
          }
        }
        result = responsesReply({ ...response, output }, model, namespace, scope)

        if (!result.content && content) result = { ...result, content }
      }
    },
    reply() {
      if (!result) throw new Error('The model stream ended before completing its answer.')
      if (!result.content?.trim() && !result.tool_calls?.length)
        throw new Error(
          'The model completed without answer text or tool calls. Please retry the request.'
        )
      return result
    }
  }
}

export function chatgptFailure(error: unknown): Error {
  const detail = error as { code?: string; message?: string }
  const messages: Record<string, string> = {
    subscription_sharing_usage_limit_exceeded:
      'ChatGPT plan usage limit reached. Open Manage usage in Settings > Model to review the applicable limit.',
    subscription_sharing_usage_unavailable:
      'ChatGPT plan usage is temporarily unavailable. Try again later or review Manage usage in Settings > Model.',
    subscription_sharing_user_not_eligible:
      'ChatGPT plan usage is unavailable for this account or workspace. Check your ChatGPT plan and app access.',
    subscription_sharing_invalid_user:
      'ChatGPT could not validate this connection. Sign in again in Settings > Model.',
    subscription_sharing_unsupported_capability:
      'This capability is not supported by the ChatGPT subscription connection.',
    subscription_sharing_route_not_supported:
      'This request route is not supported by the ChatGPT subscription connection.',
    chatpass_v2_scope_not_authorized:
      'ChatGPT plan permission was not granted. Enable plan usage in Settings > Model.'
  }
  const code = typeof detail?.code === 'string' ? detail.code : ''
  const source = error as { statusCode?: number; requestId?: string }
  return Object.assign(
    new Error(messages[code] ?? detail?.message ?? 'The ChatGPT subscription request failed.'),
    {
      ...(code ? { code } : {}),
      ...(Number.isInteger(source?.statusCode) ? { statusCode: source.statusCode } : {}),
      ...(typeof source?.requestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(source.requestId)
        ? { requestId: source.requestId }
        : {})
    }
  )
}
