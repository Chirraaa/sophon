const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const perf = require('node:perf_hooks')
const { timeContext, withClock } = load('src/main/llm/time.ts', { 'node:perf_hooks': perf })
const { wait } = load('src/main/tools/wait.ts', {
  'node:perf_hooks': perf,
  'node:timers/promises': require('node:timers/promises'),
  '../security/run-manager': { assertRun: (run) => run.signal.throwIfAborted() }
})

async function main() {
  const context = timeContext(perf.performance.now() - 2500, new Date('2026-10-24T12:00:00Z'))
  assert.match(context, /2026-10-24T12:00:00.000Z/)
  assert.match(context, /Elapsed task time: 25\d\d ms/)
  assert.match(context, /Time zone:/)
  assert.match(context, /no background scheduling/)
  // The changing clock rides at the end, so everything before it is a stable cache prefix.
  const history = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'tool', tool_call_id: 'a', content: 'Result' }
  ]
  const first = withClock(history, 'CLOCK 1')
  const second = withClock(history, 'CLOCK 2')
  assert.deepEqual(first.slice(0, -1), second.slice(0, -1))
  assert.equal(first[0].content, 'Instructions')
  assert.equal(first.at(-1).content, 'Result\n\nCLOCK 1')
  assert.equal(history.at(-1).content, 'Result', 'Stored history is not modified')
  const parts = withClock([{ role: 'user', content: [{ type: 'text', text: 'Look' }] }], 'C')
  assert.deepEqual(parts[0].content.at(-1), { type: 'text', text: 'C' })
  assert.equal(withClock([{ role: 'system', content: 'S' }], 'C')[0].content, 'S\n\nC')
  assert.deepEqual(withClock([], 'C'), [{ role: 'system', content: 'C' }])
  const controller = new AbortController()
  const run = { signal: controller.signal }
  assert.match(await wait(0.01, run), /Wait completed/)
  for (const duration of [0, -1, 61, NaN, Infinity])
    await assert.rejects(wait(duration, run), /duration/)
  const pending = wait(60, run)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  await assert.rejects(wait(1, run), { name: 'AbortError' })
  console.log('Time awareness and cancellable waits passed.')
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
