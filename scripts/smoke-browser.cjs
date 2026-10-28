const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')
const schema = load('src/main/tools/schemas.ts', {
  './windows': { POSITIONS: [] },
  '../harness/schemas': load('src/main/harness/schemas.ts')
})
const { validateToolArguments } = load('src/main/security/tool-contracts.ts', {
  '../tools/schemas': schema
})
const { ToolDiscovery } = load('src/main/llm/tool-discovery.ts')
const registry = load('src/main/tools/registry.ts')
for (const name of ['browser_open', 'browser_tabs', 'browser_inspect', 'browser_act']) {
  assert(registry.isKnownTool(name))
  assert.equal(registry.defaultToolPermissions()[name], 'ask')
}
const discovery = new ToolDiscovery('Open the website in Chrome')
assert(discovery.select(schema.toolSchemas).some((t) => t.function.name === 'browser_tabs'))
discovery.used('browser_open')
assert(discovery.select(schema.toolSchemas).some((t) => t.function.name === 'browser_inspect'))
discovery.used('browser_inspect')
assert(discovery.select(schema.toolSchemas).some((t) => t.function.name === 'browser_act'))
const action = { observation: 'dom-123456789abc', element: 'e1', action: 'fill', text: '' }
assert.equal(validateToolArguments('browser_act', action).text, '')
for (const args of [
  { ...action, text: undefined },
  { ...action, element: 'invented' },
  { ...action, script: 'alert(1)' },
  { ...action, action: 'click' }
])
  assert.throws(() => validateToolArguments('browser_act', args))
assert.throws(() =>
  validateToolArguments('browser_open', { url: 'https://example.com', browser: 'arbitrary.exe' })
)
assert.throws(() =>
  validateToolArguments('browser_open', {
    url: 'https://example.com',
    endpoint: 'http://localhost:9222'
  })
)
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const context = load('src/main/llm/context.ts', { './untrusted-data': envelope })
const tab = 'tab-111111111111'
const observation = (n) => ({
  role: 'tool',
  tool_call_id: `read-${n}`,
  content: envelope.untrustedData(
    'browser-dom',
    'Fixture',
    JSON.stringify({
      tab,
      observation: `dom-${String(n).padStart(12, '0')}`,
      controls: [{ name: 'Draft', value: 'Historical value' }]
    })
  )
})
const actionCall = {
  role: 'assistant',
  content: '',
  tool_calls: [
    { id: 'click', type: 'function', function: { name: 'browser_act', arguments: '{}' } }
  ]
}
const combined = {
  ...observation(2),
  content: 'Browser accepted input. Fresh DOM evidence follows.\n' + observation(2).content
}
const packed = context.latestDesktopObservations([observation(1), actionCall, combined])
assert.equal(JSON.parse(packed[0].content).kind, 'expired-browser-dom')
assert.equal(packed[2].content, combined.content)
const stale = context.latestDesktopObservations([combined, actionCall])[0]
assert(stale.content.startsWith('Browser accepted input.'))
assert(!stale.content.includes('dom-000000000002'))
const historical = context.historicalDesktopReferences([observation(1)])
assert(!historical[0].content.includes(tab))
assert(!historical[0].content.includes('dom-000000000001'))
assert.deepEqual(context.latestDesktopObservations(packed), packed)
console.log(
  'PASS browser tool schemas, deferred discovery, permissions and rejection of arbitrary scripts/endpoints'
)
