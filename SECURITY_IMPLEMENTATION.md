# Security implementation record

Exa search update (2026-10-24): the search broker now supports Exa's keyless hosted MCP endpoint at `https://mcp.exa.ai/mcp`. This fixed adapter permits only `tools/call` → `web_search_exa`; it has no discovery or general MCP tool execution. It sends the approved query only to the selected provider, pins public DNS to the socket, blocks redirects/credentials/cookies, and bounds JSON/SSE replies to 2 MB and 15 seconds. Exa is the default only for new profiles; existing provider selections and permissions are preserved. Switching an enabled profile still uses the existing consent flow. Live search via the actual adapter returned five public sources for the test query; this establishes current connectivity, not unlimited availability or source correctness. Free-tier failures remain possible.

Current agent/confirmation update (2026-10-24): four bounded specialist profiles now share the local model and task budget. Only Researcher receives enabled public web tools, through the existing permission broker; all other specialist tools and recursive delegation are rejected. Handoffs remain untrusted. Security confirmations use the shared shadcn AlertDialog and buttons inside the existing application window; no extra BrowserWindow, preload or renderer page is created. The main process retains the immutable request and one-use ID. The narrow consent IPC checks the trusted main frame and exact owning window, rejects stale/replayed IDs, and never accepts replacement settings from the renderer. Escape, timeout, owner hide/reload/crash and destruction deny. Settings compare the approved before/after snapshots before committing. This supersedes the earlier separate confirmation-window design and native message-box requirements. The main app renderer now displays and resolves confirmations; it remains an application trust boundary, and this does not protect against a compromised main app renderer.

Web availability update: CAPTCHA, rate limits and recognized transport failures after approval return `Web unavailable` and failed evidence, rather than a user-denial result. The selected search provider is disabled for the remainder of that request after a failure; there is no automatic provider switch. Main and Researcher loops can read an enabled public source or explain the verification limit. Remaining calls in the failed batch are skipped. Actual permission denial, Stop, revocation and non-public-destination rejection still stop the task.

Current web update (2026-10-24): the earlier closed page-retrieval gate below is superseded by the bounded public HTTPS reader described in [the web foundation and specialist proposal](AGENT_SYSTEM_DESIGN.md). Web access is opt-in in the shared assistant chat, with independent search/page permissions. DuckDuckGo HTML search is a best-effort keyless option; Brave API remains available independently of the browser. Page retrieval has DNS/socket pinning, redirect validation, cancellation, MIME and byte limits, and non-executing parse5 extraction. Browser profiles, authenticated browsing, scripts and downloads remain unavailable. `smoke:web` covers these restrictions with fixtures; a live public page read passed, while live DuckDuckGo returned an HTTP 202 challenge. This does not establish general search availability or local-model tool-selection quality.

Implemented on 2026-10-23 against the audit's reviewed revision. This historical record distinguishes code and test evidence from release approval. See the README and current source for subsequent behavior changes; reproducible security checks remain in `scripts/security` and `scripts/smoke-security.cjs`.

## What is available

| Mode | Context and authority |

| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Offline chat (default) | Exact loopback model service. No model tools. User-selected attachments are allowed. |

| Local desktop task | A separate conversation. Every tool requires an exact one-use approval. No search. Limited app launching, approved window operations, and scoped workspace documents. |

| Public research | Disabled by default. Each question uses a fresh model context, without history, custom private system prompts, attachments, voice, screenshots, or local tools. Only the fixed Brave Search API adapter is available. Every outgoing query requires approval. |

Changing mode creates a new conversation. Selecting or creating another chat cancels the running task. A blocked or denied action ends that task; there is no automatic alternative route.

Host clicks, typing, key presses, scrolling, bulk app closure, model-directed monitor capture, arbitrary executable launch, overwriting documents, remote inference, page retrieval, and browser/account automation are closed. A Settings permission cannot override these restrictions.

App launching is limited to absolute Windows System32 paths for Calculator, Notepad, and Paint. This release does not offer a general shell, Start-menu search, URI launcher, or PATH-based fallback.

## Implemented boundaries

- **IPC and renderers:** the generic toolkit bridge and environment exposure were removed. All incoming IPC routes have a registered runtime contract, owned-window/main-frame/exact-document validation, argument limits and rate limits. Both windows explicitly enable sandboxing, context isolation, and web security and disable Node integration, webviews, insecure content, downloads, popups, and unsolicited navigation. Production assets are served through a path-contained application scheme with a restrictive CSP. Chromium network enforcement has one production owner; test observers no longer replace it.

