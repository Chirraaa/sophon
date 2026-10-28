# Sophon headless benchmark

The runner sends synthetic requests through the **real** chat, prompt, playbook,
context, client, repair, workflow, schema selection, tool contract, run policy and
approval code. It uses the explicit loader pattern in scripts/security/load.cjs.

All native, file, accessibility, attachment, memory-store and search-provider
edges are fixtures. No Electron process is started. Files are in-memory maps;
approvals are fixture events. Screenshot tasks use a generated PNG containing
fixture text. Generated JavaScript is never executed. Model transport permits
only the configured model base address and its model-list/inference routes.
Local mode retains the exact `http://127.0.0.1:1234/v1` restriction.

Mock approvals authorize no real operation. Benchmark results describe synthetic
tasks and do not establish general model quality or permission safety.

## Run

### Paired runs with real files and commands

`compare-live.cjs` is a separate native coding comparison. It uses the connected
Sophon ChatGPT account with the selected model and runs three or more pairs:

```powershell
node bench/compare-live.cjs --chatgpt --model gpt-6-luna --baseline tech/NCS-0007 --repetitions 3
```

The baseline is a Git snapshot; the candidate is a frozen snapshot of current
tracked and untracked application sources. Both use the same runner and independent
behavior oracle. Run order alternates. Reports under `.cache/bench/live-*/` retain
source/driver hashes, each trial's pass/failure, elapsed time, model calls and
provider-reported token usage. Missing usage stays null; aborted comparisons are
marked incomplete. Failed trials remain in the report. Inspect success rates before
comparing time or tokens: an early failure can be cheaper than completing the task.

Windows file operations, npm processes and authenticated model requests are real.
Only disposable projects are edited; approvals are supplied by the fixture. The
runner uses the existing encrypted account store in place through production
authentication, including normal token refresh, without exporting credentials.
It requires Electron and the existing signed-in Sophon profile (`--profile` may
select a different profile). It does not operate Spotify or test the approval UI.
This small scenario does not establish general reliability or lesson usefulness.
Memory is disabled, so it cannot attribute improvement to procedural guidance.

### Synthetic suite

Use existing repository dependencies; no additional installation is required.
Load qwen3.5-4b@q4_0 in LM Studio at 60k context. The isolated benchmark default
is 60,000 tokens; adjust model overrides for the model you are evaluating.

```powershell
node bench/smoke.cjs
node bench/run.cjs --label baseline
node bench/run.cjs --label candidate-study --categories study,general
node bench/run.cjs --label candidate-full
```

Default k=3; lower values are rejected. Select task IDs with
`--tasks study-linear,general-json`, or use `--split tuning`. Full runs include
both splits. Keep/revert requires full runs and existing checks, not just a subset.
`--model` accepts a JSON object of isolated model-setting overrides. It never
edits the user's profile. Default settings are defined in `harness.cjs`.

For local inference, the transport adds seed 4100 + repetition. Requests, responses, server usage and
any server fingerprint are saved. Requested seeds do not prove server support
or deterministic GPU inference.

### API providers

ChatGPT subscription login is available in the Sophon app through **Settings →
Model → OpenAI → ChatGPT subscription → Continue with ChatGPT**. Live headless subscription
benchmarks are not supported yet; the runner rejects that provider with a clear
message. Do not copy `.codex/auth.json` or export its tokens into the benchmark.
`npm run smoke:chatgpt` exercises the subscription request format and full harness
tool loop with scripted responses and a local OAuth fixture, without signing in
to a real account or consuming plan allowance.

API benchmarks use the same real chat/tool loop and synthetic fixtures. They do
not use the app's saved credentials. Set `SOPHON_BENCH_ALLOW_REMOTE=1` explicitly;
requests disclose synthetic benchmark context and can incur API charges. Keys
come only from `OPENAI_API_KEY` (OpenAI) or `SOPHON_API_KEY` (compatible provider).
Never put a key in `--model`: unknown settings are rejected and model settings
are saved in reports. Authorization headers are not recorded.

