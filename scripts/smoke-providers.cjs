const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const { createHarness, validateModelOverrides } = require('../bench/harness.cjs')
const endpoints = load('src/main/network/endpoint.ts')
const providers = load('src/main/llm/providers.ts')
const model = {
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  modelId: 'fixture-model'
}
const reasoning = {
  type: 'reasoning',
  id: 'rs_fixture',
  summary: [],
  encrypted_content: 'encrypted-fixture'
}
const text = (value) => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text: value }]
})
const call = (name, args = {}, call_id = 'call_fixture') => ({
  type: 'function_call',
  call_id,
  name,
  arguments: JSON.stringify(args)
})
const response = (...output) => ({
  status: 'completed',
  output,
  usage: { input_tokens: 100, output_tokens: 15 }
})

async function main() {
  assert.throws(() => endpoints.modelEndpoint(model.endpoint), /Remote inference is disabled/)
  assert.equal(endpoints.modelEndpoint(model.endpoint, 'openai'), model.endpoint)
  for (const endpoint of [
    'http://api.openai.com/v1',
    'https://evil.example/v1',
    'https://api.openai.com/v1?key=secret',
    'https://user:pass@api.openai.com/v1'
  ])
    assert.throws(() => endpoints.modelEndpoint(endpoint, 'openai'))
  assert.equal(
    endpoints.modelEndpoint('https://provider.example/api/v1/', 'compatible'),
    'https://provider.example/api/v1'
  )
  assert.throws(() => endpoints.modelEndpoint('http://provider.example/v1', 'compatible'))
  assert.throws(
    () => validateModelOverrides({ apiKey: 'never-save-this' }),
    /Unknown model setting/
  )
  assert.throws(
    () => validateModelOverrides({ provider: 'openai', endpoint: model.endpoint }),
    /explicit modelId/
  )

  const fixtures = path.join(root, '.cache/provider-smoke')
  fs.mkdirSync(fixtures, { recursive: true })
  const directory = fs.mkdtempSync(path.join(fixtures, 'credentials-'))
  let revocations = 0
  let encryptionAvailable = true
  const credentials = load('src/main/security/model-credentials.ts', {
    electron: {
      app: { getPath: () => directory },
      safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        encryptString: (value) => Buffer.from(value).map((b) => b ^ 0x55),
        decryptString: (value) =>
          Buffer.from(value)
            .map((b) => b ^ 0x55)
            .toString()
      }
    },
    fs,
    path,
    crypto,
    '../network/endpoint': endpoints,
    './run-manager': { revokePolicy: () => revocations++ }
  })
  assert.equal(credentials.hasModelKey('openai', model.endpoint), false)
  credentials.setModelKey('openai', model.endpoint, 'fixture-secret-key')
  assert.equal(credentials.modelKey('openai', model.endpoint), 'fixture-secret-key')
  assert.equal(credentials.hasModelKey('compatible', model.endpoint), false)
  assert.equal(credentials.hasModelKey('compatible', 'https://other.example/v1'), false)
  assert(
    !fs
      .readFileSync(path.join(directory, fs.readdirSync(directory)[0]))
      .includes(Buffer.from('fixture-secret-key'))
  )
  assert.throws(() => credentials.setModelKey('openai', model.endpoint, 'key\r\nheader'))
  encryptionAvailable = false
  assert.throws(() => credentials.modelKey('openai', model.endpoint), /encryption/)
  assert.throws(
    () => credentials.setModelKey('openai', model.endpoint, 'fixture-secret-key'),
    /encryption/
  )
  encryptionAvailable = true
  credentials.setModelKey('openai', model.endpoint, '')
  assert.equal(credentials.hasModelKey('openai', model.endpoint), false)
  assert(revocations >= 2)

  assert.equal(fs.readdirSync(directory).length, 0)
  fs.rmdirSync(directory)

  const harness = createHarness(
    {
      id: 'api-roundtrip',
      files: { 'package.json': JSON.stringify({ scripts: { test: 'node test.cjs' } }) },
      toolResults: {
        list_files: '[file] package.json',
        run_npm: JSON.stringify({ exitCode: 0, stopped: false })
      },
      prompt: 'Read source.txt and create copy.txt',
      responses: [
        response(reasoning, call('read_file', { path: 'source.txt' })),
        response(
          call('write_file', { path: 'copy.txt', content: 'alpha\nbeta\ngamma' }, 'call_write')
        ),
        response(text('Saved copy.txt.'))
      ]
    },
    0,
    model
  )
  const result = await harness.run()
  assert(!result.error, result.error)
  assert.deepEqual(
    result.calls.map((call) => call.name),
    ['read_file', 'write_file', 'list_files', 'read_file', 'run_npm']
  )
  assert.match(result.reply, /^Saved copy\.txt\./)
  assert.match(result.reply, /npm run test.*passed/)
  assert.deepEqual(result.usage, { prompt_tokens: 300, completion_tokens: 45, missing: 0 })
  const request = result.requests[0].body
  assert.equal(request.store, false)
  assert.equal(request.seed, undefined)
  assert.equal(request.chat_template_kwargs, undefined)
  assert.equal(request.max_tokens, undefined)
  assert(request.max_output_tokens > 0)
  assert(
    request.tools.every(
      (tool) => tool.type === 'function' && tool.strict === false && tool.name && !tool.function
    )
  )
  const second = result.requests[1].body.input
  const reasoningIndex = second.findIndex((item) => item.type === 'reasoning')
  assert(reasoningIndex >= 0)
  assert.deepEqual(second[reasoningIndex], reasoning)
  assert.equal(second[reasoningIndex + 1].type, 'function_call')
  assert(
    second.some((item) => item.type === 'function_call_output' && item.call_id === 'call_fixture')
  )
  assert(!JSON.stringify(result).includes('fixture-api-key'))

  for (const task of [
    {
      id: 'api-denied',
      prompt: 'Open Notepad.',
      deny: true,
      responses: [response(call('open_app', { name: 'notepad' }))]
    },
    {
      id: 'api-invalid',
      prompt: 'List windows',
      responses: [response(call('list_windows'), call('imaginary_shell', {}, 'bad_call'))]
    },
    {
      id: 'api-incomplete',
      prompt: 'Open Notepad.',
      responses: [
        {
          ...response(call('open_app', { name: 'notepad' })),
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' }
        }
      ]
    }
  ]) {
    const stopped = await createHarness(task, 0, model).run()
    assert.equal(stopped.calls.length, 0, task.id)
    assert(stopped.error || /denied/i.test(stopped.reply), task.id)
  }

  const image = providers.responsesInput(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }
        ]
      }
    ],
    model.modelId
  )[0]
  assert.equal(image.content[1].type, 'input_image')
  assert.equal(image.content[1].image_url, 'data:image/png;base64,AA==')
  const updates = []
  const stream = providers.responsesStream((value) => updates.push(value), model.modelId)
  stream.accept(JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi' }))
  stream.accept(JSON.stringify({ type: 'response.output_text.delta', delta: ' there' }))
  assert.throws(() => stream.reply(), /before completing/)
  stream.accept(
    JSON.stringify({
      type: 'response.completed',
      response: response(reasoning, text('Hi there'), call('list_windows'))
    })
  )
  assert.deepEqual(updates, ['Hi', 'Hi there'])
  assert.equal(stream.reply().tool_calls[0].function.name, 'list_windows')
  assert.deepEqual(stream.reply().responseState.reasoning, [reasoning])
  assert.throws(
    () =>
      providers
        .responsesStream(() => {}, 'fixture')
        .accept(JSON.stringify({ type: 'response.failed' })),
    /failed/
  )
  assert.throws(
    () =>
      providers.responsesReply(
        {
          ...response(call('list_windows')),
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' }
        },
        'fixture'
      ),
    /incomplete tool batch/
  )

  let settings = { ...harness.settings, model: { ...harness.settings.model, ...model } }
  let outgoing
  let network = 0
  const client = load('src/main/llm/client.ts', {
    'node:perf_hooks': require('node:perf_hooks'),
    './time': load('src/main/llm/time.ts', { 'node:perf_hooks': require('node:perf_hooks') }),
    './stream': load('src/main/llm/stream.ts'),
    './providers': providers,
    './anthropic': load('src/main/llm/anthropic.ts'),
    '../settings': { getSettings: () => settings },
    '../tools': { activeToolSchemas: () => [] },
    '../network/endpoint': endpoints,
    '../security/run-manager': { currentRun: () => undefined },
    '../security/chatgpt-auth': {
      chatgptAccessToken: async () => {
        throw new Error('ChatGPT login forbidden in this offline fixture')
      }
    },
    '../security/model-credentials': { modelKey: () => 'fixture-secret-key' },
    './context': harness.context,
    '../network/json-request': {
      requestJson: async (url, options) => {
        network++
        outgoing = { url, options, body: JSON.parse(options.body) }
        if (options.onEvent) {
          options.onEvent(JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello' }))
          options.onEvent(
            JSON.stringify({ type: 'response.completed', response: response(text('Hello')) })
          )
          return null
        }
        return {
          choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }]
        }
      }
    }
  })
  const streamed = await client.callLLM(model.modelId, [{ role: 'user', content: 'Hi' }], {
    onText: () => {}
  })
  assert.equal(streamed.content, 'Hello')
  assert.equal(outgoing.url.href, model.endpoint + '/responses')
  assert.equal(outgoing.options.headers.Authorization, 'Bearer fixture-secret-key')
  assert.equal(outgoing.body.stream, true)
  settings.model = {
    ...settings.model,
    provider: 'compatible',
    endpoint: 'https://provider.example/api/v1'
  }
  const messages = [
    { role: 'user', content: 'Hi' },
    {
      role: 'assistant',
      content: 'Hello',
      responseState: { model: model.modelId, reasoning: [reasoning] }
    }
  ]
  await client.callLLM(model.modelId, messages)
  assert.equal(outgoing.url.href, settings.model.endpoint + '/chat/completions')
  assert.equal(outgoing.body.chat_template_kwargs, undefined)
  assert.equal(outgoing.body.messages[1].responseState, undefined)
  const completions = load('src/main/llm/stream.ts').completionStream(() => {})
  completions.accept(
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_partial',
                type: 'function',
                function: { name: 'list_windows', arguments: '{}' }
              }
            ]
          },
          finish_reason: 'length'
        }
      ]
    })
  )
  assert.throws(() => completions.reply(), /incomplete tool batch/)
  const compatible = await createHarness(
    {
      id: 'compatible-tool',
      prompt: 'Read source.txt and create copy.txt',
      responses: [
        {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_partial',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"source.txt"}' }
                  }
                ]
              },
              finish_reason: 'length'
            }
          ]
        }
      ]
    },
    0,
    {
      provider: 'compatible',
      endpoint: 'https://provider.example/api/v1',
      modelId: 'fixture-model'
    }
  ).run()
  assert.equal(compatible.calls.length, 0)
  assert.match(compatible.error, /incomplete tool batch/)
  settings.model.provider = 'local'
  const before = network
  await assert.rejects(client.callLLM(model.modelId, messages), /Remote inference is disabled/)
  assert.equal(network, before)
  console.log(
    'PASS API provider tool roundtrip, usage, denial, atomic batches, encrypted reasoning, images, streaming, auth headers, endpoint validation and credential isolation; no network or paid calls'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
