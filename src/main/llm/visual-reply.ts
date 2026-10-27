import { callLLM } from './client'
import { VISUAL_CAPABILITIES } from './visuals'
import { INLINE_VISUAL_TASK } from './visual-routing'
import type { ModelMessage, ModelReply } from './types'

export async function correctVisualToolCall(
  model: string,
  messages: ModelMessage[],
  reply: ModelReply,
  onText?: (text: string) => void
): Promise<ModelReply> {
  if (!reply.tool_calls?.length) return reply
  const correction = await callLLM(
    model,
    [
      ...messages,
      {
        role: 'system',
        content:
          INLINE_VISUAL_TASK +
          ' Your last response requested a tool instead of generating the visual. That tool was not executed. Answer directly now.'
      }
    ],
    { visual: true, allowTools: false, onText }
  )
  if (!correction || correction.tool_calls?.length)
    throw new Error(
      'The model kept requesting desktop tools instead of generating the inline visual. No desktop action was run. Try requesting one visual at a time.'
    )
  return correction
}

export function deniesInteractiveSupport(content: string): boolean {
  if (/(?:^|\n)\s*(?:`{3,}|~{3,})\s*(?:html|svg|visualization)\b/i.test(content)) return false
  let denialList = false
  return content.split(/\n|[.!?](?=\s)/).some((line) => {
    const text = line.replace(/[*_]/g, '').replace(/’/g, "'").trim()
    if (/^what i (?:cannot|can't) do\s*:/i.test(text)) denialList = true
    else if (/^(?:what i can do|if you|would you|however|instead)\b/i.test(text)) denialList = false
    if (/\b(?:http|https|network|external|remote|fetch|file access|desktop access)\b/i.test(text))
      return false
    const unsupported =
      /\b(?:cannot|can't|unable to|not able to|do not support|does not support|doesn't support|can't actually)\b/i.test(
        text
      )
    const interactive =
      /\b(?:interactive (?:widgets?|components?|sliders?|charts?|visuals?)|(?:working|functional|live) (?:sliders?|widgets?|components?)|(?:run|execute) (?:html|javascript))\b/i.test(
        text
      )
    return (denialList || unsupported) && interactive
  })
}

export async function correctVisualReply(
  model: string,
  messages: ModelMessage[],
  reply: ModelReply,
  onText?: (text: string) => void
): Promise<ModelReply> {
  if (reply.tool_calls?.length || !deniesInteractiveSupport(reply.content ?? '')) return reply
  const correction = await callLLM(
    model,
    [
      ...messages,
      { role: 'assistant', content: reply.content ?? '' },
      {
        role: 'system',
        content: `${VISUAL_CAPABILITIES}\nYour previous answer incorrectly denied an available renderer capability. Answer the user's original request using these actual capabilities. If they requested a widget, return complete fenced HTML with working controls. Do not call desktop tools. If they only asked about capabilities, explain them accurately. Preserve the external-network limitation and any other applicable restrictions.`
      }
    ],
    { visual: true, allowTools: false, onText }
  )
  return correction ?? reply
}
