# NCS-0008 validation, 2026-10-28

NCS-0008 introduces a shared action ledger, structured tool outcomes, revision-bound
verification and bounded recovery from mixed checkpoint/action batches. Generated
guidance no longer becomes active solely because executions succeeded.

## Connected Luna 6 comparison

The final comparison used the user's connected Sophon ChatGPT account and
`gpt-6-luna`, low reasoning, a 24-call limit and 3,072 maximum output tokens.
Memory and specialist consultations were disabled. Each run created a disposable
CommonJS project using real Windows file operations and npm. An independent oracle
outside the editable project checked order, uniqueness, input immutability, invalid
inputs and a large input. Approvals were supplied by the fixture.

Both variants used the same driver and task, including an explicit named CommonJS
export. Baseline: `0bedbc73ae11026e417522330eab820eb1b19691` (NCS-0007).
Order: baseline/candidate, candidate/baseline, baseline/candidate.

| Pair | Variant | Result | Seconds | Calls | Input tokens | Output tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | Baseline | Pass | 37.108 | 11 | 89,952 | 1,323 |
| 1 | Candidate | Pass | 36.751 | 11 | 86,084 | 1,024 |
| 2 | Candidate | Pass | 39.607 | 12 | 95,372 | 1,149 |
| 2 | Baseline | Provider response exceeded byte budget | 80.266 | 9 | Unknown | Unknown |
| 3 | Baseline | Mixed discovery/action batch rejected | 4.836 | 1 | 5,772 | 66 |
| 3 | Candidate | Pass | 36.870 | 10 | 78,230 | 1,175 |

Candidate: 3/3 passes, mean 37.743 seconds, 11 calls, 86,562 input tokens and
1,116 output tokens. Baseline: 1/3 passes. Unknown usage is not treated as zero.
This small stochastic comparison does not establish a general reliability or
latency improvement. Early failures distort averages, provider caching is
uncontrolled, and the provider failure cannot be attributed to the architecture.
The discovery-batch failure remains a potential failure mode in both variants.
The single pair where both passed is insufficient to establish token savings.

Local raw evidence: `.cache/bench/live-1793185660070/comparison.json`, per-trial
logs, model requests, outcomes, and frozen source snapshots in the same directory.
Candidate source hash: `ca394b41efdc86f5d72fe46edd23f2f5dadecff32ce2620518bf4767d56d7464`.
Common driver hash: `f10bb1ca74028434d0e395dfa041578fe050f31f66793fab469201ee3fc79c5f`.
After this snapshot, exception handling was ordered to interrupt before saving
checkpoint documents; imports were moved; integration preserved the existing
`dev` procedure-rollback feature. Those changes received offline/build validation.

Earlier exploratory evidence is retained rather than discarded:

- `.cache/coding-agent-8cp35N/report.json`: connected Luna pilot passed.
- `.cache/bench/live-1793184998173/comparison.json`: incomplete comparison;
  model discovery returned empty before the candidate trial. The runner now uses
  the explicitly selected model instead of making discovery a prerequisite.
- `.cache/bench/live-1793185383398/comparison.json`: baseline 0/3, candidate 1/3.
  Failures exposed mixed checkpoint batches, exact-patch mismatches and a CommonJS
  export ambiguity in the task. Bounded checkpoint-batch recovery was added and
  the task clarified identically for both variants before the final comparison.

## Deterministic and native checks

- Task branch: 51/51 offline suites passed; production build/typechecks passed.
- Integrated `dev`: 52/52 offline suites passed, including the existing rollback
  suite; production build/typechecks passed. Lint has no errors and one pre-existing
  formatting warning in `app-assets.ts`.
- Native Windows UI Automation passed: field replacement/readback, stale identity
  and value rejection, toggle, selection, expansion, scrolling, invocation,
  password exclusion and cancellation in an isolated fixture window.
- New regressions cover uncertain writes, failed change commands, interrupted
  actions/checks, failed rechecks without edits, stale/cross-run verification,
  consistent published state, expiring desktop identities and duplicate actions.
- Lifecycle regressions cover lack of count-based promotion, preserved execution
  history, migration of generated active/archived guidance, and trusted starters.

These checks do not establish live Spotify playback reliability. The Spotify
snapshot/context reductions remain the deterministic NCS-0007 measurements in
`DESKTOP_INTERACTIONS.md`. No controlled lesson-usefulness evaluation was performed;
automatic usefulness promotion remains disabled. Some legacy tools still use a
single compatibility adapter to classify string results.
