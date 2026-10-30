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
const { publicSourceUrl } = load('src/main/network/url-policy.ts', {
  net: require('node:net'),
  'dns/promises': {}
})
const { fetchPublicImage } = load('src/main/network/public-image.ts', {
  https: { request: () => assert.fail('A blocked address must never be requested.') },
  '../security/run-manager': { assertRun: () => {} },
  '../services/isolated-parser': { decodeImage: async () => assert.fail('Nothing to decode.') },
  './url-policy': { publicSourceUrl, publicLookup: async () => assert.fail('Blocked first.') }
})

assert(registry.isKnownTool('show_image'))
assert.equal(registry.defaultToolPermissions().show_image, 'ask')

// Exactly one source is required.
validateToolArguments('show_image', { url: 'https://example.org/cat.png', caption: 'A cat' })
validateToolArguments('show_image', { screenshot: true })
validateToolArguments('show_image', { path: 'images/cat.png' })
for (const args of [
  {},
  { screenshot: false },
  { url: 'https://example.org/cat.png', screenshot: true },
  { url: 'https://example.org/' + 'a'.repeat(2000) },
  { screenshot: true, caption: 'x'.repeat(121) },
  { screenshot: true, path: 'C:\\secret.png' },
  { url: 'https://example.org/cat.png', path: 'cat.png' }
])
  assert.throws(() => validateToolArguments('show_image', args), undefined, JSON.stringify(args))

// A displayed screenshot reaches the user only; other pictures reach the model too.
const outcomes = load('src/main/workflow/tool-outcome.ts', {
  './results': load('src/main/workflow/results.ts')
})
const shown = outcomes.normalizeToolOutcome(
  'show_image',
  {},
  { text: 'ok', image: 'data:x', display: true }
)
assert.equal(shown.image, undefined)
assert.equal(shown.shownImage, 'data:x')
const seen = outcomes.normalizeToolOutcome('show_image', {}, { text: 'ok', image: 'data:x' })
assert.equal(seen.image, 'data:x')

// The model is offered the tool when the user asks to see something.
for (const request of [
  'Show me a picture of the Eiffel Tower',
  'show a screenshot of that window',
  'Can you display the logo from https://example.org'
])
  assert(
    new ToolDiscovery(request)
      .select(schema.toolSchemas)
      .some((t) => t.function.name === 'show_image'),
    request
  )

// Only public HTTPS pictures are fetched; blocked targets never reach the network.
const run = { images: 0, signal: new AbortController().signal }
async function main() {
  for (const url of [
    'http://example.org/cat.png',
    'file:///C:/secret.png',
    'https://127.0.0.1/cat.png',
    'https://user:pass@example.org/cat.png',
    'https://example.org:8443/cat.png'
  ])
    await assert.rejects(fetchPublicImage(url, run), /public HTTPS/, url)
  run.images = 6
  await assert.rejects(fetchPublicImage('https://example.org/cat.png', run), /limited to six/)
  console.log('show-image checks passed')
}
void main()
