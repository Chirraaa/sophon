import { app } from 'electron'
import { join } from 'path'
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  unlinkSync,
  constants
} from 'fs'
import { randomUUID } from 'crypto'
import { validateShortcut } from '../shared/shortcut-contract'
import { DEFAULT_MODEL_TUNING } from '../shared/model-tuning'
import { TOOL_INFO, defaultToolPermissions } from './tools/registry'
import { modelEndpoint } from './network/endpoint'
import { revokePolicy, assertRun, type RunContext } from './security/run-manager'
import { securityEvent } from './security/audit'
const whisperDirectory = app.isPackaged
  ? join(process.resourcesPath, 'whisper')
  : join(app.getAppPath(), 'resources', 'whisper')
export const ACCENTS: AccentName[] = ['violet', 'blue', 'teal', 'rose', 'amber']
const PERMISSIONS: ToolPermission[] = ['allow', 'ask', 'block']
const STYLES: ReplyStyle[] = ['terse', 'normal']
const LANGUAGES: VoiceLanguage[] = ['auto', 'en', 'de', 'fr']
const COMPUTES: VoiceCompute[] = ['auto', 'cpu', 'gpu']
const MODES: TalkMode[] = ['hold', 'toggle']
export const DEFAULT_SETTINGS: AppSettings = {
  policyVersion: 1,
  profile: { onboardingComplete: false, name: '', uses: [], guidance: 'balanced', context: '' },
  coding: { mode: 'ask-before-edit' },
  research: { enabled: false, provider: 'exa' },
  privacy: { chatRetentionDays: 0 },
  memory: { enabled: true, maxTokens: 600 },
  accent: 'violet',
  motion: 'full',
  showResponseDiagnostics: false,
  screenGlow: { enabled: true, color: '#a78bfa' },
  closeToTray: true,
  launchAtStartup: false,
  hotkeys: {
    summon: 'Control+Alt+Space',
    talk: 'Control+Alt+V'
  },
  model: {
    provider: 'local',
    endpoint: 'http://127.0.0.1:1234/v1',
    modelId: '',
    ...DEFAULT_MODEL_TUNING
  },
  behavior: {
    systemPrompt: '',
    style: 'terse',
    neverDo: ''
  },
  tools: defaultToolPermissions(),
  rules: {
    blockedApps: [
      'cmd',
      'powershell',
      'pwsh',
      'regedit',
      'terminal',
      'wt',
      'wscript',
      'cscript',
      'mshta',
      'rundll32'
    ],
    protectedWindows: []
  },
  files: { workspace: '' },
  voice: {
    enabled: false,
    deviceId: '',
    language: 'auto',
    compute: 'auto',
    mode: 'hold',
    serverPath: join(whisperDirectory, 'whisper-server.exe'),
    modelPath: join(whisperDirectory, 'ggml-base.bin')
  }
}
let current: AppSettings = structuredClone(DEFAULT_SETTINGS)
let recovery: { required: boolean; backup?: string } = { required: false }
let backupFailed = false
const recoveryFile = (): string => join(app.getPath('userData'), 'settings-review.json')
export const settingsRecovery = (): typeof recovery => ({ ...recovery })
export function acknowledgeSettingsRecovery(): void {
  if (backupFailed)
    throw new Error(
      'The original settings could not be preserved. Restore the file before continuing.'
    )
  if (existsSync(recoveryFile())) unlinkSync(recoveryFile())
  recovery = { required: false }
}
const listeners = new Set<(s: AppSettings) => void>()
const file = (): string => join(app.getPath('userData'), 'settings.json')
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function num(v: unknown, min: number, max: number, fallback: number, int = false): number {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return fallback
  const clamped = Math.min(max, Math.max(min, n))
  return int ? Math.round(clamped) : clamped
}
function str(v: unknown, maxLen: number, fallback: string): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : fallback
}
function strList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const s = item.trim().slice(0, 80)
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length >= 60) break
  }
  return out
}
function accelerator(v: unknown, fallback: string): string {
  try {
    if (typeof v !== 'string') return fallback
    validateShortcut(v)
    return v
  } catch {
    return fallback
  }
}
function endpoint(v: unknown, fallback: string, provider: ModelProvider): string {
  if (typeof v !== 'string') return fallback
  try {
    return modelEndpoint(v.trim(), provider)
  } catch {
    return fallback
  }
}
function sanitize(raw: unknown, base: AppSettings): AppSettings {
  const r = isObj(raw) ? raw : {}
  const profile = isObj(r.profile) ? r.profile : {}
  const coding = isObj(r.coding) ? r.coding : {}
  const hot = isObj(r.hotkeys) ? r.hotkeys : {}
  const model = isObj(r.model) ? r.model : {}
  const behavior = isObj(r.behavior) ? r.behavior : {}
  const tools = isObj(r.tools) ? r.tools : {}
  const rules = isObj(r.rules) ? r.rules : {}
  const voice = isObj(r.voice) ? r.voice : {}
  const files = isObj(r.files) ? r.files : {}
  const research = isObj(r.research) ? r.research : {}
  const privacy = isObj(r.privacy) ? r.privacy : {}
  const memory = isObj(r.memory) ? r.memory : {}
  const screenGlow = isObj(r.screenGlow) ? r.screenGlow : {}
  const out: AppSettings = {
    policyVersion: 1,
    profile: {
      onboardingComplete: bool(profile.onboardingComplete, base.profile.onboardingComplete),
      name: str(profile.name, 60, base.profile.name).trim(),
      uses: strList(profile.uses, base.profile.uses).filter((use) =>
        ['coding', 'learning', 'writing', 'research', 'everyday'].includes(use)
      ),
      guidance: oneOf(
        profile.guidance,
        ['balanced', 'step-by-step', 'direct'],
        base.profile.guidance
      ),
      context: str(profile.context, 1200, base.profile.context).trim()
    },
    coding: { mode: oneOf(coding.mode, ['auto', 'ask-before-edit'], base.coding.mode) },
    memory: {
      enabled: bool(memory.enabled, base.memory.enabled),
      maxTokens: num(memory.maxTokens, 100, 2000, base.memory.maxTokens, true)
    },
    research: {
      enabled: bool(research.enabled, base.research.enabled),
      provider: oneOf(
        research.provider,
        ['exa', 'duckduckgo', 'brave'],
        research.enabled === true && research.provider === undefined
          ? 'brave'
          : base.research.provider
      )
    },
    privacy: {
      chatRetentionDays: num(
        privacy.chatRetentionDays,
        0,
        3650,
        base.privacy.chatRetentionDays,
        true
      )
    },
    accent:
      typeof r.accent === 'string' && /^#[0-9a-f]{6}$/i.test(r.accent)
        ? (r.accent.toLowerCase() as AccentName)
        : oneOf(r.accent, ACCENTS, base.accent),
    motion: oneOf(r.motion, ['full', 'system', 'reduced'], base.motion),
    showResponseDiagnostics: bool(r.showResponseDiagnostics, base.showResponseDiagnostics),
    screenGlow: {
      enabled: bool(screenGlow.enabled, base.screenGlow.enabled),
      color:
        typeof screenGlow.color === 'string' && /^#[0-9a-f]{6}$/i.test(screenGlow.color)
          ? screenGlow.color.toLowerCase()
          : base.screenGlow.color
    },
    closeToTray: bool(r.closeToTray, base.closeToTray),
    launchAtStartup: bool(r.launchAtStartup, base.launchAtStartup),
    hotkeys: {
      summon: accelerator(hot.summon, base.hotkeys.summon),
      talk: accelerator(hot.talk, base.hotkeys.talk)
    },
    model: {
      provider: oneOf(
        model.provider,
        ['local', 'openai', 'compatible', 'chatgpt'],
        base.model.provider
      ),
      contextWindow: num(model.contextWindow, 2048, 131072, base.model.contextWindow, true),
      endpoint: endpoint(
        model.endpoint,
        base.model.endpoint,
        oneOf(model.provider, ['local', 'openai', 'compatible', 'chatgpt'], base.model.provider)
      ),
      modelId: str(model.modelId, 200, base.model.modelId).trim(),
      temperature: num(model.temperature, 0, 2, base.model.temperature),
      maxTokens: num(model.maxTokens, 64, 32768, base.model.maxTokens, true),
      historyTurns: num(model.historyTurns, 0, 20, base.model.historyTurns, true),
      maxSteps: num(model.maxSteps, 1, 40, base.model.maxSteps, true),
      thinking: bool(model.thinking, base.model.thinking),
      reasoningEffort: oneOf(
        model.reasoningEffort,
        ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        base.model.reasoningEffort
      ),
      specialists: bool(model.specialists, base.model.specialists),
      codingResources: oneOf(
        model.codingResources,
        ['auto', 'conserve', 'expand'],
        base.model.codingResources
      )
    },
    behavior: {
      systemPrompt: str(behavior.systemPrompt, 8000, base.behavior.systemPrompt),
      style: oneOf(behavior.style, STYLES, base.behavior.style),
      neverDo: str(behavior.neverDo, 2000, base.behavior.neverDo)
    },
    tools: Object.fromEntries(
      TOOL_INFO.map((t) => {
        const permission = oneOf(
          tools[t.name],
          PERMISSIONS,
          t.name === 'run_command' ? 'ask' : 'block'
        )
        return [
          t.name,
          ['run_npm', 'run_command', 'delete_file', 'delete_directory', 'notes_delete'].includes(
            t.name
          ) && permission === 'allow'
            ? 'ask'
            : permission
        ]
      })
    ),
    rules: {
      blockedApps: strList(rules.blockedApps, base.rules.blockedApps),
      protectedWindows: strList(rules.protectedWindows, base.rules.protectedWindows)
    },
    files: { workspace: str(files.workspace, 1000, base.files.workspace).trim() },
    voice: {
      enabled: bool(voice.enabled, base.voice.enabled),
      deviceId: str(voice.deviceId, 500, base.voice.deviceId),
      language: oneOf(voice.language, LANGUAGES, base.voice.language),
      compute: oneOf(voice.compute, COMPUTES, base.voice.compute),
      mode: oneOf(voice.mode, MODES, base.voice.mode),

      serverPath: DEFAULT_SETTINGS.voice.serverPath,
      modelPath: DEFAULT_SETTINGS.voice.modelPath
    }
  }
  if (out.hotkeys.summon.toLowerCase() === out.hotkeys.talk.toLowerCase()) {
    out.hotkeys = { ...DEFAULT_SETTINGS.hotkeys }
  }
  return out
}
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base
  if (!isObj(base) || !isObj(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue
    out[key] = merge(base[key], patch[key])
  }
  return out
}
export function loadSettings(): AppSettings {
  recovery = { required: existsSync(recoveryFile()) }
  if (recovery.required) {
    try {
      const marker = JSON.parse(readFileSync(recoveryFile(), 'utf8'))
      if (
        typeof marker.backup === 'string' &&
        /^settings\.json\.corrupt-[\w-]+$/.test(marker.backup)
      )
        recovery.backup = marker.backup
    } catch {
      /* A malformed marker still requires native review. */
    }
  }
  backupFailed = false
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'))

    if (isObj(raw) && raw.profile === undefined) raw.profile = { onboardingComplete: true }
    if (!isObj(raw) || (raw.policyVersion !== undefined && raw.policyVersion !== 1))
      throw new Error('Unsupported security policy')
    if (!isObj(raw) || raw.policyVersion !== 1) {
      current = sanitize(merge(DEFAULT_SETTINGS, raw), DEFAULT_SETTINGS)
      current.tools = defaultToolPermissions()
      current.research.enabled = false
    } else {
      current = sanitize(raw, DEFAULT_SETTINGS)
      const savedRules = raw.rules
      const savedTools = raw.tools
      if (
        !isObj(raw.tools) ||
        !isObj(raw.research) ||
        typeof raw.research.enabled !== 'boolean' ||
        (raw.research.provider !== undefined &&
          !['exa', 'duckduckgo', 'brave'].includes(String(raw.research.provider))) ||
        !isObj(savedRules) ||
        !['blockedApps', 'protectedWindows'].every((name) => {
          const values = savedRules[name]
          return (
            Array.isArray(values) &&
            values.length <= 60 &&
            values.every(
              (value: unknown) =>
                typeof value === 'string' && value.trim().length > 0 && value.length <= 80
            )
          )
        }) ||
        !isObj(raw.files) ||
        typeof raw.files.workspace !== 'string' ||
        raw.files.workspace.length > 1000 ||
        !isObj(savedTools) ||
        Object.keys(savedTools).some(
          (name) =>
            !TOOL_INFO.some((tool) => tool.name === name) ||
            !PERMISSIONS.includes(savedTools[name] as ToolPermission)
        )
      )
        throw new Error('Invalid security policy')
    }
  } catch (error) {
    current = structuredClone(DEFAULT_SETTINGS)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      recovery = { required: true, backup: `settings.json.corrupt-${Date.now()}-${randomUUID()}` }
      try {
        copyFileSync(
          file(),
          join(app.getPath('userData'), recovery.backup!),
          constants.COPYFILE_EXCL
        )
        writeFileSync(recoveryFile(), JSON.stringify(recovery), 'utf8')
      } catch {
        backupFailed = true
      }
    }
  }
  if (recovery.required) {
    current.tools = Object.fromEntries(TOOL_INFO.map((tool) => [tool.name, 'block']))
    current.research.enabled = false
    current.files.workspace = ''
  }
  if (!current.voice.serverPath) current.voice.serverPath = DEFAULT_SETTINGS.voice.serverPath
  if (!current.voice.modelPath) current.voice.modelPath = DEFAULT_SETTINGS.voice.modelPath
  return current
}
export const getSettings = (): AppSettings => structuredClone(current)
export function onSettingsChange(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function commit(next: AppSettings, approvedGrant = false): AppSettings {
  if (backupFailed)
    throw new Error('Settings recovery backup failed; the original file has not been replaced.')
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file() + '.tmp', JSON.stringify(next, null, 2), 'utf8')
    renameSync(file() + '.tmp', file())
  } catch (e) {
    throw new Error(`Could not save settings: ${(e as Error).message}`, { cause: e })
  }
  const security = (s: AppSettings): string =>
    JSON.stringify([
      s.tools,
      s.rules,
      s.files.workspace,
      s.model.provider,
      s.model.endpoint,
      s.research.enabled,
      s.research.provider,
      s.memory.enabled,
      s.coding.mode
    ])
  if (security(current) !== security(next)) {
    if (!approvedGrant) revokePolicy()
    securityEvent('policy_changed')
  }
  current = next
  listeners.forEach((fn) => fn(getSettings()))
  return getSettings()
}
export function updateSettings(patch: SettingsPatch): AppSettings {
  return commit(draftSettings(patch))
}