- **Task authorization:** trusted code fixes the mode, inference destination, workspace, task ID, policy revision, and cancellation signal. Tool schemas are filtered by mode, but execution independently checks policy again. Unknown tools and missing/invalid permissions fail closed. The original broad grants migrate to approval-required settings.

- **Tool contracts:** the entire tool batch is validated before the first action. Invalid JSON, arrays/null instead of objects, unknown fields, nested extras, invalid enums, missing fields, excessive values, duplicate call IDs, and oversized batches cause no action. The wording heuristic and forced-tool retry were removed.

- **Approvals:** main-owned canonical arguments, recipient, task, exact destination, file content and window identity appear in a scrollable preview. Approvals are once only, expire after 90 seconds, cannot be replayed, and are revoked by Stop, chat changes, or security settings changes. Policy and targets are revalidated before execution. Host input and overwrites remain closed instead of offering incomplete click previews or diffs.

- **Cancellation and limits:** Stop aborts inference, DNS/network requests, and approval waits. The active run remains owned until cleanup completes. There are at most ten tool proposals per task, three per model reply, three searches, 15 seconds per search request, and a 180-second overall deadline. The executor waits for real completion instead of detaching a promise after a timeout. Cancellation is checked after asynchronous native-tool preparation. An OS operation already submitted before Stop can finish; Stop is not rollback.

- **Workspace access:** traversal, absolute/device/UNC/ADS forms, sensitive/configuration paths, junctions, symbolic links, and hard links are rejected. Actual Windows handles retain directory ancestors without delete sharing during file operations; file identity and final handle paths are checked. Reads use the approved file ID and modification time. Atomic new-file creation is restricted to `.txt`, `.md`, and `.csv`. There is no overwrite fallback. These controls do not classify every possible secret in an otherwise approved document.

- **Inference transport:** the endpoint is restricted to exact loopback hosts ending in `/v1`, with `localhost` pinned to numeric loopback. Credentials in URLs, queries, fragments, arbitrary paths, remote hosts, and redirects are rejected. Node service requests use bounded JSON responses, no ambient cookies/referrer/proxy credentials, no response compression, no connection reuse, connection deadlines and abort signals. The running LM Studio listener was observed on `127.0.0.1:1234`; its runtime was not reconfigured.

- **Search:** the adapter owns the HTTPS origin, method, API path, authentication header and result cap. It validates all resolved provider addresses and pins an approved address to the actual TLS socket while retaining hostname verification. Public/private mixed DNS answers fail closed. Response headers and streamed bodies are bounded; redirects, compression, unexpected MIME and oversized responses are rejected. Results have main-issued task/source IDs, timestamps, validated display URLs and untrusted provenance. Trusted source cards are separate from model-written citation text. Result URLs are never fetched or automatically opened.

- **Credentials:** the Brave key is encrypted with Electron safeStorage and never returned after entry. Storage fails closed when OS encryption is unavailable. Deletion and rotation revoke the current task. Encryption does not protect a key from an already-compromised same-user main process.

- **Privacy:** security events contain fixed decision fields, not arguments, queries, complete URLs, content or keys. Logs have a seven-day age limit and approximately 1 MiB per day, with a deletion control in Settings. Chat expiry is user-selected; existing chats are retained by default. Deleting/clearing a chat removes its unshared attachment bytes. Shared attachments are preserved; discarded drafts expire after 24 hours. No diagnostics are uploaded. Conversations, attachment bytes and attachment metadata use authenticated AES-256-GCM storage with an OS-protected key; startup migrates existing files. Missing keys or authentication failures stop startup and preserve existing data. This does not erase old filesystem backups or protect data from a compromised same-user process.

- **Voice:** the local CPU executable, all shipped DLLs and base model have a reviewed hash manifest bundled in the protected ASAR. Files remain locked against mutation from verification through process exit. The established socket must belong to the verified child PID before any HTTP headers/audio are sent. Arbitrary replacement programs/models and unexpected DLLs are rejected. Child environment inheritance is narrowed and health/transcription redirects are rejected. Setup checks the clean source cache against the reviewed v1.9.5 commit. Whisper process-tree/job isolation and independently reproducible release builds remain further work.

