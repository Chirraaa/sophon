# App interaction routes

Sophon prefers a matching connected app/API tool, then browser DOM, Windows
accessibility, and screenshot-directed input. This is not a mandatory sequence
of four probes. The model chooses from permitted capabilities, respecting an
explicitly requested app and account. A denial stops the operation; uncertainty
requires inspecting the original target before a retry or route change.

## Connected app tools

App APIs are exposed through the existing MCP connection system in Settings >
Plugins. No service is assumed connected or authenticated. `plugins_list` accepts
an optional literal app/capability query and includes up to eight matching cached
tool descriptions for each enabled connection. `mcp_catalog` accepts a tool query
and returns exact schemas with pagination. These discovery operations do not
connect servers or execute service actions. Related schemas stay loaded so a
discovered operation does not require repeated tool-instruction discovery.

Calls retain existing schema validation, connection binding, per-operation
approval and untrusted-result handling. An MCP success reports the service's
response; the model must assess whether it establishes the requested effect.
This does not add a Discord user-account API or invent a connector.

Validation: `node scripts/smoke-app-routing.cjs` and `npm run smoke:plugins`.

## Browser DOM

`browser_open` launches installed Edge (default) or Chrome with a dedicated
profile under Sophon's user-data directory. Cookies persist in that profile;
the user signs in in the visible browser. This does not attach to a regular
browser or Discord desktop, import cookies, or install a browser. Explicit
account/session requests must be respected before using this separate profile.
`browser_tabs` discovers only these managed tabs, with new references per task.

`browser_inspect` returns bounded visible main-frame controls and text, including
labels, editable values, actions and truncation. Password/file controls are
excluded. Frames are counted but not traversed. `browser_act` clicks, fills,
checks, selects, or presses Enter on an exact inspected node. A field fill does
not submit; a click or Enter can. Navigation and actions invalidate references;
changed field values are rejected before dispatch. The browser retains normal
actionability checks, so an obscured button is not forcibly clicked.

When browser inspection is Always allow, an action includes fresh DOM evidence
without another model call. Ask first or Block never grants implicit read-back.
The result reports accepted input rather than claiming the user's goal is
verified. Cancellation closes the controlled tab to terminate pending input;
other tabs remain open. Downloads are cancelled and modal decisions are left to
the user. App exit closes the managed sessions. No arbitrary JavaScript,
debugging endpoint, cookie, or file-upload tool is exposed.

Permissions appear in Settings > Permissions > Browser interaction. Existing
profiles keep new tools blocked until the user changes those grants. Browser
interaction is separate from public research and has its own permissions.

Validation: `npm run smoke:browser` (offline contracts) and
`npm run smoke:browser:native` (real headless Edge against a localhost fixture
and disposable profile). These do not establish compatibility with every web
app or Discord account.

## Windows accessibility

The existing `inspect_app` / `act_on_control` route uses Windows UI Automation.
Inspection now caches common element properties in one provider request per
element, and refreshes the chosen element immediately before an action. It
retains process/window binding, stale-value rejection and password exclusion.

An overview scans at most 240 nodes. A focused query or paged inspection scans
at most 1200, still within the worker's existing time limit and depth 24. Results
include explicit diagnostics and a `nextOffset` when a page is truncated. The
offset counts controls actually returned to the model, including the host's
character cap. Pages read current state, so they are not stable cursors through
a changing UI. Narrow queries are preferable. A lack of controls can reflect
the app's accessibility provider; it does not establish that the UI is empty.

`act_on_control` accepts `readback_query` (empty for an overview). After a
reported/verified action, it returns a fresh inspection only when `inspect_app`
is already Always allow. Other grants remain unchanged. Fresh references are
registered in the action ledger, and superseded trees are compacted without
discarding the original action evidence. Existing bounded recovery handles
uncertain actions separately. Read-back itself is not proof of the full goal.

Validation: `npm run smoke:controls`, `npm run smoke:controls:native`,
`node scripts/smoke-action-outcomes.cjs`, and `npm run smoke:screen`.
