const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { load } = require('./security/load.cjs')

const shared = load('src/shared/llama-server.ts')
const main = load('src/main/llm/llama-server.ts', {
  child_process: require('node:child_process'),
  fs,
  path,
  net: require('node:net'),
  'timers/promises': require('node:timers/promises'),
  '../../shared/llama-server': shared
})

// Trimmed --help text from two generations of llama-server.
const recentHelp = `
-c,    --ctx-size N       size of the prompt context
-fa,   --flash-attn [on|off|auto]  set Flash Attention use
-ngl,  --gpu-layers, --n-gpu-layers N  max. number of layers to store in VRAM
-lm,   --load-mode MODE   model loading mode (default: auto)
-ctk,  --cache-type-k TYPE  KV cache data type for K
--jinja, --no-jinja
--reasoning-budget N  token budget for thinking
--ui,  --webui, --no-ui, --no-webui
--model FNAME  --port PORT`
const legacyHelp = `
-c,    --ctx-size N       size of the prompt context
-fa,   --flash-attn       enable Flash Attention (default: disabled)
-ngl,  --gpu-layers N     number of layers to store in VRAM
       --no-mmap          do not memory-map model
       --mlock            force system to keep model in RAM
-ctk,  --cache-type-k TYPE  KV cache data type for K
--jinja
--model FNAME  --port PORT`

const recent = shared.parseLlamaCapabilities(recentHelp)
const legacy = shared.parseLlamaCapabilities(legacyHelp)
assert.deepEqual(
  [recent.loadMode, recent.flashAttnValue, recent.reasoningBudget, recent.noWebui],
  [true, true, true, true]
)
assert.deepEqual(
  [legacy.loadMode, legacy.noMmap, legacy.mlock, legacy.flashAttnFlag, legacy.reasoningBudget],
  [false, true, true, true, false]
)
assert.equal(shared.looksLikeLlamaHelp(recentHelp), true)
assert.equal(shared.looksLikeLlamaHelp('Usage: powershell [options]'), false)

const options = (patch = {}) => shared.sanitizeLlamaOptions(patch, shared.DEFAULT_LLAMA_OPTIONS)
const has = (args, flag, value) => {
  const i = args.indexOf(flag)
  return i >= 0 && (value === undefined || args[i + 1] === value)
}

// Defaults: loopback only, one slot, no thinking, nothing exotic.
let args = shared.buildLlamaArgs(options(), recent, 'C:\\m\\model.gguf')
assert.ok(has(args, '--host', '127.0.0.1'))
assert.ok(has(args, '--parallel', '1'))
assert.ok(has(args, '--ctx-size', '16384'))
assert.ok(has(args, '--reasoning-budget', '0'), 'thinking off sets an immediate-end budget')
assert.ok(!has(args, '--load-mode'), 'mmap on is the default and adds nothing')
assert.ok(!has(args, '--n-gpu-layers') && !has(args, '--flash-attn'))
assert.ok(has(args, '--jinja') && has(args, '--no-webui'))

// Memory modes and GPU on a recent build.
assert.ok(
  has(shared.buildLlamaArgs(options({ mmap: false }), recent, 'm.gguf'), '--load-mode', 'none')
)
assert.ok(
  has(
    shared.buildLlamaArgs(options({ mlock: true }), recent, 'm.gguf'),
    '--load-mode',
    'mmap+mlock'
  )
)
assert.ok(
  has(shared.buildLlamaArgs(options({ gpuMode: 'cpu' }), recent, 'm.gguf'), '--n-gpu-layers', '0')
)
assert.ok(
  has(
    shared.buildLlamaArgs(options({ gpuMode: 'custom', gpuLayers: 20 }), recent, 'm.gguf'),
    '--n-gpu-layers',
    '20'
  )
)

// Thinking and its budget.
assert.ok(
  !has(shared.buildLlamaArgs(options({ thinking: true }), recent, 'm.gguf'), '--reasoning-budget')
)
assert.ok(
  has(
    shared.buildLlamaArgs(
      options({ thinking: true, limitThinking: true, thinkingBudget: 512 }),
      recent,
      'm.gguf'
    ),
    '--reasoning-budget',
    '512'
  )
)

