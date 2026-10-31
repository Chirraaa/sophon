import { ipcMain, type WebContents, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { trustedDocument } from './trusted-document'
import { getSettings } from '../settings'
import { plainObject } from './tool-contracts'
import { validMemoryDraft } from '../memory/records'
import { validGithubContext } from '../../shared/github-context'
import { DEFAULT_LLAMA_OPTIONS } from '../../shared/llama-server'

type Validator = (value: unknown) => boolean
const text =
  (limit: number): Validator =>
  (v) =>
    typeof v === 'string' && v.length <= limit && !v.includes('\0')
const id: Validator = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)
const oneOf =
  (...values: unknown[]): Validator =>
  (v) =>
    values.includes(v)
const number: Validator = (v) => typeof v === 'number' && Number.isFinite(v)
const audio: Validator = (v) => v instanceof Uint8Array && v.byteLength <= 2000000
function settingsPatch(value: unknown, template: unknown = getSettings(), depth = 0): boolean {
  if (depth > 4 || !plainObject(value) || !plainObject(template)) return false
  return Object.entries(value).every(([key, item]) => {
    if (key === 'policyVersion' || !Object.hasOwn(template, key)) return false
    const expected = template[key]
    if (depth === 0 && key === 'files') return false
    if (depth === 0 && key === 'voice' && plainObject(item)) {
      if ('serverPath' in item || 'modelPath' in item) return false
    }
    if (depth === 0 && key === 'tools')
      return (
        plainObject(item) &&
        Object.entries(item).every(
          ([name, permission]) =>
            plainObject(expected) &&
            Object.hasOwn(expected, name) &&
            ['allow', 'ask', 'block'].includes(permission as string)
        )
      )
    if (Array.isArray(expected))
      return Array.isArray(item) && item.length <= 60 && item.every(text(80))
    if (plainObject(expected)) return settingsPatch(item, expected, depth + 1)
    if (typeof expected === 'string') return text(8000)(item)
    if (typeof expected === 'number') return number(item)
    return typeof item === typeof expected
  })
}
// Only known option names with plain values; the main process then clamps each one.
const llamaOptionsPatch: Validator = (v) =>
  plainObject(v) &&
  Object.entries(v).every(
    ([name, value]) =>
      Object.hasOwn(DEFAULT_LLAMA_OPTIONS, name) &&
      (typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 12))
  )
