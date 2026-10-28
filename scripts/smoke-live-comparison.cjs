const assert = require('node:assert/strict')
const { summarize } = require('../bench/compare-live.cjs')
const runs = []
for (let repetition = 0; repetition < 3; repetition++)
  for (const variant of ['baseline', 'candidate'])
    runs.push({
      variant,
      repetition,
      passed: variant === 'candidate' || repetition > 0,
      elapsedMs: 100,
      modelCalls: 4,
      inputTokens: variant === 'candidate' ? null : 500,
      outputTokens: 20
    })
const report = summarize(runs, 3)
assert.equal(report.complete, true)
assert.equal(report.wins, 1)
assert.equal(report.regressions, 0)
assert.equal(
  report.variants.candidate.meanInputTokens,
  null,
  'Unknown usage must never become zero tokens'
)
assert.equal(report.variants.baseline.meanInputTokens, 500)
assert.equal(summarize(runs.slice(1), 3).complete, false)
assert.throws(() => summarize([...runs, runs[0]], 3), /Duplicate/)
assert.throws(() => summarize(runs, 1))
assert.equal(
  summarize(
    runs.map((run) => ({ ...run, passed: !run.passed })),
    3
  ).regressions,
  1
)
console.log(
  'PASS live comparison accounting: paired outcomes, incomplete trials, duplicate rejection and missing usage'
)
