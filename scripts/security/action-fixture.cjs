const crypto = require('node:crypto')
const { load } = require('./load.cjs')
const { normalizeToolOutcome } = load('src/main/workflow/tool-outcome.ts', {
  './results': load('src/main/workflow/results.ts')
})

// Explicit fixture adapter for historical tests whose abbreviated display text
// is not a real tool protocol. New outcome/ledger tests construct typed records.
function record(component, tool, args, text, status) {
  const result = normalizeToolOutcome(tool, args, text)
  const outcome = {
    ...result,
    status,
    code: status === 'denied' ? 'denied' : status === 'uncertain' ? 'unverified' : 'ok',
    execution: ['denied', 'failed'].includes(status)
      ? 'not-started'
      : status === 'uncertain'
        ? 'unknown'
        : 'completed'
  }
  const event = component.ledger.record(crypto.randomUUID(), tool, args, outcome)
  component.record(event)
  return event
}
module.exports = { record, normalizeToolOutcome }