- **Visuals:** HTML/SVG execution requires Run visual and native confirmation; research code fences stay inert and cannot offer follow-up actions. Opaque iframe/CSP isolation and explicit follow-up sending remain for approved local visuals. Chromium additionally has resolver denial, a fixed deny proxy without a direct fallback, disabled QUIC and restricted WebRTC. Image decoding and Mermaid rendering use disposable bridge-free sandboxed renderers with Windows job limits. Site isolation is enabled and the built-app test verifies a distinct renderer process after the visual document commits. Message floods and string sizes are limited. A Stop visual control removes its frame. Active HTML export requires an explicit warning/confirmation. Parser workers have 384 MiB process memory, 15 seconds user CPU and a 20-second wall deadline, with eight queued requests maximum. Interactive visual frames have no separate hard CPU/GPU/memory quota; native parser vulnerabilities still require ongoing dependency maintenance and fuzzing.

- **Packaging:** source/cache/scripts are excluded by an asset allowlist. An exact production-module allowlist admits only @electron-toolkit/utils, koffi and @koromix/koffi-win32-x64; renderer/build packages are development dependencies. The test package's actual fuse bytes are checked: RunAsNode, NODE_OPTIONS, CLI inspection and extra file-protocol privileges are off; cookie encryption, embedded ASAR integrity and ASAR-only loading are on. Packaged code/CSP and native hashes must match the checked build. `build:win` now requires code signing; unsigned local test packaging remains available separately.

## How to use it

1. Restart the app from the updated source/build. New and migrated chats use Offline chat. Conversations created with an explicit mode in this version retain that mode.

2. For local work, choose **Local desktop task** above the composer. Select a dedicated scratch workspace in Settings → Files and inspect each approval preview.

3. To configure research, add your own **Brave Search API** key in Settings → Model → Public research, then explicitly enable research. Select **Public research** above the composer and submit a public question. Each exact query shows its recipient before sending. Search is limited to snippets and citations.

4. Stop cancels the current task and pending approvals. Changing settings that affect authority also cancels it.

5. Voice uses the bundled verified CPU build and multilingual base model. A different compiler/build produces a candidate manifest and stops setup before replacing voice resources. Review build provenance and deliberately update src/main/voice/manifest.json before rebuilding a signed release. Never accept hashes automatically.

No production search key was available during implementation. Provider behavior was checked with documented request contracts and deterministic transport fixtures; no live paid search, provider retention audit, or account configuration is claimed.

## Verification

| Check | Evidence |

| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| TypeScript, lint and production build | `npm run build`, `npm run lint` |

| Adversarial application boundaries | `npm run smoke:security`: strict envelopes/batches, mode matrix, approval replay/revocation, Stop, quotas, private context canaries, unsafe file forms, actual Windows locks, changed file identity, key failure/deletion, shared attachment cleanup, pinned native hashes |

| Transport | Real local fixture checks for redirect POST isolation, credential absence, MIME/compression/header/body limits, cancellation and deadline; public-address/DNS fixtures and fixed search origin/key confinement |

| Built Electron | `npm run smoke:security:electron`: both real window preferences, trusted scheme, React mount, real unowned-renderer IPC denial, production CSP, separate visual renderer, encrypted credential roundtrip, isolated mode transition |

| Existing UI regressions | `npm run smoke:desktop`: synthetic model transport, files/approvals, attachment/image/Mermaid rendering, interactive diagrams/charts/calculator, toolkit, visual isolation/export, settings, fake microphone, compact entry and window positioning; passed without renderer errors |

| Visual reply routing | `npm run smoke:visual-replies` |

| Local inference | Earlier implementation returned `4`; supplemental rerun skipped live inference because the configured loopback service was offline |

| Local voice | `npm run smoke:voice`: bundled JFK sample transcribed successfully, no microphone recording |

| Dependencies | `npm audit --json --ignore-scripts`: zero reported advisories, 1,061 dependencies in metadata on 2026-10-23 |

| Test package | `node scripts/security/package.cjs`, then `node scripts/security/verify-package.cjs`; produces `.cache/security-package/security-evidence.json` with executable/ASAR/main/native hashes and fuse bytes |

