const assert = require('node:assert/strict')
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
console.log(
  'PASS browser tool schemas, deferred discovery, permissions and rejection of arbitrary scripts/endpoints'
)
