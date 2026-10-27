const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { publicSourceUrl } = load('src/main/network/url-policy.ts', {
  net: require('node:net'),
  'dns/promises': {}
})
let memories = []
let opened = []
let reads = 0
let fail = false
const pages = load('src/main/services/pages.ts', {
  electron: {
    shell: {
      openExternal: async (url) => {
        if (fail) throw new Error('Browser unavailable')
        opened.push(url)
      }
    }
  },
  '../network/url-policy': { publicSourceUrl },
  '../network/public-page': {
    requestPublicText: async (url, signal) => {
      signal.throwIfAborted()
      reads++
      if (fail) throw new Error('Page unavailable')
      return {
        url,
        body: '<title>Equation</title><p>ax² + bx + c = 0</p><script>malicious()</script>',
        html: true
      }
    }
  },
  '../network/html-text': load('src/main/network/html-text.ts', { parse5: require('parse5') }),
  '../memory/store': {
    listMemories: () => memories,
    saveMemory: (draft) => {
      memories = [{ ...draft, id: draft.id || 'preference' }]
    }
  }
})
async function main() {
  assert.equal(pages.pagePreference(), null)
  for (const url of [
    'file:///C:/secret',
    'javascript:alert(1)',
    'https://127.0.0.1',
    'https://user:pass@example.org',
    'https://example.org:444'
  ])
    await assert.rejects(pages.openPage(url, 'browser', false), /public HTTPS/)
  assert.equal(opened.length, 0)
  const preview = await pages.openPage('https://example.org', 'reader', false)
  assert.equal(preview.title, 'Equation')
  assert.match(preview.text, /ax²/)
  assert.doesNotMatch(preview.text, /malicious/)
  assert.equal(pages.pagePreference(), null)
  assert.equal(reads, 1)
  await pages.openPage('https://example.org', 'browser', true)
  assert.deepEqual(opened, ['https://example.org/'])
  assert.equal(reads, 1)
  assert.equal(pages.pagePreference(), 'browser')
  const id = memories[0].id
  await pages.openPage('https://example.org', 'reader', true)
  assert.equal(memories[0].id, id)
  assert.equal(pages.pagePreference(), 'reader')
  assert.equal(memories[0].kind, 'preference')
  assert.equal(memories[0].pinned, true)
  fail = true
  await assert.rejects(pages.openPage('https://example.org', 'browser', true), /unavailable/)
  assert.equal(pages.pagePreference(), 'reader')
  await assert.rejects(pages.openPage('https://example.org', 'reader', true), /unavailable/)
  assert.equal(pages.pagePreference(), 'reader')
  console.log(
    'PASS page destination choice, public URL validation, inert text extraction, explicit remembered preference, update without duplication and failure preservation'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
