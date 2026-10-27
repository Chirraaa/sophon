# Sophon's memory and working environment

This harness teaches the model through compact instructions and retrieved reference notes. It does not train weights, run an embedding model, or invoke a model in the background. You can configure and teach it while the model is offline.

## Start using it

1. In **Settings → Model → Context window**, enter the context size actually configured in your local server. The initial value is 16,384; Sophon cannot discover your model's loaded context allocation reliably. Reply limits are capped at one third of this window. Long visual requests need more room than ordinary chat.
2. In **Settings → Memory**, save one useful fact, preference, procedure, or task note at a time. Use a specific title. Set its scope to all private chats, the current working folder, or the current conversation.
3. Start with a few high-value entries. For example, a global preference could say “When teaching me code, give a small example and explain unfamiliar terms.” A project procedure could name the actual test command and the README where it was verified. A chat task note could hold the current goal, constraints, decisions, and next step.
4. For a correction, edit the existing entry. Identical saves are deduplicated; conflicting entries with the same title and scope require editing the original. Prefer explicit updates over accumulating contradictory notes.
5. Open **Context used** below a reply to see selected memory titles, guides, estimated input/output budgets, and how many retained exchanges were omitted for space.

Memories remain until deleted. Clearing, deleting, or expiring a chat also removes its chat-scoped notes. Global and folder-scoped notes have independent lifetimes. Disabling recall leaves entries stored. Entries from another folder/chat can be inspected and deleted, but edits require returning to their original scope. Research mode cannot save memories and never injects private memories, private history, or custom private instructions into model requests.

## What goes into a request

| Layer                            | Purpose                                                                                     | Selection / bound                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Core instructions                | Understand the goal, act within available capabilities, inspect results, verify and explain | Always present in private tasks; Public research has its own restricted instructions           |
| Built-in guides                  | Coding, research, desktop operations, teaching                                              | At most two, selected deterministically from the request and task mode                         |
| Saved reference notes            | Explicit user preferences, facts, procedures, task handoffs                                 | Local keyword ranking, exact scope matching, default 600 estimated tokens, at most six entries |
| Recent exchanges                 | Local conversation continuity and tool evidence                                             | Existing recent-exchange limit, then whole-turn eviction to fit the token budget               |
| Current request and actions      | What the user is doing now, attachments, and active tool results                            | Kept intact; an oversized request stops with an actionable error                               |
| Tool schemas and reply allowance | Available actions and space to answer                                                       | Included in the budget; schemas continue to follow mode and permission policy                  |

The immediately preceding exchange has priority over optional saved recall if it fits. Pinned notes rank first, then matching titles/content, preferences and current-chat task notes. Pinning does not bypass context limits. Older history stays a contiguous suffix: no missing middle exchanges and no tool result detached from its call. The original conversation display is not shortened by prompt eviction.

Text cost is estimated from UTF-8 bytes (three bytes per token), with message framing, tool schemas, and a 2,048-token allowance per image. The harness reserves 20% of the configured window (at least 256 tokens) for estimation and template overhead. These are **estimates**, not a guarantee for every tokenizer or vision encoder. Very small windows, long custom instructions, large attachments, many images, or large active tool results may still need a shorter request or a larger server allocation. The final transport also checks correction calls before sending. No silent truncation of the current question or tool results is used to make a request fit.

## Teaching useful behavior

### Persistent Windows awareness

Every primary model step now receives a fresh, application-owned environment summary after the persona and task guidance. It identifies Sophon as a Windows desktop app and lists only the actual tool schemas available for the current request. Custom personas and older chat claims cannot remove this summary. It contains no automatically captured windows, screenshots or private paths.

Offline chat explains how to switch to **Desktop task** for PC actions. Desktop mode identifies supported actions and current limits; research stays isolated. The app currently launches Calculator, Notepad and Paint, inspects/manages windows, captures screenshots and uses scoped file tools. General clicks/typing, shell execution, arbitrary launch targets and system administration remain unavailable. Awareness does not create missing capabilities.