```powershell
# Set OPENAI_API_KEY securely in this terminal's environment first.
$env:SOPHON_BENCH_ALLOW_REMOTE = '1'
$model = '{"provider":"openai","endpoint":"https://api.openai.com/v1","modelId":"YOUR_MODEL_ID","maxTokens":4096}'
node bench/run.cjs --label openai-pilot --tasks general-json --model $model

# Compatible Chat Completions provider; set SOPHON_API_KEY first.
$model = '{"provider":"compatible","endpoint":"https://YOUR_PROVIDER/v1","modelId":"YOUR_MODEL_ID"}'
node bench/run.cjs --label compatible-pilot --tasks general-json --model $model
```

Use an exact model ID available to your API account. API providers require an
explicit model ID and an HTTPS endpoint; OpenAI uses its fixed official base.
API adapters do not send local template flags or benchmark seeds. Responses
input/output token usage is mapped into the report's prompt/completion columns;
raw provider usage remains in responses. Reasoning tokens count toward output
limits. Provider differences mean results are not seed-matched comparisons.

`npm run smoke:providers` checks scripted OpenAI and compatible transports,
including a real harness tool roundtrip, without network, credentials or charges.

The headless transport requests non-streamed responses to capture complete server
usage for scoring. Production streaming has separate smoke and native checks.
The explicit dependency loader includes the current streaming, specialist,
page-reading and installed-app module boundaries; native operations remain fixtures.

Reports checkpoint after every trial:

```text
.cache/bench/<UTC-timestamp>-<label>.json
.cache/bench/<UTC-timestamp>-<label>.md
.cache/bench/<UTC-timestamp>-<label>.diff
.cache/bench/<UTC-timestamp>-<label>.sources.json
```

JSON contains requests/responses, tool proposals/results, workflow/context events,
settings, assertion scores, latency and actual token usage. The sources snapshot
includes all harness and benchmark code, including untracked files. Source
changes abort a running comparison. Ctrl+C saves an interrupted trial, and two
consecutive transport failures stop the suite. Missing usage is
recorded, not presented as a measured zero. Markdown gives per-category/per-split
pass rate, mean assertion score, latency and token counts. Exceptions are failures.
A pass requires every assertion. Output/step-limit replies are incomplete.

Resume interrupted runs with `--resume <report.json>` and the same selection and
overrides, only when code, task and scorer hashes match. Keep pilots and partial
runs separate from complete comparisons.

## Tasks and scorers

tasks.cjs defines 110 requests; the last three in each category are held-out.
Each has a stable ID, prompt, deterministic check, and optional fixture data.
Freeze the split before tuning. Do not use held-out failure transcripts to choose edits.

Checks cover exact strings/JSON, word/list constraints, required/forbidden facts,
real schemas, ordered calls/arguments, denial/failure stopping, returned source
URLs, privacy canaries, KaTeX, JS syntax, HTML parsing and visual helper contracts.
Explorer formulas use a small arithmetic-only AST interpreter without function
calls or host access. Unsupported static forms require scorer review; they are
not automatically model errors.

Mermaid checks cover graph declaration, edges and balanced brackets, not a full
render. Coding checks measure syntax/structural properties, not arbitrary program
correctness. Language/factual regexes are limited. Inspect tuning transcripts and
spot-check results. No LLM judge is used.

Long-context cases calibrate synthetic filler with actual prompt_tokens, targeting
20k, 40k and 55k inputs within ±5%, with markers at different depths. This is recall
under token pressure, not comprehension of natural long documents. A separate
small-budget task checks whole-turn eviction.

## Add tasks

Add a row to a category in tasks.cjs, with an ID, self-contained prompt, check
object and optional fixture object. Checks include exact, required, forbidden,
json, sequence, args, forbiddenTools, citations and visual. Fixture fields include
files, memories, permissions, deny, failTool, uncertainTool and sources.
Use synthetic data only. Add positive/negative scorer cases to smoke.cjs.
Version the corpus and start a new baseline when expectations, fixtures or scorer
semantics change. Never silently reuse old scores.

## Improvement protocol

1. Complete the baseline at k≥3 and read tuning failures.
2. Choose one general mechanism and change one variable.
3. Run affected categories, then the full suite.
4. Compare both splits; retain held-out improvement without unacceptable regressions.
5. Run `npm run build`, `npm run lint` and `npm test` for every kept change.
6. Record kept and reverted candidates, results and limitations under `.cache/bench/`.

Review inference costs before running paid providers. The runner does not modify
model files or the app's saved profile.
