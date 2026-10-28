const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { ToolDiscovery } = load('src/main/llm/tool-discovery.ts')
const { APP_ROUTING } = load('src/main/llm/app-routing.ts')
const { environmentPrompt } = load('src/main/llm/environment.ts')
const names = [
  'discover_tools',
  'plugins_list',
  'mcp_catalog',
  'mcp_call',
  'mcp_read',
  'plugin_read',
  'list_windows',
  'inspect_app',
  'act_on_control',
  'look_at_screen'
]
const catalog = names.map((name) => ({ function: { name, description: name } }))
const discovery = new ToolDiscovery('Find the general channel in Discord')
assert(discovery.select(catalog).some((tool) => tool.function.name === 'plugins_list'))
discovery.used('plugins_list')
assert(discovery.select(catalog).some((tool) => tool.function.name === 'mcp_catalog'))
discovery.used('mcp_catalog')
assert(discovery.select(catalog).some((tool) => tool.function.name === 'mcp_call'))
assert(
  !discovery
    .select(catalog.filter((t) => t.function.name !== 'mcp_call'))
    .some((t) => t.function.name === 'mcp_call')
)
for (const compact of [true, false]) {
  const prompt = environmentPrompt({
    mode: 'assistant',
    compact,
    tools: names,
    workspaceSelected: false,
    inlineVisual: false
  })
  assert(prompt.includes(APP_ROUTING))
}
assert.match(APP_ROUTING, /denied operation is a stop/)
const visual = new ToolDiscovery('Inspect the custom app')
visual.used('look_at_screen')
const visualCatalog = [
  'look_at_screen',
  'click',
  'scroll',
  'press_keys',
  'type_text',
  'inspect_app',
  'act_on_control',
  'list_windows'
].map((name) => ({ function: { name, description: name } }))
assert(
  visual.select(visualCatalog).some((tool) => tool.function.name === 'click'),
  'A visual fallback keeps coordinate actions immediately available'
)
console.log(
  'PASS app routing: direct service discovery, related schemas, blocked tool exclusion, full and compact guidance'
)
