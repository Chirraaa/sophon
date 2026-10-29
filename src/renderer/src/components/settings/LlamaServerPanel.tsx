import { llamaOptionIssues, LLAMA_LIMITS } from '../../../../shared/llama-server'
import type { LlamaState } from '@/hooks/useLlama'
import { Notice, NumberField, PillButton, Row, Section, SelectField, Toggle } from './controls'

function Issue({ children }: { children?: string }): React.JSX.Element | null {
  return children ? (
    <p role="alert" className="mt-1 max-w-xs text-xs text-destructive">
      {children}
    </p>
  ) : null
}

function PathLine({ path, empty }: { path: string; empty: string }): React.JSX.Element {
  return (
    <span
      title={path || undefined}
      className="selectable min-w-0 flex-1 break-all font-mono text-[11px] text-muted-foreground"
    >
      {path || empty}
    </span>
  )
}

const GPU_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'all', label: 'Everything on the GPU' },
  { value: 'custom', label: 'Choose layers' },
  { value: 'cpu', label: 'CPU only' }
]
const FLASH_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]
const CACHE_OPTIONS = [
  { value: 'f16', label: 'Full precision (f16)' },
  { value: 'q8_0', label: 'Compressed (q8_0)' },
  { value: 'q4_0', label: 'Smallest (q4_0)' }
]