For a narrow direct request such as “Open Notepad,” an incorrect generic desktop-capability denial can trigger one correction call before any tool executes. It requires an available matching tool, remaining step budget, and enough context space. Corrected calls pass through normal argument validation and approvals. It does not retry denied/failed actions, capability-only questions, quoted examples or unsupported operations. The detector currently handles common English phrasings; live model testing is still needed. `npm run smoke:capabilities` tests this behavior with fixtures and no desktop interaction.

### Task state and checked outcomes

An application-owned controller tracks inspect, act, verify and respond phases. It records the original request, next-step guidance, and up to 16 action results in the existing encrypted conversation record. Each result has an action/run identity, target, time and status: observed data, reported success, independently checked result, denied, failed or uncertain. A pending action is persisted before execution; interruption leaves it uncertain instead of inventing success. Denied, failed or uncertain results stop the current action batch.

Open **Task evidence** below a reply to inspect those records. For the latest interrupted task or a task needing review, **Continue task** sends an explicit resume request. Resume restores the original goal only in the same mode and working folder, even with recent history set to zero. A blocked task is not automatically resumed. Old evidence is historical, and approvals are never reused. Clearing the conversation removes its checkpoint. Public research never resumes a private checkpoint.

The model receives only the last three compact evidence summaries, an omitted-entry count, and the original goal on resume; this context uses the normal token budget and an untrusted-data envelope. Checkpoints do not preserve prior attachment contents, screenshots or full tool output independently of history. The assistant must inspect again when those details or current desktop state matter. This is task continuity, not automatic extraction of model assertions into permanent memories.

File creation now reads back the approved file and compares its exact bytes. Window movement checks the resulting position/state, and focusing already checks the foreground window. App launch remains launcher-reported; sending a close request does not establish that the window closed. These checks establish individual tool outcomes at a moment in time, not whether an arbitrary user goal is fully satisfied.

A narrow English completion detector catches some unsupported claims about opening apps, saving files and changing windows. It permits one correction within the existing step budget, then returns an explicit unverified result if needed. It is not a general truth checker and does not cover every phrasing or language. No extra model runs happen in the background.

### Next improvements, in priority order

1. **Real-model evaluations:** repeat tasks for tool selection, unsupported actions, recovery, multi-step completion, memory corrections and context pressure. Measure improvements before expanding the instruction set or changing the model.
2. **Broader application coverage:** bounded Windows UI Automation inspection and named control actions are now implemented, including field replacement with readback, selection, toggle, expansion, scrolling and reported invocation. See [DESKTOP_INTERACTIONS.md](DESKTOP_INTERACTIONS.md) for enabling them and the WPF fixture evidence. Next, evaluate the actual apps you use; provider coverage and writable text fields vary. General pointer/keyboard automation remains unavailable.
3. **Short app workflows:** load only the workflow relevant to the current target, with a few steps and a clear success check. Avoid making the model improvise every interaction from scratch.
4. **Evidence-based learning:** propose reusable lessons after verified outcomes, let the user review them, and track applicability and correction instead of automatically trusting model assertions.

Use **Behavior** for short instructions that must apply to every private task. Use **Memory → Procedure** for a workflow relevant to a specific topic or project. Instructions never grant tool permissions. A good procedure describes a trigger, a few actions, and a verification step:

> Title: Parser changes and tests  
> Scope: current working folder; Kind: Procedure  
> For parser changes, read the parser and its existing fixtures first. Preserve the input/output contract. Add a regression case for the failing input and run the documented test command. Report any checks that could not be run. Source: this project's README; replace this example with your actual command.

For long tasks, keep a concise **Task notes** entry scoped to the conversation:

> Goal: …  
> Constraints: …  
> Verified decisions and evidence: …  
> Open question: …  
> Next step: …

