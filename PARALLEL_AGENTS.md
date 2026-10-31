# Parallel agents

Runtime ownership and execution flow are defined in [Runtime architecture](ARCHITECTURE.md).
This document describes how one assistant runtime runs several tasks at once.

Sophon can work on several things at the same time. A chat's own task is agent **main**.
Agents it starts, or that start because the user wrote to a busy chat, are **a1**, **a2**, …
Each agent runs the same assistant loop as main, with the same tools, permissions and
approvals, in its own thread that the user can open. Agents can message each other, and
each agent that uses the desktop has its own labelled cursor.

## Runs

`security/run-manager.ts` holds up to **Settings → Behavior → Parallel agents → Tasks at
once** runs (1–6, default 3; off means 1). Every run carries an agent identity (handle,
title, colour, chat, depth and kind). `currentRun()` is scoped with `AsyncLocalStorage`: the
session starts each task inside `withRun`, so tools, model calls and approvals always act for
the run whose call chain they belong to. Code outside any run's chain sees the single active
run, or none when several are active. Plugin and settings handlers that must not run during
a task ask `anyRunActive()`.

Each run keeps its own screenshot, window references, accessibility observations, browser
references and `clear_chat` request; finishing a run drops them (`onRunFinished`). One run
cannot act on another run's observation. Stop on a chat stops its task and all of its
agents; Stop in an agent's thread stops only that agent; a policy change stops every run.

## Agent threads

An agent thread is a conversation with `parentId` set to its top-level chat and an `agent`
record (handle, title, colour, kind, task, status, who started it, result). Threads are saved
with the conversation index, stay out of the sidebar, are deleted and cleared with their chat,
and load as stopped if Sophon closed while they ran. Each agent also has a card in its chat:
live progress while it works, its answer when it finishes. When an agent finishes, its task
and answer are added to the chat's history so later turns know what happened.

## A message to a busy chat

| Route (composer, per message; default in Settings) | What happens                                                  |
| -------------------------------------------------- | ------------------------------------------------------------- |
| **Auto**                                           | A short-lived **router** agent decides what the message is.   |
| **Add to task**                                    | Queued for the running task, which reads it at its next step. |
| **New agent**                                      | A **worker** agent starts with the message as its task.       |

The router sees the chat's running agents in its run state. If the message changes or asks
about one of their tasks, it sends the change with `message_agent` (await reply), tells the
user what it passed on and the reply, and finishes. If the message asks to stop something, it
uses `stop_agent`. A new, independent request it does itself; a quick question it answers.
If the agent it relays to has already finished, the message is not delivered and the router
makes the change itself.

Other rules:

- A message typed in an agent's own thread always goes to that agent.
- When no more tasks may start, the message is added to the running task instead.
- Voice input follows the same routes; the default applies.
- With parallel agents off, a busy chat queues messages exactly as before.

## Agent tools

These coordinator tools are pinned while available and never touch the desktop or files.

| Tool            | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `spawn_agent`   | Start a worker for one independent part, with a title and a self-contained task.        |
| `message_agent` | Send a message to another agent of the chat; optionally wait up to 300 s for its reply. |
| `check_agents`  | Status, current activity and results; optionally wait up to 600 s for them to finish.   |
| `stop_agent`    | Stop another agent of the chat (never main or itself).                                  |

A run at depth 2 (an agent started by an agent) cannot start more. A running agent reads
messages at its next step, framed as coming from another agent, not the user. A reply to an
agent that is waiting is handed to it directly. Up to eight unread messages wait per thread.
Messages to a finished agent are not delivered; late ones are marked unread rather than
starting a new task. Results are bounded and wrapped as untrusted data. Agent tools do not
count against the action budget; the agents' own actions count against their own budgets.

## Sharing the desktop

Windows has one pointer, one keyboard focus and one foreground window, so physical input
cannot happen at the same time. `desktop/arbiter.ts` shares it:

- **Input turns.** Each input action (click, keys, text, scroll, mouse movement, a batch,
  focusing, moving or closing a window, opening an app) holds a short lease, granted first
  come, first served. The settled screenshot after input is taken inside the same turn. A
  waiting agent's action shows who holds the desktop.
- **Window claims.** An agent that acts in a window keeps it until it has been idle for
  30 seconds or finishes. Another agent's input to that window waits up to 20 seconds, then
  returns `window-busy` with nothing sent and suggests waiting, messaging or another window.
- **Parallel paths.** Accessibility actions (`act_on_control`) only claim their window and
  need no turn; screenshots and inspections need neither. Agents working in different apps
  through accessibility really run at the same time.

Approvals are answered per action. An approval waiting in an agent's thread also appears in
its chat and in the shortcut window, labelled with the agent, one at a time.

## Cursors and pointer movement

`desktop/cursors.ts` draws each agent's cursor (arrow, colour and title label) on one
transparent, click-through, capture-excluded overlay per monitor. Labels are passed as data
and rendered as text. A cursor glides to where its agent acts, shows a ripple on clicks, dots
while typing, dims while waiting for its turn and fades out when the agent finishes. For
accessibility actions the cursor moves to the control without touching the real pointer.
Overlays are not shown on a monitor running an exclusive fullscreen game, follow reduced
motion, and can be switched off.

The real pointer now travels to clicks and scrolls along the same eased, slightly curved
path (`shared/pointer-path.ts`): about 160–480 ms depending on distance (Natural), about
half that (Fast), or an immediate jump (Instant). Every step checks Stop and the window.

## Faster settling and screenshots

On the development machine, every Electron monitor capture costs about 295 ms whatever its
size, while copying a window's rectangle from the screen with GDI takes about 3 ms.

- **Settling after input.** `settle()` waits for the window to stop changing before the result
  screenshot. It now samples just the window's rectangle (2.6 ms per probe, against 295 ms for
  the previous monitor thumbnail), starts after 80 ms instead of 100 ms, polls every 40 ms and
  requires two still intervals in a row. The earliest settle drops from about 750 ms to about
  170 ms; windows that never settle still stop at about one second. If sampling is unavailable
  it uses the previous probe.
- **Screenshots.** A windowed app that nothing covers is copied straight from the screen at full
  resolution (2.8 ms against 295 ms). Fullscreen and borderless apps, which can present outside
  desktop composition, covered windows, monitor captures and a copy that comes back blank still
  use the monitor capture.

Together this saves roughly a second on each input action that returns a screenshot, and about
0.3 s on each `look_at_screen` of an uncovered window. Timings depend on the machine and the
number of monitors.

## Validation

- `npm run smoke:agents` (offline suite): scoped concurrent runs, limits and stops; input
  turns, window claims, nesting and stop while waiting; pointer paths; cursor overlays; and the
  session flow — router relay with the main task's reply, parallel worker, spawned agent with
  `check_agents`, add-to-task, agent thread messages and stop, the off switch, chat-wide stop
  and deletion. The model is scripted.
- `npm run smoke:agents:native`: on the real desktop, without a model or pointer movement, the
  window sampler and direct copy read real pixels, the direct copy matches the monitor capture,
  the cursor overlay draws, neither copy nor capture includes it, and both probes are timed.
- `npm run smoke:agents:ui` (after a build): agent strip, live and finished cards, relayed
  message, cross-thread approval, route choice and agent thread in both windows.

Not yet established: live behaviour with a real model and real apps (how reliably a given
model routes, relays and parallelises), and end-to-end task time. A local model server
with one slot answers parallel agents' requests in turn. Switching focus between agents takes
a borderless game out of the foreground while another agent types elsewhere.
