import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Notice,
  NumberField,
  PillButton,
  Row,
  Section,
  SelectField,
  Slider,
  TextField,
  Toggle
} from './controls'
import { save } from './save'
import { ModelKeyField } from './ModelKeyField'
import { ChatgptConnection } from './ChatgptConnection'
import { ReasoningEffort } from '../ReasoningEffort'
import { documentedCapabilities } from '../../../../shared/model-capabilities'
function validateEndpoint(v: string, provider: ModelProvider): string | null {
  try {
    const u = new URL(v.trim())
    if (provider !== 'local')
      return u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (!['openai', 'chatgpt'].includes(provider) ||
          u.toString().replace(/\/$/, '') === 'https://api.openai.com/v1')
        ? null
        : 'Use an HTTPS API base address. OpenAI uses https://api.openai.com/v1.'
    return ['http:', 'https:'].includes(u.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
      u.pathname === '/v1' &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
      ? null
      : 'Use a loopback server ending in /v1. Remote inference is disabled.'
  } catch {
    return 'Enter a full address, like http://localhost:1234/v1'
  }
}
function isLocal(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)
  } catch {
    return true
  }
}
export function ModelTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const m = settings.model
  const provider = m.provider ?? 'local'
  const category = provider === 'chatgpt' ? 'openai' : provider
  const chooseProvider = (next: ModelProvider): void => {
    if (next === provider) return
    void save({
      model: {
        provider: next,
        endpoint:
          next === 'openai' || next === 'chatgpt'
            ? 'https://api.openai.com/v1'
            : next === 'local'
              ? 'http://127.0.0.1:1234/v1'
              : 'https://api.example.com/v1',
        modelId: '',
        ...(next === 'openai' || next === 'chatgpt'
          ? { maxTokens: Math.max(m.maxTokens, 4096) }
          : {})
      }
    })
  }
  const [credentialRevision, setCredentialRevision] = useState(0)
  const source = JSON.stringify([m.endpoint, provider, credentialRevision])
  const [modelResult, setModelResult] = useState<{ source: string; models: ModelChoice[] } | null>(
    null
  )
  const models = modelResult?.source === source ? modelResult.models : null
  const [reload, setReload] = useState(0)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [keyError, setKeyError] = useState('')
  useEffect(() => {
    let alive = true
    void window.api.research
      .hasKey()
      .then((value) => {
        if (alive) setHasKey(value)
      })
      .catch((error: Error) => {
        if (alive) setKeyError(error.message)
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    window.api
      .llmModelChoices()
      .then((list) => {
        if (alive) setModelResult({ source, models: list })
      })
      .catch(() => {
        if (alive) setModelResult({ source, models: [] })
      })
    return () => {
      alive = false
    }
  }, [reload, source])
  const ids = (models ?? []).map((model) => model.id)
  const options = [
    {
      value: '',
      label:
        provider === 'local'
          ? 'Automatic (first loaded model)'
          : 'Choose a model or enter its ID below'
    },
    ...(m.modelId && !ids.includes(m.modelId) ? [{ value: m.modelId, label: m.modelId }] : []),
    ...(models ?? []).map(({ id, label }) => ({ value: id, label }))
  ]
  return (
    <Tabs defaultValue="connection" className="gap-4">
      <TabsList
        aria-label="Model sections"
        className="flex h-auto max-w-full flex-wrap justify-start gap-1"
      >
        <TabsTrigger value="connection" className="px-3 py-2 text-xs">
          Connection
        </TabsTrigger>
        <TabsTrigger value="web" className="px-3 py-2 text-xs">
          Web access
        </TabsTrigger>
        <TabsTrigger value="generation" className="px-3 py-2 text-xs">
          Generation
        </TabsTrigger>
      </TabsList>
      <TabsContent value="connection" className="space-y-4">
        <Section
          title="Connection"
          description="Use a local model, your ChatGPT subscription, or a hosted API provider."
        >
          <Row label="Provider">
            <SelectField
              value={category}
              options={[
                { value: 'local', label: 'Local LLM' },
                { value: 'openai', label: 'OpenAI' },
                { value: 'compatible', label: 'Other API provider' }
              ]}
              onChange={(value) => {
                if (value !== category)
                  chooseProvider(value === 'openai' ? 'chatgpt' : (value as ModelProvider))
              }}
            />
          </Row>
          {category === 'openai' && (
            <Row label="Connect with">
              <SelectField
                value={provider}
                options={[
                  { value: 'chatgpt', label: 'ChatGPT subscription (Plus / Pro)' },
                  { value: 'openai', label: 'API key' }
                ]}
                onChange={(value) => chooseProvider(value as ModelProvider)}
              />
            </Row>
          )}
          {category !== 'openai' && (
            <Row
              label="Server address"
              hint={
                provider === 'local'
                  ? 'LM Studio or another local server with an OpenAI-compatible API.'
                  : 'The HTTPS base address supplied by your API provider.'
              }
              stack
            >
              <TextField
                value={m.endpoint}
                onCommit={(endpoint) => void save({ model: { endpoint } })}
                validate={(value) => validateEndpoint(value, provider)}
                mono
                width="w-full"
              />
            </Row>
          )}
          {provider !== 'local' && !isLocal(m.endpoint) && (
            <div className="pb-3">
              <Notice tone="warn">
                Conversation context, selected memories, attachments, screenshots and tool results
                included in a request are sent to this provider.{' '}
                {provider === 'chatgpt'
                  ? 'Usage counts toward your ChatGPT plan or credits.'
                  : 'API usage may incur charges.'}
              </Notice>
            </div>
          )}
          {provider === 'chatgpt' && (
            <ChatgptConnection onChanged={() => setCredentialRevision((n) => n + 1)} />
          )}
          {(provider === 'openai' || provider === 'compatible') && (
            <ModelKeyField
              key={provider + ':' + m.endpoint}
              provider={provider}
              endpoint={m.endpoint}
              onSaved={() => setCredentialRevision((n) => n + 1)}
            />
          )}
          <Row
            label="Model"
            hint={
              models === null
                ? 'Looking for models…'
                : models.length === 0
                  ? "Couldn't reach the server, or no model is available."
                  : `${models.length} found.`
            }
          >
            <div className="flex items-center gap-2">
              <SelectField
                value={m.modelId}
                options={options}
                onChange={(modelId) => void save({ model: { modelId } })}
                width="w-64"
              />
              <PillButton
                disabled={models === null}
                onClick={() => {
                  setModelResult(null)
                  setReload((n) => n + 1)
                }}
              >
                {models === null ? 'Refreshing…' : 'Refresh'}
              </PillButton>
            </div>
          </Row>
          {provider !== 'local' && (
            <Row
              label="Model ID"
              hint="Enter the exact model ID from your provider. Model listing may be unavailable."
              stack
            >
              <TextField
                value={m.modelId}
                onCommit={(modelId) => void save({ model: { modelId } })}
                mono
                width="w-full"
              />
            </Row>
          )}
        </Section>
      </TabsContent>
      <TabsContent value="web" className="space-y-4">
        <Section
          title="Web access"
          description="Search and read public websites independently of Chrome, Edge, Firefox or Brave. Queries go to your search provider; page URLs go to websites. These can disclose conversation details. Pages are read without logins, cookies or scripts."
        >
          <Row
            label="Search provider"
            hint="Exa's hosted search needs no key and has free-tier limits. DuckDuckGo is best effort and may block automation. Brave API requires a key. Queries go only to the selected provider."
          >
            <SelectField
              value={settings.research.provider}
              options={[
                { value: 'exa', label: 'Exa (no key)' },
                { value: 'duckduckgo', label: 'DuckDuckGo (best effort)' },
                { value: 'brave', label: 'Brave Search API' }
              ]}
              onChange={(provider) =>
                void save({
                  research: { provider: provider as AppSettings['research']['provider'] }
                })
              }
            />
          </Row>
          {settings.research.provider === 'brave' && (
            <>
              <Row
                label="Brave Search API key"
                hint={
                  hasKey
                    ? 'Stored with Windows credential encryption.'
                    : 'Add your own provider key to use search.'
                }
                stack
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    aria-label="Brave Search API key"
                    autoComplete="off"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="Enter your API key"
                    className="h-9 w-64 max-w-full text-xs"
                  />
                  <PillButton
                    disabled={!key.trim()}
                    onClick={() => {
                      void window.api.research
                        .setKey(key)
                        .then(() => {
                          setKey('')
                          setHasKey(true)
                          setKeyError('')
                        })
                        .catch((error) => setKeyError(error.message))
                    }}
                  >
                    Save key
                  </PillButton>
                  <PillButton
                    disabled={!hasKey}
                    onClick={() => {
                      void window.api.research
                        .setKey('')
                        .then(() => {
                          setHasKey(false)
                          setKey('')
                          setKeyError('')
                        })
                        .catch((error) => setKeyError(error.message))
                    }}
                  >
                    Delete key
                  </PillButton>
                </div>
                {keyError && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {keyError}
                  </p>
                )}
              </Row>
            </>
          )}
          <Row
            label="Enable web access"
            hint="At most three searches and six page reads per task. Allow each tool in Permissions. Page reads follow up to three public HTTPS redirects."
          >
            <Toggle
              checked={settings.research.enabled}
              onChange={(enabled) => void save({ research: { enabled } })}
            />
          </Row>
        </Section>
      </TabsContent>
      <TabsContent value="generation" className="space-y-4">
        <Section title="Generation">
          <Row
            label="Coding operations"
            hint="Automatically size code reads and edits to available capacity. The agent can request adjustments during a task. This preference never increases your model limits or changes permissions."
          >
            <SelectField
              value={m.codingResources ?? 'auto'}
              options={[
                { value: 'auto', label: 'Automatic' },
                { value: 'conserve', label: 'Prefer smaller operations' },
                { value: 'expand', label: 'Prefer larger operations' }
              ]}
              onChange={(codingResources) =>
                void save({
                  model: {
                    codingResources: codingResources as AppSettings['model']['codingResources']
                  }
                })
              }
            />
          </Row>
          {(provider === 'openai' || provider === 'chatgpt') && (
            <Row
              label="Reasoning effort"
              hint="Shows levels supported by the selected model. Auto uses its default. Higher effort allows more reasoning and can use more tokens and time."
            >
              <ReasoningEffort
                value={m.reasoningEffort}
                model={
                  models?.find((model) => model.id === m.modelId) ?? {
                    id: m.modelId,
                    label: m.modelId,
                    ...documentedCapabilities(m.modelId, provider)
                  }
                }
              />
            </Row>
          )}
          <Row
            label="Specialist agents"
            hint="Let the assistant consult Researcher, Visual Explainer, Tutor and Reviewer when useful. They share your selected model, run sequentially and count toward Steps per request and API usage."
          >
            <Toggle
              checked={m.specialists}
              onChange={(specialists) => void save({ model: { specialists } })}
            />
          </Row>
          {provider !== 'chatgpt' && (
            <Row
              label="Context window"
              hint="Match the context size configured in your model server. Sophon reserves reply space and a 20% estimation margin, and automatically summarizes older context as it fills."
            >
              <NumberField
                value={m.contextWindow}
                min={2048}
                max={131072}
                suffix="tokens"
                onCommit={(contextWindow) => void save({ model: { contextWindow } })}
              />
            </Row>
          )}
          {provider !== 'openai' && provider !== 'chatgpt' && (
            <Row
              label="Temperature"
              hint="Controls sampling variation. Lower values produce more consistent responses; higher values add variety. Choose a value suited to your model and task."
            >
              <Slider
                value={m.temperature}
                min={0}
                max={2}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onCommit={(temperature) => void save({ model: { temperature } })}
              />
            </Row>
          )}
          {provider !== 'chatgpt' && (
            <Row
              label="Longest reply"
              hint="Requested output limit, including internal reasoning for reasoning models. Capped at one third of the context window. Visual replies use provider-controlled length. Increase it if text answers are cut off."
            >
              <NumberField
                value={m.maxTokens}
                min={64}
                max={32768}
                suffix="tokens"
                onCommit={(maxTokens) => void save({ model: { maxTokens } })}
              />
            </Row>
          )}
          <Row
            label="Recent exchanges"
            hint="Recent exchanges retained alongside a rolling summary of older context. The context budget can include fewer. Set to 0 to exclude past exchanges and their summary. Your full chat stays available; durable memories are managed separately in Memory."
          >
            <Slider
              value={m.historyTurns}
              min={0}
              max={20}
              step={1}
              format={(v) => `${v}`}
              onCommit={(historyTurns) => void save({ model: { historyTurns } })}
            />
          </Row>
          <Row
            label="Steps per request"
            hint="The most model calls one request may use. Chained requests like 'open it and snap it' need a few."
          >
            <Slider
              value={m.maxSteps}
              min={1}
              max={40}
              step={1}
              format={(v) => `${v}`}
              onCommit={(maxSteps) => void save({ model: { maxSteps } })}
            />
          </Row>
          {provider === 'local' && (
            <Row
              label="Let the model think first"
              hint="Slower, and long thinking can use up the reply length above. Leave off for quick commands."
            >
              <Toggle
                checked={m.thinking}
                onChange={(thinking) => void save({ model: { thinking } })}
              />
            </Row>
          )}
        </Section>
      </TabsContent>
    </Tabs>
  )
}
