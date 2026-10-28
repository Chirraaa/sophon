# Coding harness

Runtime ownership and execution flow are defined in [Runtime architecture](ARCHITECTURE.md). This document describes a component of that single assistant runtime.

Coding runs inside the same assistant loop as conversation, visuals, desktop
actions and research. The implemented runtime and procedural lifecycle diagrams
are in `docs/agentic-capabilities/`.

The coordinator recognizes implementation requests and activates coding verification
at file mutations or mutating project commands. Planning is optional: missing plans,
active tasks or task/tool mappings do not reject tool batches. There is no setup
gate. `CodingSession.guard()` rejects `write_file` overwrites of
existing files; ordinary tool policy and workspace validation still apply.
`coding_checkpoint` maintains application state; it cannot execute project tools,
grant permissions or mark checks passed.

| Design stage | Runtime behavior                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Awareness    | Each call receives a capability manifest with actual tools, specialist profiles, procedural catalog and limits. Project inspection uses approved file tools.                                                                                                                                                                                                                                          |
| Understand   | The coordinator inspects the project and can ask native question cards for consequential ambiguity. Specialist consultation is model-selected and optional.                                                                                                                                                                                                                                           |
| Plan         | After inspection, the model may save a bounded plan, documentation evidence and ordered tasks. Checkpoint validation rejects unknown tools, unread skills, unavailable profiles and cyclic/forward dependencies. A plan is not required to edit.                                                                                                                                                      |
| Execute      | Edits use the normal tool permissions, file identity checks, cancellation and command limits. Saved task/profile/tool mappings do not authorize or gate execution.                                                                                                                                                                                                                                    |
| Verify       | Marking a saved task implemented triggers host-discovered project checks before the next model call. Final answers also trigger required checks. Edits invalidate previous passes; at most three failures per check are allowed. Only observed check passes mark tasks verified.                                                                                                                      |
| Checkpoint   | Optional plans and bounded state are mirrored as Markdown. Once a plan exists, task statuses and the checkpoint must be current before completion. Encrypted workflow state is authoritative. Explicit continuation in the same workspace resumes work and invalidates old check passes.                                                                                                              |
| Compact      | At 75% of the estimated input budget, complete prior exchanges are replaced in inference context by the original request plus the host checkpoint. The manifest and instructions are rebuilt. Active task, plan, changes and recent evidence remain; omitted file contents must be read again. Tool-call/result pairs are never split. The transcript remains available for conversation persistence. |
| Finish       | The coordinator reviews its changes and actual checks. Specialist review and learning are optional; reflection can be recorded from the final answer. Exhausted budgets leave work in needs_review with a resumable checkpoint.                                                                                                                                                                       |
| Learn        | A lesson is a candidate until validated. Explicitly assigned, read skills accumulate host-recorded outcomes from verified coding runs. No model-facing success flag can increment those counters.                                                                                                                                                                                                     |

## Files and persistence

The chat and shortcut show a coding progress card with task, file and check panels.
The shortcut expands automatically for coding, with a manual smaller/larger toggle.
Patch previews appear in both approval cards and the Files panel. Check labels use
actual command exit codes; a completed tool call alone is not a passed check.

Existing project files must be patched through `edit_file`; the coding stage gate
rejects `write_file` with `overwrite: true`. Up to twelve replacement hunks can be
validated and saved together. If any hunk lacks a unique match, no changes are saved.
`read_file` supports bounded text excerpts with `start_line` and `line_count`.
Excerpts use a separate envelope kind, so partial manifests cannot masquerade as
complete verification manifests. This reduces repeated source text in model
requests and responses; no fixed token-saving percentage is claimed.

Snapshots are under Electron's user-data directory:

```text
coding-runs/<workflow-id>/
  PLAN.md
  TASKS.md
  DOCS.md
  STATE.md
  DECISIONS.md
  TRACE.md
```

The checkpoint tool returns the actual directory. These are **plaintext local
artifacts**, including plan text and bounded tool/change excerpts. They are not
written into the user's repository and are not read back as execution authority.
Do not put credentials in plans or lessons. Files use fixed names, checked
directories, rejection of links/hard links and atomic per-file replacement.
The set of six files is not one filesystem transaction; encrypted workflow state
is authoritative if a write is interrupted. Chat deletion removes the encrypted
checkpoint through existing conversation storage; Markdown mirrors remain until
removed from `coding-runs` by the user.

## Procedural lifecycle

`harness_manage` retains `list`, `read`, `propose`, `probe`, `compose`, and `archive`,
and adds `status`, `discard`, and `rollback`. Per-entry state, version, usage counts
and bounded evidence are stored in `harness/lifecycle/`.

