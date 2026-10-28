const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')

async function main() {
  assert(
    process.argv.includes('--live'),
    'Pass --live to test the loaded local model with a real disposable project'
  )
  const connected = process.argv.includes('--chatgpt')
  const sandMode = process.argv.includes('--sand')
  const modelIndex = process.argv.indexOf('--model')
  const modelId = modelIndex >= 0 ? process.argv[modelIndex + 1] : 'gpt-6-luna'
  const catalog = connected
    ? undefined
    : await fetch('http://127.0.0.1:1234/api/v0/models').then((r) => r.json())
  const loaded = connected
    ? { id: modelId, loaded_context_length: 32000 }
    : catalog.data.find((m) => m.state === 'loaded' && m.type !== 'embeddings')
  assert(loaded, 'Load a local model in LM Studio first')
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, '.cache/coding-agent-'))
  const workspace = path.join(directory, 'project')
  fs.mkdirSync(workspace)
  const deletionMode = process.argv.includes('--delete')
  if (deletionMode) {
    fs.writeFileSync(path.join(workspace, 'remove-me.txt'), 'disposable fixture')
    fs.writeFileSync(path.join(workspace, 'keep-me.txt'), 'preserve this fixture')
    fs.mkdirSync(path.join(workspace, 'empty-folder'))
    fs.mkdirSync(path.join(workspace, 'old-folder/nested'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'old-folder/nested/old.txt'), 'disposable fixture')
  }

  const testPath = path.join(directory, 'oracle.cjs')
  fs.writeFileSync(
    testPath,
    `const assert = require('node:assert/strict')
const { uniqueStrings } = require('./project/src/unique.cjs')
assert.deepEqual(uniqueStrings([]), [])
assert.deepEqual(uniqueStrings(['b','a','b','','__proto__','a','']), ['b','a','','__proto__'])
const input = ['x','x','y']; const before = [...input]
assert.deepEqual(uniqueStrings(input), ['x','y']); assert.deepEqual(input, before)
for (const invalid of [null, {}, 'abc', [1], ['a', null]]) assert.throws(() => uniqueStrings(invalid), TypeError)
assert.equal(uniqueStrings(Array.from({length: 20000}, (_, i) => String(i % 100))).length, 100)
console.log('ORACLE PASS: order, uniqueness, immutability, invalid inputs, large input')
`
  )
  const settings = {
    files: { workspace },
    memory: { enabled: false },
    research: { enabled: false },
    behavior: { systemPrompt: '', style: 'terse', neverDo: '' },
    rules: { blockedApps: [], protectedWindows: [] },
    tools: Object.fromEntries(
      (deletionMode
        ? ['list_files', 'read_file', 'delete_file', 'delete_directory']
        : ['list_files', 'read_file', 'write_file', 'edit_file', 'create_directory', 'run_npm']
      ).map((n) => [n, 'allow'])
    ),
    model: {
      provider: connected ? 'chatgpt' : 'local',
      endpoint: connected ? 'https://api.openai.com/v1' : 'http://127.0.0.1:1234/v1',
      modelId: loaded.id,
      contextWindow: loaded.loaded_context_length || 32000,
      maxTokens: 3072,
      maxSteps: 24,
      temperature: 0.2,
      thinking: false,
      reasoningEffort: 'low',
      historyTurns: 4,
      specialists: false
    }
  }
  if (sandMode) {
    assert(!connected, '--sand uses the loaded local model')
    const saved = JSON.parse(
      fs.readFileSync(path.join(process.env.APPDATA, 'voice-agent/settings.json'), 'utf8')
    )
    Object.assign(settings.model, saved.model, { specialists: false })
    assert.equal(settings.model.provider, 'local')
    assert.equal(settings.model.endpoint, 'http://127.0.0.1:1234/v1')
    console.log('SAND REPRO', JSON.stringify(settings.model), 'workspace:', workspace)
  }
  const settingsModule = {
    getSettings: () => settings,
    settingsRecovery: () => ({ required: false })
  }
  const manager = load('src/main/security/run-manager.ts', { crypto })
  const untrusted = load('src/main/llm/untrusted-data.ts', { crypto })
  const schema = load('src/main/tools/schemas.ts', {
    './windows': { POSITIONS: [] },
    '../harness/schemas': load('src/main/harness/schemas.ts')
  })
  const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schema })
  const registry = load('src/main/tools/registry.ts')
  const policy = load('src/main/security/policy.ts', {
    '../settings': settingsModule,
    '../tools/registry': registry,
    './run-manager': manager
  })
  const workspacePolicy = load('src/main/security/workspace-policy.ts', {
    electron: {
      app: {
        getPath: (n) => path.join(directory, n),
        getAppPath: () => path.join(directory, 'app')
      }
    },
    'fs/promises': fsp,
    path
  })
  const files = load('src/main/tools/files.ts', {
    'fs/promises': fsp,
    path,
    '../settings': settingsModule,
    '../security/workspace-policy': workspacePolicy,
    '../security/workspace-handles': load('src/main/security/workspace-handles.ts', {
      koffi: require('koffi'),
      path,
      crypto
    }),
    '../security/run-manager': manager,
    '../llm/untrusted-data': untrusted,
    '../services/isolated-parser': {}
  })
  const npm = load('src/main/tools/npm.ts', {
    electron: connected ? require('electron') : { app: { on: () => {} } },
    net: require('node:net'),
    child_process: require('node:child_process'),
    util: require('node:util'),
    path,
    'fs/promises': fsp,
    './files': files,
    '../security/run-manager': manager,
    '../security/worker-job': load('src/main/security/worker-job.ts', { koffi: require('koffi') }),
    '../llm/untrusted-data': untrusted
  })
  const binding = load('src/main/security/local-action.ts', {
    '../tools/windows': {},
    '../tools/win32': {},
    '../permissions': {},
    '../tools/automation/controls': {},
    '../tools/files': files,
    'fs/promises': fsp,
    './run-manager': manager,
    path,
    './workspace-policy': workspacePolicy,
    '../network/search-provider': {},
    '../tools/screen': {},
    '../tools/openApp': {}
  })
  const events = [],
    calls = [],
    requests = []
  const handlers = {
    list_files: files.listFiles,
    read_file: files.readWorkspaceFile,
    write_file: files.writeWorkspaceFile,
    edit_file: files.editWorkspaceFile,
    create_directory: files.createWorkspaceDirectory,
    run_npm: (a) => npm.runNpm(a, manager.currentRun())
  }
  const tools = {
    activeToolSchemas: () =>
      schema.toolSchemas.filter((t) => policy.canUseTool(manager.currentRun(), t.function.name)),
    executeTool: async (name, args, run, scope) => {
      policy.authorizeTool(run, name)
      contracts.validateToolArguments(name, args)

      if (name === 'run_npm') {
        assert(
          ['["init","-y"]', '["run","test"]', '["--version"]'].includes(JSON.stringify(args.args)),
          'Unexpected npm command in fixture'
        )
        if (args.args[0] === 'run') {
          const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'))
          assert(
            ['node ../oracle.cjs', 'echo "Error: no test specified" && exit 1'].includes(
              manifest.scripts.test
            ),
            'Only the trusted oracle or npm default placeholder may execute'
          )
        }
      }
      calls.push({ name, args })
      if (name === 'delete_file' || name === 'delete_directory')
        return files.deleteWorkspaceEntry(args, name === 'delete_directory', scope.deletion)
      return handlers[name](args, scope.file)
    }
  }
  const runner = load('src/main/llm/run-tool.ts', {
    '../tools': tools,
    '../settings': settingsModule,
    '../permissions': {
      toolPermission: (n) => settings.tools[n] || 'block',
      requestApproval: async () => 'once'
    },
    '../security/policy': policy,
    '../security/run-manager': manager,
    '../security/tool-contracts': contracts,
    '../security/audit': { securityEvent: () => {} },
    '../security/local-action': binding,
    '../services/screen-glow': { hideScreenGlow: () => {} },
    '../harness/store': {}
  })
  const context = load('src/main/llm/context.ts', { './untrusted-data': untrusted })
  const transport = load('src/main/network/json-request.ts', {
    http: require('node:http'),
    https: require('node:https'),
    './sse': load('src/main/network/sse.ts', { string_decoder: require('node:string_decoder') })
  })
  const profileIndex = process.argv.indexOf('--profile')
  const auth = connected
    ? await require('./security/connected-chatgpt.cjs').connectedChatgpt({
        load,
        manager,
        transport,
        scratch: directory,
        profile: profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined
      })
    : {}
  const client = load('src/main/llm/client.ts', {
    '../settings': settingsModule,
    '../tools': tools,
    '../network/endpoint': load('src/main/network/endpoint.ts'),
    '../network/json-request': {
      requestJson: async (url, options) => {
        assert.equal(url.origin, connected ? 'https://api.openai.com' : 'http://127.0.0.1:1234')
        if (options.body) requests.push(JSON.parse(options.body))
        if (!sandMode) return transport.requestJson(url, options)
        const id = requests.length
        const started = Date.now()
        let chunks = 0,
          textChars = 0,
          argumentChars = 0,
          lastProgress = 0
        const mark = (event) => {
          const entry = { request: id, elapsedMs: Date.now() - started, ...event }
          fs.appendFileSync(path.join(directory, 'stream.jsonl'), JSON.stringify(entry) + '\n')
          if (event.phase || Date.now() - lastProgress >= 10000) {
            console.log('STREAM', JSON.stringify(entry))
            lastProgress = Date.now()
          }
        }
        mark({ phase: 'start' })
        const onEvent = options.onEvent
        try {
          const result = await transport.requestJson(url, {
            ...options,
            onEvent: (data) => {
              chunks++
              if (data !== '[DONE]') {
                const event = JSON.parse(data)
                const choice = event.choices?.[0]
                const delta = choice?.delta
                textChars += delta?.content?.length ?? 0
                for (const call of delta?.tool_calls ?? [])
                  argumentChars += call.function?.arguments?.length ?? 0
                mark({
                  chunks,
                  textChars,
                  argumentChars,
                  finishReason: choice?.finish_reason,
                  delta
                })
              } else mark({ phase: 'done-marker', chunks, textChars, argumentChars })
              onEvent?.(data)
            }
          })
          mark({ phase: 'http-end', chunks, textChars, argumentChars })
          return result
        } catch (error) {
          mark({ phase: 'error', error: error.message, chunks, textChars, argumentChars })
          throw error
        }
      }
    },
    '../security/run-manager': manager,
    './context': context,
    './stream': load('src/main/llm/stream.ts'),
    './providers': load('src/main/llm/providers.ts'),
    '../security/model-credentials': {},
    '../security/chatgpt-auth': auth,
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') })
  })
  // The user explicitly selected this model. Model discovery can time out and
  // return an empty list; the authenticated inference response is authoritative.
  const fixtures = require('./security/harness-fixture.cjs')(load)
  const routing = load('src/main/llm/visual-routing.ts')
  const visuals = load('src/main/llm/visuals.ts', {
    './visual-routing': routing,
    '../../shared/visuals': load('src/shared/visuals.ts')
  })
  const chat = load('src/main/llm/chat.ts', {
    ...fixtures,
    crypto,
    '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
    '../settings': settingsModule,
    '../services/attachments': { attachmentContent: async () => [] },
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
    '../memory/store': {},
    '../memory/records': {},
    '../tools': tools,
    './specialists': {},
    './environment': load('src/main/llm/environment.ts'),
    './desktop-reply': { correctDesktopReply: async (_m, _messages, reply) => reply },
    '../workflow/controller': require('./security/workflow-load.cjs')(load)
  }).chat
  const run = manager.startRun('assistant', settings.model.endpoint, workspace)
  const started = Date.now()
  let reply, error
  try {
    reply = await chat(
      sandMode
        ? 'Coding Benchmark: Build a 2D Falling-Sand Physics Sandbox. Build a complete interactive simulator in index.html in this empty workspace. Include sand, water, stone, erase, gravity, brush size, pause and clear controls. Use tools to create the file and verify the result. Keep everything self-contained with no dependencies or downloads.'
        : deletionMode
          ? 'Delete remove-me.txt, delete the empty empty-folder, and delete old-folder with all its contents. Inspect first, then use delete_file and delete_directory; use recursive: true only for old-folder. Keep keep-me.txt untouched. Stop after confirming those paths were removed.'
          : 'Implement a small CommonJS Node.js project in this empty workspace. Inspect it, save one active task mapped to all needed tools with skill none, then run npm init -y. Create src/unique.cjs with the named CommonJS export module.exports = { uniqueStrings }, where uniqueStrings(values) is the function. Require an array of strings or throw TypeError, preserve first occurrence order, do not mutate input, and handle large arrays efficiently. Use edit_file on package.json to set scripts.test to exactly "node ../oracle.cjs"; the trusted test file already exists outside this workspace, do not edit it. Create the src folder with create_directory, write the new module, mark the task implemented, and let the host run verification. Record a final checkpoint with the complexity tradeoff, review limits (specialists disabled), and lesson "No reusable lesson found". No dependencies, downloads, shell commands, or deletion. Do the work with tools.',
      (e) => {
        events.push(e)
        if (e.type === 'tool_start') console.log('TOOL', e.name)
        if (e.type === 'tool_end') console.log('RESULT', e.result.slice(0, 180))
        if (sandMode && e.type !== 'text') console.log('EVENT', JSON.stringify(e).slice(0, 450))
      },
      []
    )
  } catch (e) {
    error = e.message
  } finally {
    manager.finishRun(run)
    fs.writeFileSync(
      path.join(directory, 'report.json'),
      JSON.stringify(
        {
          model: loaded.id,
          provider: settings.model.provider,
          settings: settings.model,
          modelCalls: run.modelCalls,
          usage: run.usage ?? null,
          scenario: sandMode ? 'sand' : deletionMode ? 'deletion' : 'coding',
          elapsedMs: Date.now() - started,
          reply,
          error,
          calls,
          events,
          requests,
          limits:
            'Synthetic isolated project; approval UI stubbed to once; no install/network-package test.'
        },
        null,
        2
      )
    )
  }
  console.log('Report:', path.join(directory, 'report.json'))
  if (sandMode) {
    console.log(
      'SAND RESULT',
      JSON.stringify({
        error,
        elapsedMs: Date.now() - started,
        modelCalls: run.modelCalls,
        files: fs.readdirSync(workspace),
        reply
      })
    )
    assert(!error, error)
    assert(fs.existsSync(path.join(workspace, 'index.html')), 'No index.html was produced')
    return
  }
  assert(!error, error)
  if (deletionMode) {
    for (const target of ['remove-me.txt', 'empty-folder', 'old-folder'])
      assert(!fs.existsSync(path.join(workspace, target)), 'Model did not delete ' + target)
    assert.equal(
      fs.readFileSync(path.join(workspace, 'keep-me.txt'), 'utf8'),
      'preserve this fixture'
    )
    assert(calls.some((call) => call.name === 'delete_file'))
    assert.equal(calls.filter((call) => call.name === 'delete_directory').length, 2)
    assert(events.filter((e) => e.type === 'tool_wait').every((e) => e.canAlwaysAllow === false))
    console.log(
      'PASS live deletion: loaded model inspected and deleted one file, an empty folder and a nested tree using real tools; sibling preserved; one-use approval UI stubbed'
    )
    return
  }
  for (const name of ['create_directory', 'run_npm', 'write_file', 'edit_file'])
    assert(
      calls.some((c) => c.name === name),
      'Missing actual ' + name
    )
  assert(calls.some((c) => c.name === 'run_npm' && c.args.args[0] === 'init'))
  assert.match(reply, /Project checks:/)
  assert(events.some((e) => e.type === 'tool_end' && e.result.includes('ORACLE PASS')))
  console.log(
    'PASS live coding agent: real model + chat loop + Windows file tools + npm init + independent behavior oracle'
  )
}
if (require.main === module || process.versions.electron)
  main()
    .then(() => {
      if (process.argv.includes('--chatgpt')) require('electron').app.exit(0)
    })
    .catch((e) => {
      console.error(e.message)
      if (process.argv.includes('--chatgpt')) require('electron').app.exit(1)
      else process.exitCode = 1
    })
module.exports = { main }