Task notes are user-maintained checkpoints. Sophon does not automatically summarize or promote model assertions into durable facts. Saying “remember this” in chat alone does not save it. Copy the useful fact into Memory and save it explicitly. Avoid raw transcripts, full files, temporary search snippets, passwords, keys, and speculative conclusions. Titles should share meaningful vocabulary with the requests where you need recall; this first version uses lexical retrieval, not semantic embeddings.

The built-in coding guide teaches inspection, focused changes, existing conventions, input validation, and honest test reporting. It also states current tool limits: there is no general shell, patch tool, or source-code editor; approved file creation remains limited to new `.txt`, `.md`, and `.csv` documents. The harness can explain code and propose patches in chat. Adding real coding execution would require a separate tool implementation.

The research guide asks for current verification of changing or uncertain facts, explicit searches, and citations. In Public research it uses the existing approved `web_search` tool and exact returned URLs. Search results are snippets; page fetching is not implemented. In other modes, the guide tells the model to explain that current verification needs Public research. Stable explanations do not require a search.

## Persistence and extension points

- `src/main/memory/records.ts`: validation, scope matching, deterministic relevance ranking.
- `src/main/memory/store.ts`: versioned `memories.json` in Electron's user-data directory; existing OS-protected AES-GCM storage and atomic writes. At most 200 entries, 80 characters per title and 1,200 per body. Failed reads/writes preserve the existing data.
- `src/main/llm/playbooks.ts`: compact core workflow and bundled guides. Extend these with concrete triggers and short procedures. Routing is heuristic (currently English plus common French terms); unrelated or differently phrased requests may not select the intended guide.
- `src/main/llm/context.ts`: budget, selective recall, whole-turn eviction and diagnostic report. Saved notes use the same untrusted-data envelope as other reference material; they are never system messages or permission grants.
- `src/main/llm/chat.ts` and `client.ts`: integration into every primary model step and final transport bounds.
- `src/main/workflow`: bounded task checkpoints, result classification and completion-claim checks. Native outcome checks live beside the relevant tools; conversation storage persists checkpoints.
- Memory IPC is explicit and validated. Models and tools have no memory-write endpoint. The settings editor uses the trusted application bridge.

## Verification without loading a model

`npm run smoke:memory` covers persistence across store reload, correction/deduplication, malformed data, failed writes, scope isolation, chat cleanup, injection envelopes, history/tool-pair preservation, context limits, private/research separation, disabled recall, and rejection before network activity. The model and storage edges are fixtures; the context assembler and chat loop are real application code.

`npm run smoke:workflow` checks result classification, stopping after denied/failed/uncertain actions, unsupported completion repair, exact goal preservation, scoped resume with zero history, interruption/reload, bounded evidence and research isolation. It also exercises the real file/window validators against controlled filesystem and native API fixtures; it does not move real windows.

After `npm run build`, `npm run smoke:memory:electron` exercises the real settings UI, IPC, Windows-encrypted persistence, renderer reload, task-note cleanup, context inspector, Task evidence panel, interrupted-task resume with zero history, checkpoint clearing and research isolation in a hidden app with a fresh profile. Its HTTP transport returns fixtures without sockets or a model. Screenshots go to `.cache/memory-review`.

Also run `npm run typecheck`, `npm run lint`, `npm run smoke:security`, and `npm run smoke:visual-replies` for integration regressions. No test here establishes the real local model's behavioral reliability. When it is available, evaluate simple fact recall, corrections, unrelated-project isolation, tool selection, honest failure handling, and task resumption against actual responses before expanding the tool set.

The design adapts the public pattern of reusable workflow guidance around tools from [OpenAI's skills documentation](https://developers.openai.com/plugins/concepts/skills) and selective context/compaction practices from the [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide). Sophon's deterministic selection and explicit teaching are local design choices for a smaller model; this is not a reproduction of Codex's internals.
