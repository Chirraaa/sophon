# Evolving Markdown harness

Sophon has procedural Markdown memory alongside its encrypted personal memory.
This evolves inference-time guidance, not model weights.

## Setup

1. In **Settings → Model → Generation**, match the context window to your model
   server. New profiles default to 32,000 context tokens; existing profiles retain
   their saved settings. Tune generation for the model you choose.
2. In **Settings → Memory**, keep saved memories on and click **Enable harness
   tools · ask first**. New permissions start blocked in existing profiles. Choose
   **Always allow** in Permissions for these two tools to avoid individual approvals.
3. Install Python 3 on PATH. This machine has Python 3.13.5; packaged Sophon does
   not bundle Python.

Memory settings show the actual directory and each document's contents. Under
Electron's user-data directory:

```text
harness/
  skills/learning.md
  script-tools/csv.md
  subagents/{researcher,visual-explainer,tutor,reviewer}.md
  loop-hooks/{before-task,after-tool,before-answer}.md
  proposals/
  revisions/
```

Markdown is plaintext. Keep private facts, secrets and personal preferences in
the existing encrypted, scoped memory store. Current requests override old guidance.
Turning saved memories off disables procedural recall and model edits while
retaining the files. Research mode never loads procedural memory.

## Propose → probe → compose

The response loop proposes the smallest useful approach, probes it with actual
evidence or computation, and composes the answer. Simple requests remain direct.
Explicit corrections and repeatable tool evidence can support reusable procedures:

- `harness_manage(list/read)` inspects guidance.
- `propose` saves a draft with a heading and **Source:**, **Applies to:** and
  **Limits:** labels. Active guidance stays unchanged.
- `probe` checks that exact draft. A Python recipe must run an example and match
  an expected JSON result. Other probes check structure only: they do **not**
  establish that advice or its claimed source is correct.
- `compose` requires a passing probe for the same content in the current app
  session. Non-script guidance also requires one-use approval of the exact
  candidate, even under Always allow. It publishes a versioned trial and retains the prior version.
  Editing a proposal invalidates its probe. A failed script probe can be revised.
- `archive` moves obsolete guidance to revisions and removes it from recall.
  Starter documents are seeded once, so archived starters are not recreated.

Trial guidance is labeled unproven. Three distinct host-recorded successful uses
without regressions promote it to active. Failed trials return to candidate;
repeated active failures mark the entry revised and exclude it from recall.
`status` shows lifecycle counters and evidence; `discard` invalidates a candidate;
`rollback` restores an archived entry's prior state. See the
[coding harness guide](CODING_HARNESS.md) for task checkpoints, attribution and limits.

The model must assess meaningful evidence before promoting a lesson. There is no
automatic transcript extraction or claim that structure checks establish semantic
quality. Persistence requires a successful tool result.

Recall selects at most two relevant skill/recipe excerpts plus compact hook
guidance within the context estimate. Hooks are declarative instructions:
before-task during task assembly, after-tool following a result, and before-answer
as composition guidance in the model context. They are not executable callbacks.
Subagent files guide the four existing profiles; they do not add new executors.

Limits: 100 active files per category, 100 pending proposal files and 1,000 archived
revisions; documents also have byte limits. Unsafe names, links and hard-linked
files are rejected. Archives remain for inspection/manual restoration. Markdown
cannot grant tool permissions.

## Deterministic Python and CSV

`python_calculate` starts an isolated Python process and interprets an allowlisted
expression AST, without calling `eval`/`exec` on model code. Supported operations
include arithmetic, slices, comparisons, single-level comprehensions, aggregates,
selected math functions, and exact decimal/rational calculations:

```python
1739 * 2847
str(Decimal("0.1") + Decimal("0.2"))
sum(float(r["amount"]) for r in rows if r["region"] == "EU")
```

