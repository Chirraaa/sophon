import { callLLM } from './client'
import { contextBudget, estimateMessages } from './context'
import { deniesDesktopCapability, requestedDesktopTool } from './environment'
import type { ModelMessage, ModelReply } from './types'
import type { activeToolSchemas } from '../tools'

export async function correctDesktopReply(
  model: string,
  messages: ModelMessage[],
  reply: ModelReply,
  options: {
    query: string
    tools: ReturnType<typeof activeToolSchemas>
    settings: AppSettings['model']
    onText?: (text: string) => void
  }
): Promise<ModelReply> {
  const expected = requestedDesktopTool(options.query)
  if (
    reply.tool_calls?.length ||
    !expected ||
    !options.tools.some((tool) => tool.function.name === expected) ||
    !deniesDesktopCapability(reply.content ?? '')
  )
    return reply
  const correction: ModelMessage[] = [
    ...messages,
    {
      role: 'system',
      content: `Capability check: the previous draft claimed no desktop interaction was possible, but ${expected} is supplied for this requested action. Reconsider using the LIVE APPLICATION ENVIRONMENT above. Call an appropriate available tool if the original request is supported; otherwise explain its specific limitation. Never invent execution or approval. Do not expand the user's request, bypass a restriction, or retry a denied/failed action.`
    }
  ]

  if (
    estimateMessages(correction) > contextBudget(options.settings, options.tools, false).inputBudget
  )
    return reply
  return (
    (await callLLM(model, correction, {
      allowTools: true,
      tools: options.tools,
      onText: options.onText
    })) ?? reply
  )
}
