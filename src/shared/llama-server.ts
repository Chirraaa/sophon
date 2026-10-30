// Options Sophon passes to a llama.cpp server it starts itself. Pure logic, shared by the main
// process (building the command line) and the settings screen (inline validation).

export type GpuMode = 'auto' | 'all' | 'cpu' | 'custom'
export type FlashAttention = 'auto' | 'on' | 'off'
export type CacheType = 'f16' | 'q8_0' | 'q4_0'

export interface LlamaOptions {
  contextSize: number
  gpuMode: GpuMode
  gpuLayers: number
  mmap: boolean
  mlock: boolean
  flashAttention: FlashAttention
  cacheType: CacheType
  thinking: boolean
  limitThinking: boolean
  thinkingBudget: number
  port: number
  autoStart: boolean
}

export const DEFAULT_LLAMA_OPTIONS: LlamaOptions = {
  contextSize: 16384,
  gpuMode: 'auto',
  gpuLayers: 99,
  mmap: true,
  mlock: false,
  flashAttention: 'auto',
  cacheType: 'f16',
  thinking: false,
  limitThinking: false,
  thinkingBudget: 2048,
  port: 8089,
  autoStart: false
}

export const LLAMA_LIMITS = {
  contextSize: { min: 2048, max: 131072 },
  gpuLayers: { min: 0, max: 999 },
  thinkingBudget: { min: 64, max: 32768 },
  port: { min: 1024, max: 65535 }
} as const

// What a particular llama-server build understands, read from its `--help` text. Builds differ:
// recent ones replaced --no-mmap/--mlock with --load-mode, and older ones take a bare --flash-attn.
export interface LlamaCapabilities {
  loadMode: boolean
  noMmap: boolean
  mlock: boolean
  flashAttnValue: boolean
  flashAttnFlag: boolean
  cacheType: boolean
  reasoningBudget: boolean
  gpuLayers: boolean
  jinja: boolean
  noWebui: boolean
}

export function parseLlamaCapabilities(help: string): LlamaCapabilities {
  const flashValue = /--flash-attn\s+\[on\|off\|auto\]/.test(help)
  return {
    loadMode: /--load-mode\b/.test(help),
    noMmap: /--no-mmap\b/.test(help),
    mlock: /--mlock\b/.test(help),
    flashAttnValue: flashValue,
    flashAttnFlag: !flashValue && /--flash-attn\b/.test(help),
    cacheType: /--cache-type-k\b/.test(help),
    reasoningBudget: /--reasoning-budget\b/.test(help),
    gpuLayers: /--n-gpu-layers\b|--gpu-layers\b/.test(help),
    jinja: /--jinja\b/.test(help),
    noWebui: /--no-webui\b/.test(help)
  }
}

export const looksLikeLlamaHelp = (help: string): boolean =>
  /--ctx-size\b/.test(help) && /--model\b/.test(help) && /--port\b/.test(help)

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const int = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback

export function sanitizeLlamaOptions(raw: unknown, base: LlamaOptions): LlamaOptions {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
  const o = r as Record<string, unknown>
  const L = LLAMA_LIMITS
  return {
    contextSize: int(o.contextSize, L.contextSize.min, L.contextSize.max, base.contextSize),
    gpuMode: oneOf(o.gpuMode, ['auto', 'all', 'cpu', 'custom'], base.gpuMode),
    gpuLayers: int(o.gpuLayers, L.gpuLayers.min, L.gpuLayers.max, base.gpuLayers),
    mmap: bool(o.mmap, base.mmap),
    mlock: bool(o.mlock, base.mlock),
    flashAttention: oneOf(o.flashAttention, ['auto', 'on', 'off'], base.flashAttention),
    cacheType: oneOf(o.cacheType, ['f16', 'q8_0', 'q4_0'], base.cacheType),
    thinking: bool(o.thinking, base.thinking),
    limitThinking: bool(o.limitThinking, base.limitThinking),
    thinkingBudget: int(
      o.thinkingBudget,
      L.thinkingBudget.min,
      L.thinkingBudget.max,
      base.thinkingBudget
    ),
    port: int(o.port, L.port.min, L.port.max, base.port),
    autoStart: bool(o.autoStart, base.autoStart)
  }
}

// Messages for values that sanitizing would silently clamp or that conflict with each other.
// The settings screen shows these inline; the main process refuses to start while any remain.
export function llamaOptionIssues(
  o: LlamaOptions,
  caps: LlamaCapabilities | null
): Partial<Record<keyof LlamaOptions, string>> {
  const issues: Partial<Record<keyof LlamaOptions, string>> = {}
  if (o.cacheType !== 'f16' && o.flashAttention === 'off')
    issues.cacheType =
      'A compressed KV cache needs flash attention. Turn flash attention on or auto.'
  if (caps && o.cacheType !== 'f16' && !caps.cacheType)
    issues.cacheType = 'This llama-server build cannot compress the KV cache.'
  if (caps && o.flashAttention !== 'auto' && !caps.flashAttnValue && !caps.flashAttnFlag)
    issues.flashAttention = 'This llama-server build has no flash attention option.'
  if (caps && o.mlock && !caps.mlock && !caps.loadMode)
    issues.mlock = 'This llama-server build cannot lock the model in memory.'
  return issues
}

// The command line for the chosen program. Always loopback-only, one slot (so the whole context
// belongs to the single conversation), and only flags the program says it supports.
export function buildLlamaArgs(
  o: LlamaOptions,
  caps: LlamaCapabilities,
  modelPath: string,
  projectorPath?: string
): string[] {
  const args = [
    '--model',
    modelPath,
    ...(projectorPath ? ['--mmproj', projectorPath] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(o.port),
    '--ctx-size',
    String(o.contextSize),
    '--parallel',
    '1'
  ]
  if (caps.jinja) args.push('--jinja')
  if (caps.noWebui) args.push('--no-webui')

  if (caps.gpuLayers && o.gpuMode !== 'auto')
    args.push(
      '--n-gpu-layers',
      String(o.gpuMode === 'all' ? 999 : o.gpuMode === 'cpu' ? 0 : o.gpuLayers)
    )

  if (caps.loadMode) {
    if (o.mmap && o.mlock) args.push('--load-mode', 'mmap+mlock')
    else if (o.mlock) args.push('--load-mode', 'mlock')
    else if (!o.mmap) args.push('--load-mode', 'none')
  } else {
    if (!o.mmap && caps.noMmap) args.push('--no-mmap')
    if (o.mlock && caps.mlock) args.push('--mlock')
  }

  const compressed = o.cacheType !== 'f16' && caps.cacheType
  if (caps.flashAttnValue) {
    if (o.flashAttention !== 'auto') args.push('--flash-attn', o.flashAttention)
  } else if (caps.flashAttnFlag && (o.flashAttention === 'on' || compressed)) {
    // Older builds default to off and only accept a compressed V cache with flash attention.
    args.push('--flash-attn')
  }
  if (compressed) args.push('--cache-type-k', o.cacheType, '--cache-type-v', o.cacheType)

  if (caps.reasoningBudget) {
    if (!o.thinking) args.push('--reasoning-budget', '0')
    else if (o.limitThinking) args.push('--reasoning-budget', String(o.thinkingBudget))
  }
  return args
}