// Older builds get the older spellings, and never a flag they do not list.
args = shared.buildLlamaArgs(
  options({ mmap: false, mlock: true, cacheType: 'q8_0' }),
  legacy,
  'm.gguf'
)
assert.ok(args.includes('--no-mmap') && args.includes('--mlock'))
assert.ok(
  args.includes('--flash-attn'),
  'a compressed cache turns flash attention on for older builds'
)
assert.ok(has(args, '--cache-type-v', 'q8_0'))
assert.ok(!args.includes('--reasoning-budget') && !args.includes('--load-mode'))

// Conflicts are reported, and values are clamped rather than trusted.
assert.ok(
  shared.llamaOptionIssues(options({ cacheType: 'q4_0', flashAttention: 'off' }), recent).cacheType
)
assert.deepEqual(shared.llamaOptionIssues(options(), recent), {})
const wild = options({
  contextSize: 99999999,
  port: 80,
  gpuLayers: -5,
  thinkingBudget: 1,
  mmap: 'yes'
})
assert.equal(wild.contextSize, 131072)
assert.equal(wild.port, 1024)
assert.equal(wild.gpuLayers, 0)
assert.equal(wild.thinkingBudget, 64)
assert.equal(wild.mmap, true)

// The program and model must be what they claim to be.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-smoke-'))
try {
  const exe = path.join(dir, 'llama-server.exe')
  const shell = path.join(dir, 'powershell.exe')
  const model = path.join(dir, 'model.gguf')
  for (const file of [exe, shell, model, path.join(dir, 'model.bin')]) fs.writeFileSync(file, 'x')
  main.assertLlamaExecutable(exe)
  assert.throws(() => main.assertLlamaExecutable(shell), /llama-server/)
  assert.throws(() => main.assertLlamaExecutable('llama-server.exe'), /Choose the llama-server/)
  assert.throws(
    () => main.assertLlamaExecutable(path.join(dir, 'missing', 'llama-server.exe')),
    /could not be found/
  )
  assert.throws(
    () => main.assertLlamaExecutable(path.join(dir, 'llama-server.exe.bat')),
    /llama-server/
  )
  main.assertGgufModel(model)
  assert.throws(() => main.assertGgufModel(path.join(dir, 'model.bin')), /\.gguf/)
  assert.throws(() => main.assertGgufModel('model.gguf'), /Choose a model/)

  // Config round trip keeps only known fields.
  const file = path.join(dir, 'llama.json')
  main.writeLlamaConfig(file, {
    ...main.DEFAULT_LLAMA_CONFIG,
    enabled: true,
    executable: exe,
    modelPath: model,
    caps: recent
  })
  const back = main.readLlamaConfig(file)
  assert.equal(back.enabled, true)
  assert.deepEqual(back.caps, recent)
  fs.writeFileSync(
    file,
    JSON.stringify({ enabled: true, executable: 5, caps: { loadMode: 'yes' }, extra: 1 })
  )
  const bad = main.readLlamaConfig(file)
  assert.equal(bad.executable, '')
  assert.equal(bad.caps.loadMode, false)
  assert.equal('extra' in bad, false)
  fs.writeFileSync(file, '{ not json')
  assert.deepEqual(main.readLlamaConfig(file), main.DEFAULT_LLAMA_CONFIG)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

// Credentials in the environment are not handed to the program.
const env = main.llamaEnvironment({
  PATH: 'C:\\x',
  CUDA_PATH: 'C:\\cuda',
  GITHUB_TOKEN: 'a',
  OPENAI_API_KEY: 'b',
  MY_SECRET: 'c',
  DB_PASSWORD: 'd'
})
assert.deepEqual(Object.keys(env).sort(), ['CUDA_PATH', 'PATH'])

// llama-server lists its model twice, as an Ollama-style `models` array and an OpenAI-style `data`
// array. Sophon must still see it, or a model it started itself would show as offline.
async function listing() {
  const id = 'C:\\models\\Qwen.gguf'
  const body = {
    models: [{ name: id, model: id, type: 'model' }],
    object: 'list',
    data: [{ id, object: 'model', owned_by: 'llamacpp', meta: { n_ctx: 4096 } }]
  }
  const settings = {
    model: { provider: 'local', endpoint: 'http://127.0.0.1:1234/v1', modelId: '' }
  }
  const client = load('src/main/llm/client.ts', {
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
    './stream': load('src/main/llm/stream.ts'),
    './providers': load('src/main/llm/providers.ts'),
    '../security/chatgpt-auth': { chatgptAccessToken: async () => '' },
    '../security/model-credentials': { modelKey: () => '' },
    '../settings': { getSettings: () => settings },
    '../tools': { activeToolSchemas: () => [] },
    '../network/json-request': { requestJson: async () => body },
    '../network/endpoint': { modelEndpoint: (url) => url },
    '../security/run-manager': { currentRun: () => undefined },
    './context': load('src/main/llm/context.ts', {
      './untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto: require('node:crypto') })
    })
  })
  assert.deepEqual(await client.getLlmStatus(), { online: true, model: id })
  assert.equal(await client.getModel(), id, 'the request still names the model by its full id')
  const choices = await client.listModelChoices()
  assert.deepEqual(
    choices.map((choice) => choice.id),
    [id]
  )
  assert.deepEqual(
    choices.map((choice) => choice.label),
    ['Qwen.gguf'],
    'a path id is shown as its file name'
  )
  console.log('llama-server model listing is understood')
}

async function live() {
  const exe = process.env.LLAMA_SERVER_EXE
  const modelPath = process.env.LLAMA_MODEL
  if (!exe || !modelPath)
    return console.log('skipped live llama-server check (set LLAMA_SERVER_EXE and LLAMA_MODEL)')
  const caps = await main.probeLlamaCapabilities(exe)
  assert.ok(
    caps.jinja || caps.reasoningBudget || caps.loadMode || caps.noMmap,
    'help text was parsed'
  )
  const server = new main.LlamaServer(async (port, _pid, signal) => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal })
    return res.ok
  })
  const config = {
    ...main.DEFAULT_LLAMA_CONFIG,
    enabled: true,
    executable: exe,
    modelPath,
    caps,
    options: options({ contextSize: 4096, port: 18089, mmap: true, thinking: false })
  }
  const status = await server.start(config)
  try {
    assert.equal(status.state, 'running')
    const models = await (await fetch('http://127.0.0.1:18089/v1/models')).json()
    assert.ok(models.data.length > 0)
    const reply = await (
      await fetch('http://127.0.0.1:18089/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 16 })
      })
    ).json()
    assert.ok(reply.choices[0].message.content.length > 0)
    await assert.rejects(server.start(config), /already running/)
  } finally {
    await server.stop()
  }
  assert.equal(server.status().state, 'stopped')
  await assert.rejects(fetch('http://127.0.0.1:18089/health'), 'the port is closed after stop')
  console.log('live llama-server start, chat and stop passed')
}

