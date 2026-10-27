const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const perf = require('node:perf_hooks')
const { timeContext } = load('src/main/llm/time.ts', { 'node:perf_hooks': perf })
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
