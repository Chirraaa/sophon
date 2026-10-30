import { getSettings } from '../settings'
import { qwenSampling } from '../../shared/model-tuning'
import { activeToolSchemas } from '../tools'
import { requestJson } from '../network/json-request'
import { modelEndpoint } from '../network/endpoint'
import { currentRun, assertRun } from '../security/run-manager'
import type { ModelMessage as Msg, ModelReply } from './types'
import { contextBudget, assertContextFits, measureContext } from './context'
import { modelCapabilities, supportedEffort } from '../../shared/model-capabilities'
import { addUsage, tokenUsage } from '../../shared/model-usage'
import { recordTiming } from '../workflow/timing'
import { completionStream } from './stream'
import { responsesInput, responsesReply, responsesStream, chatgptFailure } from './providers'
import {
  anthropicHeaders,
  anthropicInput,
  anthropicReply,
  anthropicStream,
  anthropicTools
} from './anthropic'
import { modelKey } from '../security/model-credentials'
import { chatgptAccessToken, chatgptAccountScope, chatgptStatus } from '../security/chatgpt-auth'
import { performance } from 'node:perf_hooks'
import { timeContext, withClock } from './time'

const taskClocks = new WeakMap<object, number>()
async function request(
  path: string,
  body?: string,
  timeout = 120000,
  onEvent?: (data: string) => void
): Promise<Record<string, unknown>> {
  const run = currentRun()
  if (run) assertRun(run)
  const settings = getSettings().model
  const provider = settings.provider ?? 'local'
  const base = modelEndpoint(run?.endpoint ?? settings.endpoint, provider)
  const token =
    provider === 'chatgpt'
      ? await chatgptAccessToken()
      : provider !== 'local'
        ? modelKey(provider, base)
        : undefined
  if (run) assertRun(run)
  const data = await requestJson(
    new URL(
      `${base}${path}${path === '/models' && (provider === 'anthropic' || provider === 'claude') ? '?limit=100' : ''}`
    ),
    {
      body,
      signal: run?.signal,
      timeout,
      ...(onEvent ? { streamIdleTimeout: timeout } : {}),
      // Token-sized SSE envelopes can be much larger than the generated source.
      ...(onEvent ? { maxBytes: 32 * 1024 * 1024 } : {}),
      modelErrors: provider !== 'chatgpt',
      errorDetails: provider === 'chatgpt',
      ...(token
        ? {
            headers:
              provider === 'anthropic' || provider === 'claude'
                ? anthropicHeaders(provider, token)
                : { Authorization: `Bearer ${token}` }
          }
        : {}),
      onEvent
    }
  ).catch((error) => {
    throw provider === 'chatgpt' ? chatgptFailure(error) : error
  })
  if (run) assertRun(run)
  if (data === null && onEvent) return { streamed: true }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid model response.')
  return data as Record<string, unknown>
}
function modelChoicesFrom(data: Record<string, unknown>): ModelChoice[] {
  if (Array.isArray(data.models)) {
    const listed = data.models.slice(0, 100).flatMap((m) => {
      if (m?.visibility !== 'list' || typeof m.slug !== 'string' || m.slug.length > 200) return []
      return [
        {
          id: m.slug,
          label: typeof m.display_name === 'string' ? m.display_name.slice(0, 200) : m.slug,
          ...modelCapabilities(m.slug, getSettings().model.provider ?? 'local', m)
        }
      ]
    })
    // llama.cpp also sends an Ollama-style `models` array next to the OpenAI-style `data`,
    // so an empty result here must not hide the models listed under `data`.
    if (listed.length || !Array.isArray(data.data)) return listed
  }
  if (Array.isArray(data.data))
    return data.data.slice(0, 100).flatMap((m) =>
      typeof m?.id === 'string' && m.id.length <= 200
        ? [
            {
              id: m.id,
              // llama.cpp names the model by its file path; show the file name.
              label:
                typeof m.display_name === 'string'
                  ? m.display_name.slice(0, 200)
                  : /^[A-Za-z]:[\\/]/.test(m.id)
                    ? m.id.replace(/^.*[\\/]/, '')
                    : m.id,
              ...modelCapabilities(m.id, getSettings().model.provider ?? 'local', m)
            }
          ]
        : []
    )
  return []
}
export async function getModel(): Promise<string> {
  const chosen = getSettings().model.modelId
  if (chosen) return chosen
  if (getSettings().model.provider && getSettings().model.provider !== 'local')
    throw new Error('Choose a model ID in Settings > Model before using an API provider.')
  const id = modelChoicesFrom(await request('/models'))[0]?.id
  if (!id) throw new Error('The model server has no model loaded.')
  return id
}
let statusCache: { key: string; expires: number; result: Promise<LlmStatus> } | undefined
export async function getLlmStatus(): Promise<LlmStatus> {
  const settings = getSettings().model
  const provider = settings.provider ?? 'local'

  const account = provider === 'chatgpt' ? chatgptStatus() : undefined
  const key = JSON.stringify([provider, settings.endpoint, settings.modelId, account])
  if (statusCache?.key === key && statusCache.expires > Date.now()) return statusCache.result
  const entry = {
    key,
    expires: Infinity,
    result: checkLlmStatus()
  }
  statusCache = entry
  void entry.result.then((status) => {
    entry.expires = Date.now() + (provider === 'local' ? 15000 : status.online ? 300000 : 60000)
  })
  return entry.result
}
async function checkLlmStatus(): Promise<LlmStatus> {
  try {
    const models = modelChoicesFrom(await request('/models', undefined, 1500))
    const settings = getSettings().model
    if ((settings.provider ?? 'local') !== 'local' && !settings.modelId) return { online: false }
    if ((settings.provider ?? 'local') === 'local' && models.length === 0) return { online: false }
    return { online: true, model: getSettings().model.modelId || models[0]?.id }
  } catch {
    return { online: false }
  }
}
let catalog: { key: string; expires: number; result: Promise<ModelChoice[]> } | undefined
export async function listModelChoices(refresh = true): Promise<ModelChoice[]> {
  const settings = getSettings().model
  const key = JSON.stringify([
    settings.provider,
    settings.endpoint,
    settings.provider === 'chatgpt' ? chatgptStatus() : undefined
  ])
  if (
    catalog?.key === key &&
    (!refresh || catalog.expires === Infinity) &&
    catalog.expires > Date.now()
  )
    return catalog.result
  const entry = {
    key,
    expires: Infinity,
    result: request('/models', undefined, 3000)
      .then(modelChoicesFrom)
      .catch(() => [])
  }
  catalog = entry
  void entry.result.then((models) => {
    entry.expires = Date.now() + (models.length ? 300000 : 30000)
  })
  return entry.result
}
export async function getModelInfo(model = getSettings().model.modelId): Promise<ModelChoice> {
  const settings = getSettings().model
  const choices = await listModelChoices(false)
  const id = model || (settings.provider === 'local' ? choices[0]?.id : '') || ''
  return (
    choices.find((choice) => choice.id === id) ?? {
      id,
      label: id || 'No model selected',
      ...modelCapabilities(id, settings.provider ?? 'local', undefined)
    }
  )
}
export async function callLLM(
  model: string,
  messages: Msg[],
  {
    visual = false,
    allowTools = true,
    tools: selectedTools,
    outputTokens,
    timeoutMs = 120000,
    onText,
    onProgress,
    volatile
  }: {
    visual?: boolean
    allowTools?: boolean
    tools?: ReturnType<typeof activeToolSchemas>
    outputTokens?: number
    timeoutMs?: number
    onText?: (text: string) => void
    onProgress?: (progress: ModelProgress) => void
    /** Text that changes every call (run state); it travels with the clock, after the stable prefix. */
    volatile?: string
  } = {}
): Promise<ModelReply | null> {
  const s = { ...getSettings().model, ...(outputTokens ? { maxTokens: outputTokens } : {}) }
  const provider = s.provider ?? 'local'
  const plan = provider === 'chatgpt'
  const scope = plan ? chatgptAccountScope() : undefined
  const responses = plan || provider === 'openai'
  const tools = allowTools ? (selectedTools ?? activeToolSchemas()) : []
  const claude = provider === 'anthropic' || provider === 'claude'
  const info = ['openai', 'chatgpt', 'anthropic', 'claude'].includes(provider)
    ? await getModelInfo(model)
    : { id: model, label: model }
  const budget = contextBudget(s, tools, visual, info)
  const clockRun = currentRun()
  let started = performance.now()
  if (clockRun) {
    if (!taskClocks.has(clockRun)) taskClocks.set(clockRun, started)
    started = clockRun.startedAt ?? taskClocks.get(clockRun)!
  }

  const system = messages.filter((message) => message.role === 'system')
  const normalized: Msg[] = withClock(
    [
      ...(system.length
        ? [
            {
              role: 'system' as const,
              content: system
                .map((message) => {
                  if (typeof message.content !== 'string')
                    throw new Error('System instructions must be text.')
                  return message.content
                })
                .join('\n\n')
            }
          ]
        : []),
      ...messages
        .filter((message) => message.role !== 'system')
        .map((message) => {
          if (
            !message.responseState ||
            ((responses || claude) &&
              message.responseState.model === model &&
              message.responseState.scope === scope)
          )
            return message
          const sent = { ...message }
          delete sent.responseState
          return sent
        })
    ],
    [timeContext(started), volatile].filter(Boolean).join('\n\n')
  )
  assertContextFits(normalized, budget.inputBudget)
  const run = currentRun()
  if (run) {
    assertRun(run)
    if (run.modelCalls >= (run.modelCallLimit ?? s.maxSteps))
      throw new Error('The task reached its model-call limit.')
    run.modelCalls = (run.modelCalls ?? 0) + 1
  }
  const effort = supportedEffort(s.reasoningEffort, info)
  if (run) {
    assertRun(run)
    run.onModelContext?.(measureContext(normalized, tools, s, visual, info))
  }
  const stream =
    onText || onProgress || plan || (claude && budget.reservedOutputTokens > 16000)
      ? claude
        ? anthropicStream(onText ?? (() => {}), model, undefined, onProgress)
        : responses
          ? responsesStream(
              onText ?? (() => {}),
              model,
              plan ? 'sophon' : undefined,
              scope,
              onProgress
            )
          : completionStream(onText ?? (() => {}), onProgress)
      : undefined
  let measured: TokenUsage | undefined
  const requested = performance.now()
  try {
    const data = await request(
      claude ? '/messages' : responses ? '/responses' : '/chat/completions',
      JSON.stringify(
        claude
          ? {
              model,
              max_tokens: Math.max(1, budget.reservedOutputTokens),
              ...anthropicInput(normalized, model),
              ...(stream ? { stream: true } : {}),
              ...(tools.length ? { tools: anthropicTools(tools) } : {}),
              ...(effort ? { thinking: { type: 'adaptive' }, output_config: { effort } } : {}),
              cache_control: { type: 'ephemeral' }
            }
          : responses
            ? {
                model,
                store: false,
                ...(effort ? { reasoning: { effort } } : {}),
                include: ['reasoning.encrypted_content'],
                ...(stream ? { stream: true } : {}),
                input: responsesInput(normalized, model, plan ? 'sophon' : undefined, scope).map(
                  (item) => (plan && item.role === 'system' ? { ...item, role: 'developer' } : item)
                ),
                ...(tools.length
                  ? {
                      tools: plan
                        ? [
                            {
                              type: 'namespace',
                              name: 'sophon',
                              description:
                                'Sophon application tools. Application permissions apply to every call.',
                              tools: tools.map((tool) => ({
                                type: 'function',
                                ...tool.function,
                                strict: false
                              }))
                            }
                          ]
                        : tools.map((tool) => ({
                            type: 'function',
                            ...tool.function,
                            strict: false
                          }))
                    }
                  : {}),
                ...(!allowTools ? { tool_choice: 'none' } : {}),
                ...(!plan && !visual ? { max_output_tokens: budget.reservedOutputTokens } : {})
              }
            : {
                model,
                ...(stream ? { stream: true } : {}),
                messages: normalized.map((message) => {
                  const wire = { ...message }
                  delete wire.responseState
                  delete wire.contextGroup
                  return wire
                }),
                ...(tools.length ? { tools } : {}),
                ...(!allowTools ? { tool_choice: 'none' } : {}),
                temperature: s.temperature,
                ...(provider === 'local' && /qwen3[.\-_]?5/i.test(model)
                  ? qwenSampling(s.thinking)
                  : {}),
                ...(!visual ? { max_tokens: budget.reservedOutputTokens } : {}),
                ...(provider === 'local'
                  ? { chat_template_kwargs: { enable_thinking: s.thinking } }
                  : {})
              }
      ),
      timeoutMs,
      stream?.accept
    )
    if (data.streamed && stream) {
      const reply = stream.reply()
      measured = reply.usage
      return reply
    }
    measured = tokenUsage(data.usage)
    if (claude) return anthropicReply(data, model)
    if (responses) return responsesReply(data, model, plan ? 'sophon' : undefined, scope)
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined
    if (
      choice?.message?.tool_calls?.length &&
      !['stop', 'tool_calls'].includes(choice.finish_reason)
    )
      throw new Error('The model returned an incomplete tool batch. No tools were executed.')
    if (
      choice?.message &&
      (choice.message.role !== 'assistant' ||
        (choice.message.content !== null &&
          choice.message.content !== undefined &&
          typeof choice.message.content !== 'string'))
    )
      throw new Error('Invalid assistant response envelope.')
    return choice?.message
      ? {
          ...choice.message,
          finishReason: choice.finish_reason,
          ...(measured ? { usage: measured } : {})
        }
      : null
  } finally {
    measured ??= stream?.usage()
    if (run) {
      run.usage = addUsage(run.usage, measured)
      run.onModelUsage?.(run.usage)
      recordTiming(run, 'model', performance.now() - requested)
    }
  }
}
