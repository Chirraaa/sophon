const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

module.exports = async function review({
  evaluate,
  main,
  output,
  profile,
  getRequest,
  wait,
  delay
}) {
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'home ready')
  assert.equal(await evaluate('!!document.querySelector(".hero-mark,.brand-tile")'), false)
  await delay(500)
  fs.writeFileSync(
    path.join(output, 'features-home.png'),
    (await main.webContents.capturePage()).toPNG()
  )
  const first = await evaluate('window.api.getSession()')
  await evaluate(`document.querySelector('[aria-label="Attach images or text files"]').click()`)
  await wait(
    () => evaluate(`document.querySelectorAll('[aria-label^="Remove "]').length === 2`),
    'file attachments'
  )
  await evaluate(
    `(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input, 'alpha diagram'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`
  )
  await delay(100)
  await evaluate(`document.querySelector('[aria-label="Send message"]').click()`)
  await wait(
    () => evaluate('window.api.getSession().then(s => !s.busy && s.items.length === 2)'),
    'first answer'
  )
  assert(
    getRequest().messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')
    )
  )
  await wait(
    () =>
      evaluate(
        `!!document.querySelector('iframe[title="Diagram generated from the conversation"]')`
      ),
    'rendered Mermaid diagram',
    45000
  )
  await wait(
    () => evaluate(`!!document.querySelector('iframe[title="sample.png"]')`),
    'inline image'
  )
  await wait(
    () =>
      evaluate(
        '(() => { const v = document.querySelector("[data-slot=scroll-area-viewport]"); return v.scrollHeight - v.clientHeight - v.scrollTop < 10; })()'
      ),
    'answer remains visible after images load'
  )
  assert(await evaluate('document.querySelector("figure").getBoundingClientRect().width > 300'))
  fs.writeFileSync(
    path.join(output, 'features-chat.png'),
    (await main.webContents.capturePage()).toPNG()
  )
  console.log(
    'PASS image/text attachment composer, model payload, inline image and Mermaid rendering'
  )
  const state = await evaluate('window.api.getSession()')
  await evaluate(`window.api.attachments.save(${JSON.stringify(state.items[0].attachments[0].id)})`)
  assert(fs.statSync(path.join(profile, 'saved.png')).size > 0)
  assert.match(
    await evaluate('window.api.attachments.preview("../settings.json").catch(e => e.message)'),
    /Invalid (?:attachment|IPC)/
  )
  await evaluate('window.api.chats.create()')
  const second = await evaluate('window.api.getSession()')
  assert.notEqual(first.chatId, second.chatId)
  await evaluate('window.api.send("beta project")')
  assert(!JSON.stringify(getRequest().messages).includes('alpha diagram'))
  await evaluate(`window.api.chats.select(${JSON.stringify(first.chatId)})`)
  await evaluate('window.api.send("continue this conversation")')
  assert(JSON.stringify(getRequest().messages).includes('alpha diagram'))
  assert(!JSON.stringify(getRequest().messages).includes('beta project'))
  await evaluate(`window.api.chats.rename(${JSON.stringify(first.chatId)}, 'Silver project')`)
  console.log(
    'PASS independent chat histories, rename, native attachment save and invalid attachment rejection'
  )

  return { first, second }
}