CycloneDX evidence now includes the lockfile production graph (22 components, including optional binaries for other platforms) at `.cache/security-package/sbom.cdx.json`, and the actual packaged dependency manifests plus the supplied Electron runtime (four components) at `.cache/security-package/sbom-packaged.cdx.json`. The exact package verifier materializes `sbom-input`; run `npm sbom --omit=dev --sbom-format=cyclonedx` there and capture stdout to reproduce the latter. Renderer libraries remain present in bundled assets and are covered by the full dependency audit; a production Node-module SBOM alone is not a complete inventory of renderer code. Native/model hashes are recorded separately in package evidence. Profiles, snapshots and package evidence stay in ignored `.cache/`; desktop tests create a fresh scratch folder outside protected roots and remove it on completion. No existing user chats or documents are used.

## Remaining gates and risk record

### Scoped accessibility addition (2026-10-23)

The desktop interaction implementation adds `inspect_app` and `act_on_control` for named Windows UI Automation controls. It does not enable the existing `click`, `type_text`, `press_keys`, `scroll` or bulk-close handlers. The new capabilities use a fixed bundled PowerShell/.NET program with JSON stdin, a Windows resource-limited job, a ten-second wall deadline and task cancellation. No model text is interpolated into code. Native APIs perform control operations rather than global pointer or keyboard injection.

The main process binds the window/PID and checks protected/blocked rules before preview, approval and dispatch. Inspection/control references are scoped to one task, bounded in number, expire after two minutes and are invalidated after an action. The worker rechecks control identity, bounds, prior field hash and relevant state before invoking a supported pattern. Password controls are skipped. Measurable states are read back; invocation is only reported. New tool grants remain blocked in existing saved profiles until the user enables them; exact renderer review and native confirmation remain required.

`smoke:controls` covers the real approval/binding/dispatch path with native fixtures; `smoke:controls:native` passed real WPF field entry, stale-value rejection, toggle, invocation, password exclusion and cancellation. The hidden built UI check covers the replacement preview. These tests do not establish universal provider compatibility or independent security review. UI Automation providers and app event handlers can have effects beyond the immediate control; invoking an app button can submit data or start another program. The helper is bounded but is not an isolated desktop, and killing it cannot retract a request already accepted by the target app. General host input and isolated browser/account workflows still require the remaining Gate D work below.

These are explicit boundaries, not a declaration that every original finding or release gate is closed.

| Work | Current status / condition before enabling |

| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Gate A: foundation | Core controls tested in built Electron and a test package. No independent security sign-off or exhaustive attack-chain review is claimed. |

| Gate B: controlled search | Implemented, off by default. A deployment owner still needs to choose/verify provider account quotas and privacy terms, supply a key, and test the real provider and effective runtime egress policy. |

| SEC-12 / Gate C: arbitrary page fetching | Not implemented or exposed. Requires a separately restricted parser/retrieval environment, enforcing egress, SSRF/redirect/DNS/socket tests and bounded non-executing parsing. The search URL classifier is not an arbitrary-page broker. |

| Gate D: host input / isolated browser | Global pointer/keyboard injection and a dedicated isolated browser remain unavailable. Scoped UI Automation control actions are now available with exact approvals as described above; they can affect ordinary apps, including browsers, and do not establish isolation of accounts or external effects. General host-input expansion still requires fresh capture binding, concrete click previews, worker-tree cancellation and independent review. |

| Remote inference | Disabled. Requires pinned destination identity, HTTPS, protected credentials, exact disclosure policy and a reviewed grant UI before it can be added. |

| File overwrites / executable writes / arbitrary launch | Disabled. Requires exact diffs/recovery or a separately reviewed capability and target identity. |

| Native/release provenance | Current binary pins detect drift; they are not an independent reproducible build or trusted publisher signature. Test package Authenticode status was **NotSigned**. Signed distribution is blocked by `forceCodeSigning`; certificate/update policy and installer verification remain deployment work. |

| OS/model isolation | The model listener is loopback. No Windows firewall, dedicated service identity, model-server authentication, model-server plugins, or independent LM Studio egress restriction was changed or certified. The app cannot establish these guarantees merely through prompts or Chromium request filtering. |

| Availability and storage | API inputs, responses, counts and deadlines are bounded. Parser workers now have Windows memory/CPU limits and wall deadlines. Hard quotas for active visual/GPU processes, attachment-decoder/diagram fuzzing, total conversation/attachment storage quotas, power-loss/rollback campaigns and exhaustive job-object lifecycle tests remain open. |

Owners for the remaining deployment choices are the deployment/release maintainer. Review before changing a model/provider/runtime, before enabling any gated capability, and before signed distribution. There is no blanket exception allowing a gated feature to run while its required isolation is absent.