- New proposals are candidates and do not enter recall.
- A script recipe needs an actual matching replay probe. Other documents need a
  structure probe **and approval of the exact proposed content**. That approval
  is one-use, including under Always allow; a structure check cannot establish
  factual correctness.
- Composition publishes a numbered **trial**, labeled unproven in recall. The
  previous document is retained in revisions.
- Successful recorded runs accumulate execution evidence without promoting a trial
  to active. Coding outcomes are attributed only to skills explicitly mapped to a
  task and read in that run; recipe executions record their own worker outcomes.
  These are operational success signals, not proof that the advice caused success.
- A failed trial returns to candidate and leaves recall. Two recorded failures
  of an active entry mark it revised and exclude it from automatic use. A patch
  goes through validation and trial again; existing active guidance is retained
  while a replacement is only a proposal.
- Archive marks an entry deprecated and removes it from the catalog. Rollback
  restores its archived state, so an unproven trial cannot become active through
  rollback. Discard invalidates a candidate's probe and excludes it from recall.

Saved-memory settings still disable procedural recall and learning. Personal
memories remain separate and encrypted. Trusted starter documents retain their
status. Generated documents previously promoted by execution counts migrate back
to trial with their history intact, including archived entries on rollback.
Usefulness promotion remains disabled pending independent quality evaluation.
On `dev`, the existing version-rollback mechanism can retain a trial with three
successful executions and no failures as a recovery point. Restoring it preserves
its unproven trial status; these counters do not certify usefulness. Trusted
starter versions remain active, and old generated active snapshots restore as trials.

## Built-in coding teacher

Active coding sessions receive a compact teaching guide before edits and after
context compaction. It is application guidance, separate from learned procedural
skills: it works in existing profiles and with Memory disabled, needs no skill
assignment, and cannot grant permissions or mark code correct.

The core guide teaches observable acceptance criteria, the smallest maintainable
design, clear boundaries, input validation, error handling, and meaningful behavior
tests. It asks for time/space and I/O reasoning on relevant hot paths, with a clear
distinction between estimates and measurements. It discourages unnecessary
abstractions, infrastructure, caches and state libraries.

Up to four topic guides are selected from the request and bounded checkpoint
plan, stack/docs, task titles and inspected paths. Auth takes priority; other
guides cover Next.js, database operations, algorithmic complexity and React state
and accessibility. A match is a reminder within the requested scope, not
authorization to add a feature. Explicit exclusions still apply, including
guest-only apps. Topic changes in a checkpoint are reflected on the next call.

Auth guidance covers sessions, ownership/tenant authorization, server entry points,
CSRF, cookies, logout and negative access tests. Next.js guidance requires checking
the installed version: Next.js 16 renamed middleware to Proxy; neither convention
replaces authorization close to data and in directly callable server operations.
Built-in reference URLs were reviewed on 2026-10-25 and are starting points for
version-specific lookup, not proof that a live lookup happened. Sources and guide
selection live in `src/shared/coding-quality.ts`.

Review is optional through the ordinary `consult_specialist` tool. There is no
mandatory edge, repair or final reviewer stage. The coordinator assesses changes
and actual check evidence; specialist agreement is not independent verification.

`npm run smoke:coding:quality` checks guide selection, budget bounds, checkpoint
continuity and bounded checkpoint evidence. `npm run smoke:coding` exercises native Windows
file operations, real npm init/scripts, failure codes, cancellation and deletion.
The native npm check also installs and loads a synthetic local package using
`--offline --ignore-scripts --no-audit --no-fund`; it does not establish that
registry downloads or a particular Next.js initializer will succeed.

Missing workspace paths detected before execution have a separate recovery path:
the assistant may inspect the intended parent and create authorized folders, with
at most two path refreshes. Each attempt still uses normal tool permissions and
approval. This does not retry an executed write, a permission denial, an uncertain
result, or a cancelled task. Checkpoint errors identify missing inspection and
invalid plans. Empty docs default to an explicit host-owned statement that no
stack/version or documentation evidence is recorded, without inventing research.
Successful npm init and a failed default test placeholder supply focused next-step
feedback, including inspecting/patching package.json rather than initializing again.
Exact patch-match failures carry a dedicated error code proving that no patch was
saved. They share the bounded workspace refresh allowance: read the current file
and submit a corrected patch under normal approval. File identity failures and
unknown write outcomes remain stopping conditions.