Supply inline CSV `content` or a relative workspace `path`. Reads use the existing
workspace checks, approved file identity and locked-read machinery. File bytes go
directly to Python; the model gets the requested result, row count and column names.
Use `rows[:3]` for a small sample. Reusable `script-tools/*.md` recipes contain one
fenced expression and can be invoked by passing their slug as `recipe`.

CSV requires distinct nonempty headers and consistent row widths. Missing or
nonnumeric data is not silently dropped. Limits: 512,000 CSV bytes, 10,000 rows,
2,000 expression characters, bounded operations, ten seconds and 16,000 output
characters. Windows workers also use the existing CPU/memory Job Object limits.
Stop terminates the worker. This is bounded Python, without imports, attributes,
arbitrary scripts/pandas, shell access or model-directed file I/O. Floating-point
results have normal rounding limits; a numerical example is not a proof.

## Questions and clean specialist contexts

`ask_questions` pauses generation and renders one to three native questions, each
with two to four choices. Cards support navigation, custom answers, Skip, Skip all,
and a normal chat reply. Answers form the next user turn. Earlier cards become
inactive after the conversation moves on. The model uses this for consequential
ambiguity, such as unspecified lesson help, and answers precise questions directly.
Procedural guidance can refine this decision over time; one skipped card does not
automatically create a permanent personal preference.

Each specialist receives only its assignment, selected excerpts and corresponding
Markdown guidance, without conversation history or personal memories. Results are
bounded, fallible evidence. Only Researcher has enabled web tools. Specialists
cannot recursively delegate or gain permissions. Calls stay sequential on the same
loaded model: parallel calls are not assumed to speed up a single 4B model in VRAM.

## Default generation settings

The defaults use temperature 0.7, thinking off, 4,096 output tokens, eight recent
exchanges and 20 model calls per request. Context packing retains a 20% estimation
margin, accounts for schemas/output, and evicts complete older exchanges. 32k is
the total window, not 32k of input plus unrestricted output.

Detected local Qwen3.5 IDs also receive top-p 0.8 with thinking off / 0.95 with
thinking on, top-k 20, min-p 0, repeat penalty 1 and presence penalty 1.5 with
thinking off / 0 with thinking on. Temperature stays user-controlled. Thinking on
with temperature 0.6 is a starting point for precise coding and needs enough output
budget for reasoning. Backend support for these fields varies.

The loaded model reports an actual context length of **32,000**, confirmed with
`lms ps --json`. On this LM Studio runtime, `chat_template_kwargs.enable_thinking`
alone was ignored. Adding `reasoning_effort: "none"` removed reasoning output in
the live probe (zero reasoning tokens, versus 106 for the same short request).
Sophon sends this field for detected local Qwen3.5 models; thinking on requests
`medium`. Other servers may handle it differently.

Settings are based on the [Qwen model card](https://huggingface.co/Qwen/Qwen3.5-4B)
and [LM Studio's supported Chat Completions fields](https://lmstudio.ai/docs/developer/openai-compat/chat-completions).
Small-model quantization still limits planning and factual reliability. Tools make
computations checkable; the model can still choose an incorrect query.

## Verification

- `npm run smoke:harness`: real constrained Python, CSV, blocked operations,
  cancellation, propose/probe/compose, archive, revisions, restart and contracts.
- `npm run smoke:harness -- --live`: also checks vague lesson → questions,
  precise photon question → direct answer, exact arithmetic → Python. Outputs are
  saved in `.cache/harness-*`. Passed with `qwen3.5-4b@q4_0`.
- `npm run smoke:specialists`: also checks question-loop pausing, retained tool
  pairs, invalid question rejection and rejecting actions batched with questions.
- After building, `npm run smoke:questions`: hidden Electron fixture checks native
  cards, navigation, custom answers, skipping, direct replies, inactive old cards
  and narrow layout. Screenshot: `.cache/desktop-review/questions-card.png`.

These are targeted regression cases, not a long-term learning benchmark or proof
that every future routing choice is correct.