export function allowApprovedTool(name: string, run: RunContext): void {
  assertRun(run)
  if (
    recovery.required ||
    ['run_npm', 'run_command', 'delete_file', 'delete_directory'].includes(name) ||
    current.tools[name] !== 'ask'
  )
    throw new Error('This tool cannot be granted permanent approval here.')
  commit(draftSettings({ tools: { [name]: 'allow' } }), true)
}
export function draftSettings(patch: SettingsPatch): AppSettings {
  if (
    patch.model?.provider !== undefined &&
    !['local', 'openai', 'compatible', 'chatgpt'].includes(patch.model.provider)
  )
    throw new Error('Unknown model provider.')
  modelEndpoint(
    patch.model?.endpoint ?? current.model.endpoint,
    patch.model?.provider ?? current.model.provider
  )
  if (patch.hotkeys?.summon !== undefined) validateShortcut(patch.hotkeys.summon)
  if (patch.hotkeys?.talk !== undefined) validateShortcut(patch.hotkeys.talk)
  if (
    (patch.hotkeys?.summon ?? current.hotkeys.summon).toLowerCase() ===
    (patch.hotkeys?.talk ?? current.hotkeys.talk).toLowerCase()
  )
    throw new Error('Choose different shortcuts.')
  return sanitize(merge(current, patch), current)
}
