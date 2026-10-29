const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const a = load('src/main/llm/anthropic.ts')
const endpoints = load('src/main/network/endpoint.ts')

assert.equal(endpoints.modelEndpoint('https://api.anthropic.com/v1/', 'anthropic'), 'https://api.anthropic.com/v1')
assert.equal(endpoints.modelEndpoint('https://api.anthropic.com/v1', 'claude'), 'https://api.anthropic.com/v1')
assert.throws(() => endpoints.modelEndpoint('https://evil.example/v1', 'anthropic'))
assert.throws(() => endpoints.modelEndpoint('http://api.anthropic.com/v1', 'claude'))

assert.deepEqual(Object.keys(a.anthropicHeaders('anthropic', 'sk-ant-api-x')).sort(), ['anthropic-version', 'x-api-key'])
const oauth = a.anthropicHeaders('claude', 'sk-ant-oat-x')
assert.equal(oauth.Authorization, 'Bearer sk-ant-oat-x')
assert.equal(oauth['anthropic-beta'], 'oauth-2025-04-20')
assert.equal(oauth['x-api-key'], undefined)

const call = { id: 'toolu_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }
const thinking = { type: 'thinking', thinking: '', signature: 'sig' }
const input = a.anthropicInput(
  [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'hi' },
    { role: 'user', content: [{ type: 'text', text: 'again' }] },
    { role: 'assistant', content: '', tool_calls: [call, { ...call, id: 'toolu_2' }], responseState: { model: 'm', reasoning: [thinking] } },
    { role: 'tool', tool_call_id: 'toolu_1', content: 'one' },
    { role: 'tool', tool_call_id: 'toolu_2', content: 'two' }
  ],
  'm'
)
assert.equal(input.system, 'Be brief.')
assert.equal(input.messages.length, 3)
assert.equal(input.messages[0].content.length, 2)
assert.equal(input.messages[1].content[0].type, 'thinking')
assert.deepEqual(input.messages[1].content[1].input, { path: 'a' })
assert.deepEqual(input.messages[2].content.map((b) => b.tool_use_id), ['toolu_1', 'toolu_2'])
// Thinking from another model is not replayed.
assert.equal(
  a.anthropicInput([{ role: 'assistant', content: 'x', responseState: { model: 'other', reasoning: [thinking] } }], 'm').messages[0].content.length,
  1
)
assert.throws(() => a.anthropicInput([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }], 'm'))

const message = {
  type: 'message',
  stop_reason: 'tool_use',
  content: [thinking, { type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a' } }],
  usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }
}
const reply = a.anthropicReply(message, 'm')
assert.equal(reply.content, 'Reading.')
assert.equal(reply.finishReason, 'tool_calls')
assert.equal(reply.tool_calls[0].function.arguments, '{"path":"a"}')
assert.deepEqual(reply.responseState.reasoning, [thinking])
assert.deepEqual(reply.usage, { inputTokens: 100, outputTokens: 5, totalTokens: 105, cachedInputTokens: 90 })
assert.throws(() => a.anthropicReply({ ...message, stop_reason: 'refusal', stop_details: { category: 'cyber' } }, 'm'), /declined.*cyber/)
assert.throws(() => a.anthropicReply({ ...message, stop_reason: 'max_tokens' }, 'm'), (e) => e.name === 'CodingOutputLimitError')

const seen = []
const stream = a.anthropicStream((t) => seen.push(t), 'm')
for (const event of [
  { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_9', name: 'list_files', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"pa' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'th":"."}' } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' }
]) stream.accept(JSON.stringify(event))
const streamed = stream.reply()
assert.deepEqual(seen, ['Hel', 'Hello'])
assert.equal(streamed.content, 'Hello')
assert.equal(streamed.tool_calls[0].function.arguments, '{"path":"."}')
assert.equal(streamed.responseState.reasoning[0].signature, 'sig')
assert.equal(stream.usage().outputTokens, 20)
const cut = a.anthropicStream(() => {}, 'm')
cut.accept(JSON.stringify({ type: 'message_start', message: {} }))
assert.throws(() => cut.reply(), /ended before/)

const caps = load('src/shared/model-capabilities.ts')
assert.deepEqual(caps.modelCapabilities('claude-opus-5-5', 'claude', { max_input_tokens: 1000000 }).contextWindow, 1000000)
assert(caps.modelCapabilities('claude-sonnet-5-5', 'anthropic').reasoningEfforts.includes('xhigh'))
assert.deepEqual(caps.modelCapabilities('claude-3-haiku', 'anthropic'), {})
console.log('PASS Anthropic endpoint, auth headers, message mapping, replies, streaming and capabilities; no network calls')
