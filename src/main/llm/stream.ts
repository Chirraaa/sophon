import type { ModelReply, ToolCall } from './types'
import { CodingOutputLimitError } from '../../shared/coding-resources'
import { tokenUsage } from '../../shared/model-usage'

export function completionStream(
  onText: (text: string) => void,
  onProgress?: (progress: ModelProgress) => void
): {
  accept: (data: string) => void
  reply: () => ModelReply
  usage: () => TokenUsage | undefined
} {
  let content = ''
  let finishReason: string | undefined
  let done = false
  let usage: TokenUsage | undefined
  const calls = new Map<number, ToolCall>()
  let generatedChars = 0
  return {
    usage: () => usage,
    accept(data) {
      if (done) return
      if (data === '[DONE]') {
        done = true
        return
      }
      const event = JSON.parse(data)
      if (!event || typeof event !== 'object' || !Array.isArray(event.choices))
        throw new Error('Invalid assistant stream envelope.')
      if (event.error) throw new Error('The model stream returned an error.')
      usage = tokenUsage(event.usage) ?? usage
      const choice = event.choices?.[0]
      if (!choice) return
      const delta = choice.delta ?? (choice.finish_reason ? {} : undefined)
      if (
        !delta ||
        typeof delta !== 'object' ||
        Array.isArray(delta) ||
        (delta.role !== undefined && delta.role !== 'assistant')
      )
        throw new Error('Invalid assistant stream envelope.')
      if (delta.content !== undefined && delta.content !== null) {
        if (typeof delta.content !== 'string') throw new Error('Invalid streamed content.')
        content += delta.content
        onText(content)
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls)) throw new Error('Invalid streamed tool calls.')
        for (const part of delta.tool_calls) {
          if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 60)
            throw new Error('Invalid streamed tool index.')
          const call = calls.get(part.index) ?? {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' }
          }
          if (part.type !== undefined && part.type !== 'function')
            throw new Error('Invalid streamed tool type.')
          for (const value of [part.id, part.function?.name, part.function?.arguments])
            if (value !== undefined && typeof value !== 'string')
              throw new Error('Invalid streamed tool fragment.')
          call.id += part.id ?? ''
          call.function.name += part.function?.name ?? ''
          call.function.arguments += part.function?.arguments ?? ''
          calls.set(part.index, call)
          generatedChars += (part.function?.arguments ?? '').length
          onProgress?.({ toolName: call.function.name, generatedChars })
        }
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== 'string')
          throw new Error('Invalid stream finish reason.')
        finishReason = choice.finish_reason
      }
    },
    reply() {
      if (!finishReason) throw new Error('The model stream ended before completing its answer.')
      if (calls.size && finishReason === 'length') throw new CodingOutputLimitError()
      if (calls.size && !['stop', 'tool_calls'].includes(finishReason))
        throw new Error('The model returned an incomplete tool batch. No tools were executed.')
      return {
        content,
        ...(usage ? { usage } : {}),
        finishReason,
        ...(calls.size
          ? { tool_calls: [...calls].sort(([a], [b]) => a - b).map(([, call]) => call) }
          : {})
      }
    }
  }
}