export function LlamaServerPanel({ llama }: { llama: LlamaState }): React.JSX.Element | null {
  const { view, error, busy, run } = llama
  if (!view) return error ? <Notice tone="warn">{error}</Notice> : null
  const { config, status } = view
  const o = config.options
  const caps = config.caps
  const issues = llamaOptionIssues(o, caps)
  const hasIssues = Object.keys(issues).length > 0
  const ready = Boolean(config.executable && config.modelPath)
  const live = status.state === 'starting' || status.state === 'running'
  const stale =
    status.state === 'running' && view.applied && JSON.stringify(view.applied) !== JSON.stringify(o)
  const patch = (change: Partial<LlamaOptions>): void =>
    void run(() => window.api.llama.setOptions(change))
  const L = LLAMA_LIMITS

  return (
    <Section
      title="llama.cpp"
      description="Sophon starts your llama-server for you, listening only on this computer, and stops it when you stop the model or quit. Choose the program and a GGUF model, then set how it loads."
    >
      <Row label="Program" hint="Your llama-server.exe. Sophon asks before running it." stack>
        <div className="flex items-center gap-3">
          <PathLine path={config.executable} empty="No program chosen" />
          <PillButton
            disabled={busy || live}
            onClick={() => void run(window.api.llama.pickExecutable)}
          >
            {config.executable ? 'Change' : 'Choose program'}
          </PillButton>
        </div>
      </Row>
      <Row label="Model" hint="A .gguf file. Larger models need more memory." stack>
        <div className="flex items-center gap-3">
          <PathLine path={config.modelPath} empty="No model chosen" />
          <PillButton disabled={busy || live} onClick={() => void run(window.api.llama.pickModel)}>
            {config.modelPath ? 'Change' : 'Choose model'}
          </PillButton>
        </div>
      </Row>
      <Row
        label="Context size"
        hint="How much text the model can hold at once. Memory use grows with it. Sophon matches its own context setting to this."
      >
        <NumberField
          value={o.contextSize}
          min={L.contextSize.min}
          max={L.contextSize.max}
          suffix="tokens"
          onCommit={(contextSize) => patch({ contextSize })}
        />
      </Row>
      {(!caps || caps.gpuLayers) && (
        <Row
          label="GPU"
          hint="How much of the model runs on the graphics card. Automatic lets llama.cpp decide."
        >
          <div className="flex items-center gap-2">
            <SelectField
              value={o.gpuMode}
              options={GPU_OPTIONS}
              onChange={(gpuMode) => patch({ gpuMode: gpuMode as LlamaOptions['gpuMode'] })}
              width="w-48"
            />
            {o.gpuMode === 'custom' && (
              <NumberField
                value={o.gpuLayers}
                min={L.gpuLayers.min}
                max={L.gpuLayers.max}
                suffix="layers"
                onCommit={(gpuLayers) => patch({ gpuLayers })}
              />
            )}
          </div>
        </Row>
      )}
      <Row
        label="Memory-map the model"
        hint="Loads the model file directly from disk instead of copying it into memory. Starts faster and shares memory; turn it off if loading is unstable."
      >
        <Toggle checked={o.mmap} onChange={(mmap) => patch({ mmap })} />
      </Row>
      {(!caps || caps.mlock || caps.loadMode) && (
        <Row
          label="Keep the model in memory"
          hint="Stops Windows from paging the model out. Needs enough free memory."
        >
          <div>
            <Toggle checked={o.mlock} onChange={(mlock) => patch({ mlock })} />
            <Issue>{issues.mlock}</Issue>
          </div>
        </Row>
      )}
      {(!caps || caps.flashAttnValue || caps.flashAttnFlag) && (
        <Row
          label="Flash attention"
          hint="Faster, and uses less memory for long contexts, on cards that support it."
        >
          <div>
            <SelectField
              value={o.flashAttention}
              options={FLASH_OPTIONS}
              onChange={(flashAttention) =>
                patch({ flashAttention: flashAttention as LlamaOptions['flashAttention'] })
              }
              width="w-40"
            />
            <Issue>{issues.flashAttention}</Issue>
          </div>
        </Row>
      )}
      {(!caps || caps.cacheType) && (
        <Row
          label="Context memory"
          hint="Compressing the context's memory lets a longer context fit, with a small loss in quality."
        >
          <div>
            <SelectField
              value={o.cacheType}
              options={CACHE_OPTIONS}
              onChange={(cacheType) => patch({ cacheType: cacheType as LlamaOptions['cacheType'] })}
              width="w-52"
            />
            <Issue>{issues.cacheType}</Issue>
          </div>
        </Row>
      )}
      <Row
        label="Let the model think first"
        hint={
          caps && !caps.reasoningBudget
            ? 'This llama-server cannot limit thinking. The model decides on its own.'
            : 'Slower, and thinking uses up part of the reply. Leave off for quick commands.'
        }
      >
        <Toggle checked={o.thinking} onChange={(thinking) => patch({ thinking })} />
      </Row>
      {o.thinking && (!caps || caps.reasoningBudget) && (
        <Row
          label="Limit thinking"
          hint="Stops the model from thinking longer than this many tokens before it answers."
        >
          <div className="flex items-center gap-2">
            <Toggle
              checked={o.limitThinking}
              onChange={(limitThinking) => patch({ limitThinking })}
            />
            {o.limitThinking && (
              <NumberField
                value={o.thinkingBudget}
                min={L.thinkingBudget.min}
                max={L.thinkingBudget.max}
                suffix="tokens"
                onCommit={(thinkingBudget) => patch({ thinkingBudget })}
              />
            )}
          </div>
        </Row>
      )}
      <Row
        label="Port"
        hint="The local port the model listens on. Change it if another program already uses it."
      >
        <NumberField
          value={o.port}
          min={L.port.min}
          max={L.port.max}
          onCommit={(port) => patch({ port })}
        />
      </Row>
      <Row label="Start with Sophon" hint="Load the model automatically when Sophon opens.">
        <Toggle checked={o.autoStart} onChange={(autoStart) => patch({ autoStart })} />
      </Row>
      <Row
        label="Status"
        hint={
          !ready
            ? 'Choose the program and a model to start.'
            : hasIssues
              ? 'Fix the highlighted option to start.'
              : undefined
        }
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {status.state === 'running'
              ? `Running on port ${status.port}`
              : status.state === 'starting'
                ? 'Loading the model…'
                : status.state === 'error'
                  ? 'Stopped with an error'
                  : 'Stopped'}
          </span>
          {live ? (
            <PillButton disabled={busy} onClick={() => void run(window.api.llama.stop)}>
              Stop
            </PillButton>
          ) : (
            <PillButton
              disabled={busy || !ready || hasIssues}
              onClick={() => void run(window.api.llama.start)}
            >
              Start
            </PillButton>
          )}
        </div>
      </Row>
      {stale && (
        <div className="pb-3">
          <Notice>
            Some changes apply the next time the model starts.{' '}
            <button
              type="button"
              className="underline underline-offset-2"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await window.api.llama.stop()
                  return window.api.llama.start()
                })
              }
            >
              Restart now
            </button>
          </Notice>
        </div>
      )}
      {(error || status.error) && (
        <div className="space-y-2 pb-3">
          <Notice tone="warn">{error || status.error}</Notice>
          {status.state === 'error' && status.log && (
            <pre className="selectable max-h-40 overflow-auto rounded-xl border border-border bg-background/40 p-3 text-[11px] whitespace-pre-wrap text-muted-foreground">
              {status.log}
            </pre>
          )}
        </div>
      )}
    </Section>
  )
}
