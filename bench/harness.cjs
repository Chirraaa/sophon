const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { load, root } = require('../scripts/security/load.cjs')

const MODEL = {
  provider: 'local',
  endpoint: 'http://127.0.0.1:1234/v1',
  modelId: 'qwen3.5-4b@q4_0',
  contextWindow: 60000,
  temperature: 0.2,
  maxTokens: 1024,
  visualMaxTokens: 8192,
  thinking: false,
  reasoningEffort: 'auto',
  historyTurns: 4,
  maxSteps: 6
}
const scratch = path.join(root, '.cache/bench/scratch')

const positionSource = fs.readFileSync(path.join(root, 'src/main/tools/window-move.ts'), 'utf8')
const positionLiteral = positionSource.match(/export const POSITIONS = (\[[\s\S]*?\]) as const/)
assert(positionLiteral, 'Window position declaration changed; review the loader')
const POSITIONS = [...positionLiteral[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
const registry = load('src/main/tools/registry.ts')
const schemas = load('src/main/tools/schemas.ts', {
  './windows': { POSITIONS },
  '../harness/schemas': load('src/main/harness/schemas.ts')
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schemas })
const rawTransport = load('src/main/network/json-request.ts', {
  './sse': load('src/main/network/sse.ts', { string_decoder: require('node:string_decoder') }),
  http: require('node:http'),
  https: require('node:https')
})
const endpoints = load('src/main/network/endpoint.ts')
function validateModelOverrides(overrides = {}) {
  assert(
    overrides && typeof overrides === 'object' && !Array.isArray(overrides),
    'Model overrides must be an object'
  )
  for (const key of Object.keys(overrides))
    assert(
      Object.hasOwn(MODEL, key),
      `Unknown model setting: ${key}. Keys belong in environment variables.`
    )
  const config = { ...MODEL, ...overrides }
  endpoints.modelEndpoint(config.endpoint, config.provider)
  if (config.provider !== 'local') {
    assert(
      typeof overrides.modelId === 'string' && overrides.modelId.trim(),
      'API benchmarks require an explicit modelId'
    )
  }
  return config
}

function createHarness(task = {}, repetition = 0, modelOverrides = {}) {
  const connection = validateModelOverrides(modelOverrides)
  let serial = 0
  const fixedCrypto = {
    ...crypto,
    randomUUID: () => {
      const hex = crypto
        .createHash('sha256')
        .update(`${task.id}:${repetition}:${serial++}`)
        .digest('hex')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    }
  }
  const settings = {
    model: { ...MODEL, ...modelOverrides, ...task.model },
    behavior: { systemPrompt: '', style: 'terse', neverDo: '', ...task.behavior },
    memory: { enabled: true, maxTokens: 600, ...task.memorySettings },
    tools: { ...registry.defaultToolPermissions(), ...task.permissions },
    rules: { blockedApps: ['cmd', 'powershell', 'pwsh'], protectedWindows: [] },
    files: { workspace: scratch },
    research: { enabled: true }
  }
  const settingsModule = {
    getSettings: () => structuredClone(settings),
    settingsRecovery: () => ({ required: false })
  }
  const manager = load('src/main/security/run-manager.ts', { crypto: fixedCrypto })
  const permissions = load('src/main/permissions.ts', {
    './settings': settingsModule,
    './tools/registry': registry
  })
  const policy = load('src/main/security/policy.ts', {
    '../settings': settingsModule,
    '../tools/registry': registry,
    './run-manager': manager
  })

  const native = new Proxy(
    {},
    {
      get: (_, name) => () => {
        throw new Error(`Native edge forbidden: ${String(name)}`)
      }
    }
  )
  const tools = load('src/main/tools/index.ts', {
    '../settings': settingsModule,
    '../harness/store': native,
    '../harness/python': native,
    './wait': load('src/main/tools/wait.ts', {
      'node:timers/promises': require('node:timers/promises'),
      'node:perf_hooks': require('node:perf_hooks'),
      '../security/run-manager': { assertRun: (run) => run.signal.throwIfAborted() }
    }),
    './schemas': schemas,
    './files': native,
    './npm': native,
    './command': native,
    '../permissions': permissions,
    '../security/policy': policy,
    '../security/run-manager': manager,
    '../security/tool-contracts': contracts,
    '../network/search-provider': native,
    '../network/public-page': native,
    './openApp': native,
    './app-catalog': native,
    './windows': native,
    './screen': native,
    './interact': native,
    './automation/controls': native
  })
  const untrusted = load('src/main/llm/untrusted-data.ts', { crypto: fixedCrypto })
  const context = load('src/main/llm/context.ts', { './untrusted-data': untrusted })
  const requests = [],
    events = [],
    calls = []
  const fixtures = require('./fixtures.cjs').createFixtures(task, untrusted, manager.currentRun)
  const client = load('src/main/llm/client.ts', {
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
    './stream': load('src/main/llm/stream.ts'),
    './providers': load('src/main/llm/providers.ts'),
    './anthropic': load('src/main/llm/anthropic.ts'),
    '../security/chatgpt-auth': {
      chatgptStatus: () => ({ activeId: 'fixture-chatgpt', accounts: [] }),
      chatgptAccountScope: () => 'fixture-chatgpt',
      chatgptAccessToken: async () => {
        assert(
          task.responses,
          'ChatGPT subscription login is available in the Sophon app; headless live subscription benchmarks are not supported'
        )
        return 'fixture-oauth-token'
      }
    },
    '../security/model-credentials': {
      modelKey: (provider, endpoint) => {
        assert.equal(provider, connection.provider)
        assert.equal(endpoint, endpoints.modelEndpoint(connection.endpoint, connection.provider))
        if (task.responses) return 'fixture-api-key'
        assert.equal(
          process.env.SOPHON_BENCH_ALLOW_REMOTE,
          '1',
          'Set SOPHON_BENCH_ALLOW_REMOTE=1 to permit paid API inference with synthetic fixtures'
        )
        const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.SOPHON_API_KEY
        assert(
          key && /^[\x21-\x7e]{8,4096}$/.test(key),
          'Set the provider API key environment variable'
        )
        return key
      }
    },
    '../settings': settingsModule,
    '../tools': tools,
    '../network/endpoint': load('src/main/network/endpoint.ts'),
    '../security/run-manager': manager,
    './context': context,
    '../network/json-request': {
      requestJson: async (url, options) => {
        const base = endpoints.modelEndpoint(connection.endpoint, connection.provider)
        assert(
          [
            `${base}/models`,
            `${base}/${connection.provider === 'openai' || connection.provider === 'chatgpt' ? 'responses' : 'chat/completions'}`
          ].includes(url.href),
          'Unexpected benchmark model destination'
        )
        if (connection.provider === 'local') assert.equal(url.origin, 'http://127.0.0.1:1234')
        if (url.pathname.endsWith('/models')) {
          if (!task.responses) return rawTransport.requestJson(url, options)
          return {
            data: [
              {
                id: connection.modelId,
                supported_reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max']
              }
            ]
          }
        }
        const body = options.body ? JSON.parse(options.body) : undefined

        if (body) {
          if (connection.provider === 'local') body.seed = 4100 + repetition

          body.stream = connection.provider === 'chatgpt'
        }
        const request = { body, startedAt: new Date().toISOString() }
        requests.push(request)
        const start = performance.now()
        try {
          const response = task.responses
            ? task.responses[requests.length - 1]
            : await rawTransport.requestJson(url, {
                ...options,
                onEvent: undefined,
                body: body ? JSON.stringify(body) : undefined
              })
          assert(response, 'No scripted response remains')
          request.response = response
          if (task.responses && task.streamResponses && options.onEvent) {
            for (const [output_index, item] of (response.output ?? []).entries())
              options.onEvent(
                JSON.stringify({ type: 'response.output_item.done', output_index, item })
              )
            options.onEvent(
              JSON.stringify({
                type:
                  response.status === 'incomplete' ? 'response.incomplete' : 'response.completed',
                response: { ...response, output: [] }
              })
            )
            return null
          }
          return response
        } catch (error) {
          request.error = error.message
          throw error
        } finally {
          request.latencyMs = performance.now() - start
        }
      }
    }
  })
  const visuals = load('src/main/llm/visuals.ts', {
    '../../shared/visuals': load('src/shared/visuals.ts')
  })
  const routing = load('src/main/llm/visual-routing.ts')
  const environment = load('src/main/llm/environment.ts')
  const runner = load('src/main/llm/run-tool.ts', {
    '../harness/store': {
      readHarnessProposal: () => {
        throw new Error('No procedural proposals in this fixture')
      }
    },
    '../settings': {
      ...settingsModule,
      allowApprovedTool: (name, run) => {
        manager.assertRun(run)
        assert.notEqual(name, 'run_npm')
        assert.equal(settings.tools[name], 'ask')
        settings.tools[name] = 'allow'
      }
    },
    '../services/screen-glow': { hideScreenGlow: () => {} },
    '../tools': {
      ...tools,
      executeTool: async (name, args) => {
        assert(
          tools.activeToolSchemas().some((s) => s.function.name === name),
          'Unlisted tool execution'
        )
        calls.push({ name, args })
        const result = fixtures.execute(name, args)
        calls.at(-1).result = result
        return result
      }
    },
    '../permissions': permissions,
    '../security/policy': policy,
    '../security/run-manager': manager,
    '../security/tool-contracts': contracts,
    '../security/audit': { securityEvent: () => {} },
    '../security/local-action': {
      bindLocalAction: async (name, args) => ({
        preview: `MOCK ${name}: ${JSON.stringify(args)}`,
        revalidate: async () => {},
        scope: {}
      })
    }
  })
  const workflow = load('src/main/workflow/controller.ts', {
    './coding-session': load('src/main/workflow/coding-session.ts', {
      '../llm/untrusted-data': untrusted
    }),
    crypto: fixedCrypto,
    '../llm/untrusted-data': untrusted,
    './results': load('src/main/workflow/results.ts')
  })
  const { chat } = load('src/main/llm/chat.ts', {
    ...require('../scripts/security/harness-fixture.cjs')(load),
    './specialists': load('src/main/llm/specialists.ts', {
      ...require('../scripts/security/harness-fixture.cjs')(load),
      crypto: fixedCrypto,
      '../settings': settingsModule,
      '../security/run-manager': manager,
      '../tools': tools,
      '../tools/schemas': schemas,
      '../security/tool-contracts': contracts,
      './client': client,
      './context': context,
      './untrusted-data': untrusted
    }),
    '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
    crypto: fixedCrypto,
    '../settings': settingsModule,
    '../services/attachments': {
      attachmentContent: async () =>
        task.attachment
          ? [
              {
                type: 'text',
                text: untrusted.untrustedData('attachment', 'fixture.txt', task.attachment)
              }
            ]
          : []
    },
    './prompt': load('src/main/llm/prompt.ts', {
      '../settings': settingsModule,
      './visuals': visuals,
      './visual-routing': routing
    }),
    './client': client,
    './run-tool': runner,
    './visuals': visuals,
    './visual-reply': load('src/main/llm/visual-reply.ts', {
      './client': client,
      './visuals': visuals,
      './visual-routing': routing
    }),
    './visual-routing': routing,
    '../security/run-manager': manager,
    '../security/tool-contracts': contracts,
    './untrusted-data': untrusted,
    './context': context,
    './playbooks': load('src/main/llm/playbooks.ts'),
    '../memory/store': { listMemories: () => task.memories ?? [] },
    '../memory/records': load('src/main/memory/records.ts'),
    '../tools': tools,
    './environment': environment,
    './desktop-reply': load('src/main/llm/desktop-reply.ts', {
      './client': client,
      './context': context,
      './environment': environment
    }),
    '../workflow/controller': workflow
  })
  return {
    settings,
    requests,
    events,
    calls,
    context,
    tools,
    stop: () => manager.stopRun(),
    async run() {
      const run = manager.startRun('assistant', settings.model.endpoint, scratch)
      const history = structuredClone(task.history ?? [])
      const start = performance.now()
      let reply, error
      try {
        reply = await chat(
          task.prompt,
          (event) => {
            events.push(event)
            if (event.type === 'tool_wait')
              queueMicrotask(() =>
                permissions.resolveApproval(event.id, task.deny ? 'deny' : 'once')
              )
          },
          history,
          task.attachment ? ['fixture'] : [],
          'bench-chat',
          task.previousWorkflow
        )
      } catch (e) {
        error = e.message
      } finally {
        manager.finishRun(run)
      }
      return {
        reply,
        error,
        requests,
        events,
        calls,
        history,
        settings,
        latencyMs: performance.now() - start,
        usage: requests.reduce(
          (sum, r) => ({
            prompt_tokens:
              sum.prompt_tokens +
              (r.response?.usage?.prompt_tokens ?? r.response?.usage?.input_tokens ?? 0),
            completion_tokens:
              sum.completion_tokens +
              (r.response?.usage?.completion_tokens ?? r.response?.usage?.output_tokens ?? 0),
            missing: sum.missing + (r.response?.usage ? 0 : 1)
          }),
          { prompt_tokens: 0, completion_tokens: 0, missing: 0 }
        )
      }
    }
  }
}
module.exports = { createHarness, MODEL, contracts, schemas, validateModelOverrides }