`npm run smoke:coding:agent` is an opt-in live integration diagnostic for the
currently loaded local model. It runs the actual chat/client loop, policy,
workspace handles and npm in a new `.cache/coding-agent-*/project` folder, with
synthetic one-use approval decisions instead of the UI. Success requires creating
a module, patching the npm manifest and passing a trusted external behavior oracle for order,
uniqueness, invalid inputs, immutability and a larger input. It installs no packages.
The project and JSON report remain for inspection. This diagnostic does not test
network installs, the approval UI, auth deployment, or general
coding quality across projects.

### File and folder deletion

`delete_file {path}` permanently removes one exact workspace file.
`delete_directory {path}` removes an empty folder; `{path, recursive: true}`
removes the explicitly requested folder and contents. Both appear in Permissions
as **Delete project files/folders**, default to Block in existing profiles, and
require one-use approval even if a stale profile claims Always allow. They do not
use the Recycle Bin. The Files panel labels deletion and displays its preview.

Approval previews enumerate the complete deletion set (up to 250 entries and 24
nested levels). The working-folder root, outside/traversing/wildcard paths,
protected descendants, special objects, symbolic links, junctions and hard-linked
files are rejected. A protected child rejects the whole request before deletion;
the tool does not silently skip it. Changed objects or membership require fresh
approval. Native handles pin ancestors and all approved objects before the first
removal, then remove children before parents and verify path absence. No shell
command, recursive path-based removal, or permissive native fallback is used.

Recursive removal is not atomic. Cancellation, an OS error or a newly added child
can leave partial work. Such results are explicitly unverified, record partial
progress, and stop for inspection rather than retrying. Closing a successful
native deletion handle permanently removes its object. Current-run source
deletions invalidate coding checks just like edits; active coding
tasks must map the deletion tool and pass fresh checks before completion.

`npm run smoke:coding` checks native deletion, denial, mandatory one-use approval,
approval-time changes, protected paths/descendants, links, bounds, cancellation
and partial-result handling using disposable fixtures. Settings migration checks
cover missing grants and normalization of stale Always allow values.
`npm run smoke:coding:deletion:live` exercises the actual loaded model and chat
loop against a disposable file, empty folder and nested tree, preserving a sibling.
The native tools and policy are real; approval UI decisions are synthetic once.
This live scenario passed with the loaded Qwen 3.5 4B model on 2026-10-25.

### UI teaching examples

`src/shared/coding-examples.ts` contains reviewed UI teaching snippets used by the coding guide. These snippets are included in the app; no external example directory is read at runtime.

The snapshots cover semantic design tokens, responsive layout, control states,
accessible forms, immutable state, validated browser persistence and safe DOM
text rendering. React form/state adaptations use JSX and functional state updates;
imperative DOM/HTML snippets are excluded when React/Next.js is detected. A pure
retriever chooses at most two matching examples within 1,800 characters and the
combined 6,500-character guide budget. It emits nothing for unrelated tasks,
insufficient remaining space or an explicitly incompatible language. The guide
and examples are rebuilt from the current request/checkpoint after compaction.

Example style choices are guidance: existing project conventions take priority.
Function length, nesting and state management should follow the framework and
project rather than fixed limits in an example. The visual
guide adds hierarchy, primary actions, consistent spacing/type scales, content
grouping and meaningful interaction states, with observed desktop/mobile previews
when supported. Examples should support the requested interface and its existing conventions.

Regression checks execute the adapted storage snippet against malformed JSON, invalid item shapes, normal round trips and quota failures. These checks cover behavior; they do not establish a visual quality score or a general model autonomy improvement.

## Execution limits

Specialists currently run **sequentially on the selected model** and do not edit
project files. Researcher can use enabled web tools; other specialists have no
tools. Consultations use the same context-dependent limits as other assistant tasks
and share the total model-call budget, preserving a final coordinator response.
Parallel coding workers and automatic registry installation are not available.
Approved project commands and non-npm toolchains use `run_command`; npm tasks use
`run_npm`. Both retain command approval and cancellation.

An optional review uses only the evidence supplied by the coordinator. It is
not an independent verifier. Project discovery, documentation relevance and
assessment of reviewer suggestions still depend on the model. Host checks
establish observed outcomes, not complete semantic correctness. Passing npm
scripts establishes only what those scripts test.

Run `npm run smoke:coding:harness` for deterministic orchestration, persistence,
compaction, approval and lifecycle checks. `smoke:workflow`, `smoke:coding`,
`smoke:harness`, `smoke:specialists` and `smoke:security` cover the underlying
verification, native tools, procedural store and permission boundaries. These
fixtures do not measure coding quality on a live model.
