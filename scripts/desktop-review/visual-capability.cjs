const assert = require('node:assert/strict')

module.exports = async function review({ evaluate, getRequest, getRequestCount }) {
  const before = getRequestCount()
  await evaluate(
    'window.api.send("Create interactive widgets with working sliders; capability regression")'
  )
  assert.equal(getRequestCount() - before, 2)
  assert.equal(getRequest().messages[0].role, 'system')
  assert.match(
    getRequest().messages[0].content,
    /incorrectly denied an available renderer capability/
  )
  assert.equal(getRequest().tools, undefined)
  assert.equal(getRequest().max_tokens, 8192)
  const state = await evaluate('window.api.getSession()')
  assert.match(state.items.at(-1).text, /```html/)
  assert.doesNotMatch(state.items.at(-1).text, /What I CANNOT do/)
  console.log(
    'PASS exact reported capability denial corrected once through the real chat pipeline, without desktop tools'
  )
}