// The Electron-facing layer, with the dialog, consent prompt and settings store replaced by stubs.
async function ipc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-ipc-'))
  const exe = process.env.LLAMA_SERVER_EXE
  const modelPath = process.env.LLAMA_MODEL
  const handlers = new Map()
  const events = []
  const updates = []
  const consents = []
  const settings = { model: { endpoint: 'http://127.0.0.1:1234/v1' } }
  let picked = { canceled: true, filePaths: [] }
  let consent = true
  const frame = {}
  const event = { sender: { mainFrame: frame }, senderFrame: frame }
  const module = load('src/main/app/llama-ipc.ts', {
    electron: {
      app: { getPath: () => dir, once: () => {} },
      dialog: { showOpenDialog: async () => picked },
      BrowserWindow: { fromWebContents: () => ({}) }
    },
    path,
    '../security/native-consent': {
      nativeConsent: async (message, detail) => {
        consents.push({ message, detail })
        return consent
      }
    },
    '../security/owned-http': {
      ownedJson: async (port, route, _pid, signal) =>
        (await fetch(`http://127.0.0.1:${port}${route}`, { signal })).json()
    },
    '../settings': {
      getSettings: () => settings,
      settingsRecovery: () => ({ required: false }),
      updateSettings: (patch) => {
        updates.push(patch)
        Object.assign(settings.model, patch.model)
      }
    },
    '../llm/llama-server': main,
    '../../shared/llama-server': shared,
    './desktop': { broadcast: (channel, payload) => events.push([channel, payload]) }
  })
  module.registerLlamaIpc(
    { handle: (name, handler) => handlers.set(name, handler) },
    { owns: () => true, keepOpen: (action) => action() }
  )
  const call = (name, ...args) => handlers.get(name)(event, ...args)

  try {
    // Nothing is chosen yet; cancelling a picker changes nothing and asks for no consent.
    assert.equal((await call('llama:get')).config.executable, '')
    assert.equal(await call('llama:pick-executable'), null)
    assert.equal(consents.length, 0)

    // A file that is not llama-server is refused before any prompt, and before it could run.
    const shell = path.join(dir, 'powershell.exe')
    fs.writeFileSync(shell, 'x')
    picked = { canceled: false, filePaths: [shell] }
    await assert.rejects(call('llama:pick-executable'), /llama-server/)
    assert.equal(consents.length, 0)

    // Declining the prompt keeps the program unchosen; the prompt names the exact path.
    const fake = path.join(dir, 'llama-server.exe')
    fs.writeFileSync(fake, 'x')
    picked = { canceled: false, filePaths: [fake] }
    consent = false
    assert.equal(await call('llama:pick-executable'), null)
    assert.equal(consents.length, 1)
    assert.ok(consents[0].detail.includes(fake))
    assert.equal((await call('llama:get')).config.executable, '')

    // A model must be .gguf.
    picked = { canceled: false, filePaths: [path.join(dir, 'notes.txt')] }
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
    await assert.rejects(call('llama:pick-model'), /.gguf/)

    // Options are clamped, and starting is refused until llama.cpp is the chosen runtime.
    const clamped = await call('llama:options', { contextSize: 999999, port: 5, thinking: true })
    assert.equal(clamped.config.options.contextSize, 131072)
    assert.equal(clamped.config.options.port, 1024)
    assert.equal(clamped.config.options.thinking, true)
    await assert.rejects(call('llama:start'), /runtime/)
    assert.equal(updates.length, 0, 'nothing touches Sophon settings until the model starts')

    if (!exe || !modelPath) return console.log('skipped live llama-ipc check')
    consent = true
    picked = { canceled: false, filePaths: [exe] }
    const withExe = await call('llama:pick-executable')
    assert.equal(withExe.config.executable, exe)
    assert.ok(withExe.config.caps && withExe.config.caps.jinja !== undefined)
    assert.match(consents.at(-1).detail, /--help/)
    picked = { canceled: false, filePaths: [modelPath] }
    assert.equal((await call('llama:pick-model')).config.modelPath, modelPath)
    await call('llama:options', { contextSize: 4096, port: 18090, thinking: false })
    assert.equal((await call('llama:set-enabled', true)).config.enabled, true)

    const started = await call('llama:start')
    try {
      assert.equal(started.status.state, 'running')
      assert.equal(started.applied.contextSize, 4096)
      assert.deepEqual(updates.at(-1).model, {
        provider: 'local',
        endpoint: 'http://127.0.0.1:18090/v1',
        modelId: '',
        contextWindow: 4096,
        thinking: false
      })
      assert.ok(
        events.some(([channel, status]) => channel === 'llama:status' && status.state === 'running')
      )
      await call('llama:options', { contextSize: 8192 })
      assert.equal(
        (await call('llama:get')).applied.contextSize,
        4096,
        'restart is needed to apply'
      )
    } finally {
      await call('llama:stop')
    }
    assert.equal((await call('llama:get')).status.state, 'stopped')

    // Switching back to another app points Sophon at the usual server again.
    await call('llama:start').then(() => call('llama:set-enabled', false))
    assert.equal(settings.model.endpoint, 'http://127.0.0.1:1234/v1')
    assert.equal((await call('llama:get')).status.state, 'stopped')
    console.log('live llama-ipc start, follow, restart notice, stop and switch back passed')
  } finally {
    await call('llama:stop').catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

listing()
  .then(live)
  .then(ipc)
  .then(
    () => console.log('llama-server launcher checks passed'),
    (error) => {
      console.error(error)
      process.exitCode = 1
    }
  )
