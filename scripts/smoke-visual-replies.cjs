const assert = require('node:assert/strict')
const refusal = require('./desktop-review/visual-refusal.cjs')
const { load } = require('./security/load.cjs')

async function review() {
  const shared = load('src/shared/visuals.ts')
  const visuals = load('src/main/llm/visuals.ts', { '../../shared/visuals': shared })
  const routing = load('src/main/llm/visual-routing.ts')
  const requests = []
  const client = {
    callLLM: async (...args) => {
      requests.push(args)
      return { content: '```html\n<input type="range">\n```' }
    }
  }
  const replies = load('src/main/llm/visual-reply.ts', {
    '../../shared/visuals': shared,
    './client': client,
    './visuals': visuals,
    './visual-routing': routing
  })
  const settings = {
    behavior: { systemPrompt: 'You are a helpful assistant.', style: 'normal', neverDo: '' },
    rules: { blockedApps: [], protectedWindows: [] }
  }
  const { buildSystemPrompt } = load('src/main/llm/prompt.ts', {
    '../settings': { getSettings: () => settings },
    './visuals': visuals,
    './visual-routing': routing
  })
  assert.match(buildSystemPrompt(false), /interactive HTML with local JavaScript/)
  assert.match(buildSystemPrompt(true), /sophon.explorer/)
  assert.match(buildSystemPrompt(true), /sophon.mount/)
  assert.match(buildSystemPrompt(true), /ui.SegmentedControl/)
  assert.match(buildSystemPrompt(true), /Building visual/)
  assert.match(buildSystemPrompt(true), /calculate\(\{principal,rate,years\}\)/)
  assert(visuals.wantsVisual('Add a slider', []))
  assert(
    visuals.wantsVisual('Yes, do it', [
      [
        { role: 'user', content: 'Make an interactive widget' },
        { role: 'assistant', content: refusal }
      ]
    ])
  )
  assert(
    !visuals.wantsVisual('Open Notepad', [
      [
        { role: 'user', content: 'Make an interactive widget' },
        { role: 'assistant', content: refusal }
      ]
    ])
  )
  assert(replies.deniesInteractiveSupport(refusal))
  assert(
    replies.deniesInteractiveSupport(
      'I can’t build interactive widgets. Here is a static alternative:\n```mermaid\ngraph LR\n A-->B\n```'
    )
  )
  assert(replies.deniesInteractiveSupport('I cannot create interactive widgets within this chat.'))
  for (const content of [
    'I cannot send HTTP requests from interactive widgets.',
    'I cannot build interactive widgets that access your files through a remote network.',
    'I cannot help with that harmful request.',
    'I can create interactive widgets with local controls. External HTTP is blocked.'
  ])
    assert.equal(replies.deniesInteractiveSupport(content), false, content)
  const messages = [{ role: 'user', content: 'Create a widget with working sliders' }]
  const corrected = await replies.correctVisualReply('model', messages, { content: refusal })
  assert.match(corrected.content, /```html/)
  assert.equal(requests.length, 1)
  await require('./desktop-review/visual-routing.cjs')({
    load,
    shared,
    visuals,
    routing,
    buildSystemPrompt
  })
  assert.deepEqual(requests[0][2], { visual: true, allowTools: false, onText: undefined })
  assert.equal(requests[0][1][0], messages[0])
  assert.match(requests[0][1].at(-1).content, /External HTTP requests/)
  await replies.correctVisualReply('model', messages, {
    content: 'I cannot send HTTP requests from interactive widgets.'
  })
  assert.equal(requests.length, 1)
  console.log(
    'PASS permanent runtime capabilities, sliders and follow-up detection, exact reported denial correction, preserved network restriction, one correction without desktop tools'
  )
}
review().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