const contracts: Record<string, { required?: Validator[]; optional?: Validator[] }> = {
  'updates:get': {},
  'updates:check': {},
  'updates:download': {},
  'updates:install': {},
  'updates:acknowledge': {},
  'github:accounts': {},
  'github:call': { required: [id, text(80), text(32000)] },
  'github:history': { required: [validGithubContext, oneOf('get', 'fetch', 'older')] },
  'github:checkout': {
    required: [validGithubContext, oneOf('status', 'link', 'fetch', 'pull', 'unlink')]
  },
  'github:sign-in': { required: [text(200)] },
  'github:sign-in-configured': {},
  'github:poll-sign-in': { required: [id] },
  'github:cancel-sign-in': { required: [id] },
  'plugins:list': {},
  'plugins:import': {},
  'plugins:enable': { required: [id, oneOf(true, false)] },
  'plugins:remove': { required: [id] },
  'plugins:add-server': { required: [text(100), text(32000)] },
  'plugins:update-server': { required: [id, text(100), text(32000)] },
  'plugins:enable-server': { required: [id, oneOf(true, false)] },
  'plugins:remove-server': { required: [id] },
  'plugins:connect': { required: [id] },
  'plugins:disconnect': { required: [id] },
  'pages:preference': {},
  'pages:open': { required: [text(2048), oneOf('reader', 'browser'), oneOf(true, false)] },
  'consent:read': {},
  'consent:resolve': { required: [id, oneOf(true, false)] },
  'memory:list': {},
  'harness:list': {},
  'harness:read': {
    required: [oneOf('skills', 'script-tools', 'subagents', 'loop-hooks'), text(48)]
  },
  'memory:save': { required: [validMemoryDraft] },
  'memory:delete': { required: [id] },
  'memory:undo': { required: [id] },
  'memory:episodes': {},
  'memory:clear-episodes': {},
  'clipboard:write-text': { required: [text(512000)] },
  'text:edit': { required: [oneOf('cut', 'paste', 'selectAll', 'undo', 'redo')] },
  'privacy:clear-security-events': {},
  'visuals:create': { required: [text(512000)] },
  'visuals:image': { required: [text(12 * 1024 * 1024)] },
  'visuals:diagram': { required: [text(20000)] },
  'visuals:release': { required: [id] },
  'visuals:save': { required: [id] },
  'agent:send': {
    required: [text(32000)],
    optional: [
      (v) => Array.isArray(v) && v.length <= 4 && v.every(id),
      oneOf('auto', 'steer', 'parallel')
    ]
  },
  'agent:stop': { optional: [id] },
  'agent:rerun': { required: [id, id, text(32000)] },
  'agent:remove-follow-up': { required: [id, id] },
  'session:get': {},
  'session:github-context': { required: [id, (v) => v === null || validGithubContext(v)] },
  'session:page': { required: [id, (v) => Number.isSafeInteger(v) && Number(v) >= 0] },
  'session:action-details': {
    required: [(v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,1024}$/.test(v)]
  },
  'session:clear': {},
  'chats:create': {},
  'chats:select': { required: [id] },
  'chats:delete': { required: [id] },
  'chats:rename': { required: [id, text(80)] },
  'chats:move': {
    required: [id, (v) => v === null || id(v)],
    optional: [(v) => v === null || id(v)]
  },
  'chats:create-category': { required: [text(60)] },
  'chats:rename-category': { required: [id, text(60)] },
  'chats:delete-category': { required: [id] },
  'approval:resolve': { required: [id, oneOf('once', 'always', 'deny')] },
  'llm:status': {},
  'llm:model-choices': {},
  'llm:modelInfo': {},
  'llm:default-prompt': {},
  'tools:info': {},
  'timers:list': {},
  'timers:remove': { required: [(v) => typeof v === 'string' && /^timer-[0-9a-f]{12}$/.test(v)] },
  'hardware:get': {},
  'attachments:pick': {},
  'attachments:preview': { required: [id] },
  'attachments:save': { required: [id] },
  'attachments:screenshot': {},
  'files:workspace': {},
  'files:revoke': {},
  'voice:get': {},
  'voice:devices-begin': {},
  'voice:devices-end': {},
  'voice:start': {},
  'voice:stop': {},
  'voice:toggle': {},
  'voice:cancel': {},
  'voice:ready': { required: [id] },
  'voice:audio': { required: [id, audio] },
  'voice:error': { required: [id, text(400)] },
  'voice:level': { required: [id, number] },
  'hotkeys:suspend': {},
  'hotkeys:resume': {},
  'compact:presentation': {},
  'compact:work-area': {},
  'compact:task-visible': { required: [oneOf(true, false)] },
  'compact:dock': { required: [oneOf(true, false)] },
  'compact:hide': {},
  'compact:dismiss': {},
  'compact:open-main': {},
  'compact:resize': {
    required: [number],
    optional: [number, (value) => value === 0 || value === 336]
  },
  'settings:get': {},
  'settings:recovery': {},
  'settings:review-recovery': {},
  'settings:update': { required: [(v) => settingsPatch(v)] },
  'settings:reset': {},
  'research:has-key': {},
  'model:has-key': { required: [oneOf('openai', 'compatible', 'anthropic', 'claude'), text(1000)] },
  'chatgpt:status': {},
  'chatgpt:sign-in': { optional: [id] },
  'chatgpt:cancel': {},
  'chatgpt:select': { required: [id] },
  'chatgpt:sign-out': {},
  'chatgpt:welcome': {},
  'chatgpt:usage': {},
  'microsoft:status': {},
  'microsoft:set-client': { required: [text(64)] },
  'microsoft:sign-in': { optional: [id] },
  'microsoft:cancel': {},
  'microsoft:select': { required: [id] },
  'microsoft:remove': { required: [id] },
  'model:set-key': { required: [oneOf('openai', 'compatible', 'anthropic', 'claude'), text(1000), text(4096)] },
  'research:set-key': { required: [text(512)] },
  'llama:get': {},
  'llama:set-enabled': { required: [(v) => typeof v === 'boolean'] },
  'llama:pick-executable': {},
  'llama:pick-model': {},
  'llama:options': { required: [llamaOptionsPatch] },
  'llama:start': {},
  'llama:stop': {}
}
export interface SecureIpc {
  handle: typeof ipcMain.handle
  on: (channel: string, listener: Parameters<typeof ipcMain.on>[1]) => void
}
export function secureIpc(owns: (sender: WebContents | null) => boolean): SecureIpc {
  const rates = new WeakMap<WebContents, Map<string, { at: number; count: number }>>()
  const verify = (
    channel: string,
    event: IpcMainEvent | IpcMainInvokeEvent,
    args: unknown[]
  ): void => {
    if (
      event.sender.isDestroyed() ||
      !owns(event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      !trustedDocument(event.senderFrame?.url ?? '')
    )
      throw new Error('Untrusted IPC sender.')
    const contract = contracts[channel]
    if (!contract) throw new Error('Unregistered IPC contract.')
    const required = contract.required ?? []
    const optional = contract.optional ?? []
    if (
      args.length < required.length ||
      args.length > required.length + optional.length ||
      !required.every((validate, i) => validate(args[i])) ||
      !optional.every(
        (validate, i) =>
          args.length <= required.length + i ||
          args[required.length + i] === undefined ||
          validate(args[required.length + i])
      )
    )
      throw new Error('Invalid IPC payload.')
    const senderRates = rates.get(event.sender) ?? new Map()
    rates.set(event.sender, senderRates)
    const now = Date.now()
    const bucket = senderRates.get(channel) ?? { at: now, count: 0 }
    if (now - bucket.at > 1000) {
      bucket.at = now
      bucket.count = 0
    }
    const limit = ['voice:level', 'compact:resize', 'session:get'].includes(channel) ? 120 : 20
    if (++bucket.count > limit) throw new Error('IPC rate limit exceeded.')
    senderRates.set(channel, bucket)
  }
  return {
    handle: (channel, listener) => {
      if (!contracts[channel]) throw new Error(`Missing IPC contract: ${channel}`)
      ipcMain.handle(channel, (event, ...args) => {
        verify(channel, event, args)
        return listener(event, ...args)
      })
    },
    on: (channel, listener) => {
      if (!contracts[channel]) throw new Error(`Missing IPC contract: ${channel}`)
      ipcMain.on(channel, (event, ...args) => {
        try {
          verify(channel, event, args)
        } catch {
          return
        }
        listener(event, ...args)
      })
    }
  }
}
