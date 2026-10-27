const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { CodingResources } = load('src/shared/coding-resources.ts')

const capacity = { inputBudget: 120000, usedTokens: 10000, outputTokens: 16000 }
const conservative = new CodingResources('conserve')
const automatic = new CodingResources()
const expanded = new CodingResources('expand')
for (const resource of [conservative, automatic, expanded]) resource.update(capacity)
assert(conservative.snapshot().readChars < automatic.snapshot().readChars)
assert(automatic.snapshot().readChars < expanded.snapshot().readChars)
assert(conservative.snapshot().editChars < automatic.snapshot().editChars)
assert(automatic.snapshot().editChars < expanded.snapshot().editChars)

automatic.request({ read_chars: 60000, edit_chars: 65536 })
assert.equal(automatic.snapshot().readChars, 60000)
assert(automatic.snapshot().editChars < 65536, 'Output capacity must clamp requests')
automatic.consume(109000)
assert.equal(automatic.snapshot().readChars, 600, 'Reads shrink with remaining context')
automatic.update(capacity)
assert.equal(automatic.snapshot().readChars, 60000, 'Capacity returns after context compaction')
automatic.update({ inputBudget: Infinity, usedTokens: 1000000, outputTokens: 0 })
assert.equal(automatic.snapshot().outputTokens, null, 'Unknown provider capacity must stay unknown')
assert.equal(automatic.snapshot().editChars, 65536)
assert.equal(automatic.snapshot().remainingContextTokens, null)
automatic.reduceEditSize()
assert.equal(
  automatic.snapshot().editChars,
  32768,
  'Output exhaustion reduces the working edit size'
)
automatic.request({ edit_chars: 64000 })
assert.equal(automatic.snapshot().editChars, 64000, 'The model can negotiate again after recovery')
assert.throws(() => automatic.request({ edit_chars: 65537 }), /integer/)
assert.throws(() => automatic.request({ read_chars: 0 }), /integer/)
assert.throws(() => automatic.request({ read_chars: 1.5 }), /integer/)
assert.equal(new CodingResources().snapshot().readChars, 12000, 'Adjustments are scoped to one run')
expanded.observeEdit({ edits: [{ old_text: 'old', new_text: 'x'.repeat(20000) }] })
assert.equal(expanded.snapshot().editChars, 20000, 'Successful edits inform later working sizes')
expanded.update({ inputBudget: 1000, usedTokens: 1000, outputTokens: 64 })
assert.equal(expanded.snapshot().editChars, 1)
assert.equal(expanded.snapshot().readChars, 1)
console.log(
  'PASS coding resources: preferences, model negotiation, context pressure/compaction, output backoff, provider-controlled capacity, run isolation and observed edits'
)
