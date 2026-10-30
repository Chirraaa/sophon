const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')

const shared = load('src/shared/timers.ts')
const service = load('src/main/services/timers.ts', {
  crypto,
  '../../shared/timers': shared
})
const results = load('src/main/workflow/results.ts')
const registry = load('src/main/tools/registry.ts')
const schemas = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const { validateToolArguments } = load('src/main/security/tool-contracts.ts', {
  '../tools/schemas': schemas
})
const tools = load('src/main/tools/timers.ts', {
  '../workflow/tool-outcome': load('src/main/workflow/tool-outcome.ts', { './results': results }),
  '../../shared/timers': shared,
  '../services/timers': service
})
const run = (name, args) => tools.executeTimerTool(name, validateToolArguments(name, args))

for (const name of ['timer_set', 'timer_cancel']) {
  assert(registry.isKnownTool(name), name)
  assert(
    schemas.toolSchemas.some((tool) => tool.function.name === name),
    name
  )
}

assert.equal(shared.formatClock(272000), '4:32')
assert.equal(shared.formatClock(3723000), '1:02:03')
assert.equal(shared.formatClock(100), '0:01', 'rounds up so 0:00 only means done')
assert.equal(shared.formatClock(-5), '0:00')
assert.equal(shared.describeDuration(5400), '1 hour 30 minutes')
assert.equal(shared.describeDuration(1), '1 second')

for (const bad of [
  { seconds: 'ten' },
  { label: 'x' },
  { seconds: 5, extra: true },
  { seconds: Infinity }
])
  assert.throws(() => validateToolArguments('timer_set', bad), Error, JSON.stringify(bad))
for (const range of [0, 0.4, 90000])
  assert.equal(run('timer_set', { seconds: range }).status, 'failed', `${range} is out of range`)
assert.equal(service.listTimers().length, 0)

const changes = []
const done = []
service.onTimersChange((list) => changes.push(list.map((timer) => timer.state)))
service.onTimerDone((timer) => done.push(timer.label))

const started = run('timer_set', { seconds: 1, label: 'Tea' })
assert.match(started, /Timer "Tea" started for 1 second/)
assert.deepEqual(changes.at(-1), ['running'])
const [timer] = service.listTimers()
assert.equal(timer.label, 'Tea')
assert.equal(timer.durationMs, 1000)

for (let i = 0; i < 4; i++) run('timer_set', { seconds: 600 })
const full = run('timer_set', { seconds: 600 })
assert.match(full.text, /Only 5 timers/, 'the sixth running timer is refused')

const missing = run('timer_cancel', { id: 'timer-000000000000' })
assert.equal(missing.status, 'failed')
const all = run('timer_cancel', {})
assert.match(all, /Cancelled 5 timers/)
assert.equal(service.listTimers().length, 0)
assert.deepEqual(done, [], 'a cancelled timer never reports done')
assert.equal(run('timer_cancel', {}).status, 'failed', 'nothing to cancel')

run('timer_set', { seconds: 1, label: 'Break' })
setTimeout(() => {
  assert.deepEqual(done, ['Break'])
  const [finished] = service.listTimers()
  assert.equal(finished.state, 'done')
  assert.equal(service.removeTimer(finished.id), true, 'a finished timer can be dismissed')
  assert.equal(service.removeTimer(finished.id), false)
  assert.equal(service.listTimers().length, 0)
  console.log('timers smoke passed')
}, 1300)
