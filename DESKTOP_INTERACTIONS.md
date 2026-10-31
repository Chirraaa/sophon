# Desktop interaction

The four-route app interaction work adds focused/paged accessibility inspection
and optional action read-back. See [App interaction routes](docs/APP_INTERACTION.md)
for current behavior, permission requirements and validation. The historical
implementation records below describe earlier limits and test results.

The shared action ledger now owns live accessibility observation identities and
their expiry. An uncertain action uses the exact inspected window for its bounded
read-back. The chat loop consumes structured outcomes and no longer keeps a
parallel observation map. App text is display evidence, never a trusted status
or window-identity protocol.

Current behavior (2026-10-23): one assistant mode supports desktop actions, conversation, creative work and optional web search. Settings → Permissions offers **Always allow**, **Ask first** and **Block**, with an accepted, styled permission review before persistent grants are saved. Ask first uses a single in-app approval. Changing chats keeps the request running in its original conversation; Stop remains explicit.

Mouse clicks, wheel scrolling, keyboard shortcuts and literal typing are enabled with exact window/process binding. Clicks require a screenshot from the same request, expire after two minutes, and reject moved/resized windows. Screenshots are capped at native size and 1280×960 (1024×768 for the automatic image after input). In browsers and Electron apps, input goes to the window in the background without moving the real pointer (see [Parallel agents](PARALLEL_AGENTS.md#background-input)). Text input is paced for Windows text services and checks focus/cancellation. An editor title changed by Sophon's input can be resolved for the rest of that request only while the exact window/process and observed replacement title still match. Close-window results distinguish verified closure from a remaining save prompt.

Native and live-model checks are available as `npm run smoke:assistant:native` and `npm run smoke:assistant:live` after a build. They use disposable profiles and owned windows. The live check uses a 60,000-token context budget. Evidence lives in `.cache/assistant-native/<timestamp>/report.json`, alongside the ground-truth bitmap and screenshots. See the current verification record at the end of this document.

The following records the original accessibility implementation plan.

Implement a short observe → target → act → check loop, with the model offline during development.

1. **Reliable windows:** publish task-scoped window references, bind actions to the resolved native window, remove arbitrary active-window fallback, and add practical layouts with checked placement.
2. **Screen understanding:** preserve window screenshots and add bounded Windows UI Automation inspection. Return readable names, roles, values and supported actions, with explicit truncation. Avoid a full desktop tree in the context window.
3. **Application controls:** act on a recently inspected control using its recorded identity. Support the control's native patterns for invoke, selection, toggle, expansion, value replacement and scrolling. Verify measurable postconditions; report invocation as unconfirmed until inspected again.
4. **Interaction feedback:** show understandable action previews, retain exact one-use approvals and Stop, and provide specific recovery when a window/control changes.
5. **Validation:** exercise ambiguous windows, expired references, changing controls, password exclusion, cancellation, verification and compact outputs. Test the native accessibility bridge against an isolated fixture app; do not start the model.

The accessibility bridge runs outside Electron's main process with bounded lifetime/output and cancellation. Its fixed application-owned program receives JSON data; no model text becomes executable code. Each control action invalidates its observation and requires a fresh inspection for the next action. UI Automation support depends on the application. Canvas-only controls may need screenshot-directed input. Arbitrary pointer dragging and file relocation remain separate work; no claim of universal app support.

Architecture reference: [Microsoft UI Automation clients](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-clientsoverview) and [control patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview).

## Implemented

- `inspect_app` returns names, roles, short values, supported actions and opaque observation/control references. It works without a vision model when the target exposes Windows accessibility.
- `act_on_control` supports native Invoke, Value, SelectionItem, Toggle, ExpandCollapse and vertical Scroll patterns. Value replacement compares a hash of the entire old value before acting and reads back the new value. Invoking a button is reported, not proof of its broader outcome.
- The worker traverses at most 240 nodes, depth 8, and returns at most 50 controls. Each text preview is 240 characters with truncation indicated; the model-facing control list is capped at about 10,000 characters. Use a literal `query` to narrow the inspected view.
- References belong to one task, expire after two minutes, and are invalidated after a control action or task cancellation. Up to four observations are held in memory. Runtime identity, role, name, automation ID, bounds, value hash and relevant state are rechecked before action. Password controls and their descendants are skipped.
- `list_windows` publishes task-scoped window references. Window move/focus/close/capture and accessibility tools use the resolved native window directly, avoiding duplicate-title retargeting. The active-app fallback no longer picks an arbitrary window.
- Window layouts include thirds and two-thirds. Placement checks allow a short bounded settling period and reject out-of-work-area rectangles. Captures restore hidden Sophon windows without taking focus.
- Approval cards show the app, control, operation and replacement text, with full details expandable. Stop, blocked-app rules and protected-window rules remain enforced. A compact in-app permission review is required when enabling persistent Always allow permissions; the main process holds the exact pending change. Ask first approves individual actions in the app.

## Enable and use

In **Settings → Permissions**, set **Read app controls** and **Use app controls** to **Ask first** or **Always allow**. All chats use these permissions; no mode switch is needed. New installations default to Ask first. Existing saved profiles keep missing tool grants blocked until changed. No existing preferences are silently broadened.

Example: “In the editor, replace the Draft message field with ‘Hello Alex’ and leave it unsubmitted.” Sophon should inspect, identify the field, preview its replacement, perform the approved operation and report its checked result. “Click Apply” should inspect again and target that named control. Ordinary app event handlers may run when a value changes; “does not submit” means the tool does not press Enter or invoke a submit control separately, not a guarantee about app behavior.

For long content, explicitly request replacement rather than appending to a truncated preview. Controls without a writable Value pattern cannot receive text through this tool. The assistant can use enabled window-bound keyboard and screenshot-directed pointer tools as a fallback.

## Verification and limits

The NCS-0007 orchestration regression uses the 2026-10-28 Spotify screenshots:
21 visible actions across two requests, including nine tool-instruction loads,
an uncertain control action that stopped the task, and an expired window target
on continuation. The screenshots do not contain token usage or timings.

The runtime now keeps related desktop tools in a bounded working set, includes
an exact `windowRef` in accessibility results, and can read back an uncertain
control action without asking the model to schedule the inspection. The read-back
uses normal permissions and has a two-attempt limit per run. Earlier control
trees are compacted for inference, and old request references are marked expired.

`smoke:awareness` scripts an analogous Spotify flow in five model calls and five
actions with zero discovery calls, including one automatic read-back. It also
checks denied/failed/empty/wrong-window read-backs, missing targets, policy and
action-budget limits, skipped batch results, bounded recovery and continuation.
`smoke:screen` measures three synthetic accessibility trees: 9,299 estimated
tokens before packing versus 3,887 after (58% less), retaining the latest full
tree and uncertainty evidence. These are deterministic fixture results, not a
live Spotify/model benchmark or a measured end-to-end latency improvement.

For live acceptance on `dev`, repeat the original Spotify request with the same
model and permissions. Check that inspect/action schemas remain available,
read-back continues after an uncertain operation when usable controls exist,
and a final playback claim is supported by observed track/playback state. Record
model calls, input tokens and elapsed time; fixture results do not establish
real-app playback reliability.

`npm run smoke:controls` tests the actual approval → binding → dispatch path with controlled native edges: duplicate titles, changing process/window identities, field previews, denial/native veto, reference expiry/replay, compact outputs, blocked apps and research isolation.

`npm run smoke:controls:native` briefly opens its own WPF fixture and exercises real UI Automation field entry/readback, Unicode/literal text, stale-value rejection, checkbox toggling, selection, expansion/collapse, scrolling, button invocation, password exclusion and cancellation. It closes only its fixture. The model remains offline. The built hidden UI test `npm run smoke:memory:electron` also checks the readable control preview. Empty or non-finite provider rectangles are excluded from inspection.

The WPF fixture passed on the development machine. A Windows Forms fixture exposed only generic window information through this machine's accessibility provider, so broad application compatibility is **not established**. Canvas-rendered apps, custom editors, elevated processes and unusual providers may expose little or no usable control data. There is no general drag-and-drop or file relocation. The bounded worker keeps a hung provider from blocking Electron's main process; cancellation cannot undo an operation an app has already accepted. App controls can cause external effects, under the chosen tool permission.

The 2026-10-23 desktop/model test passed with `qwen3.5-4b@q4_0` and a 60,000-token harness budget. Native tools opened Notepad, typed a test string, independently read back the text, selected/deleted it, verified an empty editor, and closed the window. A fixture window moved by the requested offset and received exactly one real coordinate click. The loaded model independently read **ORION**, **7429**, **3 blue squares** and **2 red circles** from the reference screenshot, moved the fixture, activated its named button with accessibility and observed the counter, then completed the Notepad open/write/delete/close sequence with independent native checks. Evidence: `.cache/assistant-native/1792791764185/`.

Earlier exploratory runs exposed a hidden-launch flag, startup-window races, burst-input loss, Qwen's leading-system-message requirement and Notepad title changes after typing; these paths were corrected. The small model also missed an inferred screenshot-coordinate click and once supplied a position preset as a monitor name. A deterministic native test verifies coordinate mapping; the live button test uses the more reliable named accessibility action. These results do not establish general visual-coordinate accuracy or universal task completion by the model.
