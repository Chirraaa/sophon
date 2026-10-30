const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { load } = require('./security/load.cjs')
let run = {
  id: 'controls-run',
  mode: 'assistant',
  endpoint: 'http://127.0.0.1:1234/v1',
  workspace: '',
  signal: new AbortController().signal,
  tools: 0
}
const runs = {
  currentRun: () => run,
  assertRun: (r) => {
    assert.equal(r, run)
    r.signal.throwIfAborted()
  },
  consumeToolBudget: () => {
    run.tools++
  }
}
let foreground = 0
let pidOffset = 100
let protectedTarget = false
let blocked = false
let rect = { left: 0, top: 0, right: 500, bottom: 400 }
const native = {
  enumTopLevelWindows: () => [1, 2],
  foregroundWindow: () => foreground,
  getProcess: (hwnd) => ({ pid: pidOffset + hwnd, exe: 'fixture.exe' }),
  getTitle: () => 'Same title',
  getVisibleRect: () => rect,
  isCloaked: () => false,
  isMaximized: () => false,
  isMinimized: () => false,
  isToolWindow: () => false,
  isVisible: () => true,
  requestClose: () => true
}
const permissions = {
  protectedWindowRule: () => (protectedTarget ? 'protected' : null),
  blockedAppRule: () => (blocked ? 'blocked' : null),
  toolPermission: (name) => settings.tools[name]
}
const windows = load('src/main/tools/windows.ts', {
  crypto,
  '../security/run-manager': runs,
  '../permissions': permissions,
  './monitors': { monitorsText: () => 'Monitor 1', monitorOf: () => ({ index: 1 }) },
  './window-move': { POSITIONS: ['left_half'] },
  './win32': native
})
const schema = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': windows
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schema })
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const sample = {
  runtime: [42, 1, 9],
  name: 'Draft field',
  automationId: 'draft',
  role: 'Edit',
  enabled: true,
  value: 'Original',
  valueHash: 'hash',
  valueTruncated: false,
  selected: '',
  toggle: '',
  expanded: '',
  vertical: -1,
  bounds: [10, 10, 200, 25],
  actions: ['set_value']
}
let observed = [sample]
let result = { status: 'verified' }
const workerCalls = []
const controls = load('src/main/tools/automation/controls.ts', {
  crypto,
  '../windows': windows,
  '../../security/run-manager': runs,
  '../win32': native,
  '../../llm/untrusted-data': envelope,
  './worker': {
    automationWorker: async (request) => {
      workerCalls.push(request)
      return request.operation === 'inspect'
        ? { status: 'observed', controls: observed, truncated: false }
        : result
    }
  }
})
const local = load('src/main/security/local-action.ts', {
  '../network/search-provider': {},
  '../tools/openApp': {},
  '../tools/windows': windows,
  '../tools/win32': native,
  '../permissions': permissions,
  '../tools/automation/controls': controls,
  '../tools/files': {},
  '../tools/screen': {},
  'fs/promises': {},
  path,
  './run-manager': runs,
  './workspace-policy': {}
})
const registry = load('src/main/tools/registry.ts')
const settings = {
  tools: registry.defaultToolPermissions(),
  model: { endpoint: run.endpoint },
  files: { workspace: '' },
  research: { enabled: false }
}
const policy = load('src/main/security/policy.ts', {
  '../settings': { getSettings: () => settings, settingsRecovery: () => ({ required: false }) },
  '../tools/registry': registry,
  './run-manager': runs
})
let captures = 0,
  invalidatedCaptures = 0,
  markedTargets = null,
  settled = 0,
  captureArgs = null,
  lastCapturedWindow = null
const tools = load('src/main/tools/index.ts', {
  '../settings': { getSettings: () => settings },
  '../harness/store': {},
  '../harness/python': {},
  './wait': load('src/main/tools/wait.ts', {
    'node:timers/promises': require('node:timers/promises'),
    'node:perf_hooks': require('node:perf_hooks'),
    '../security/run-manager': { assertRun: (run) => run.signal.throwIfAborted() }
  }),
  './schemas': schema,
  './files': {
    editWorkspaceFile: async () => {
      throw Object.assign(new Error('No unique match; no write.'), { code: 'PATCH_NOT_APPLIED' })
    }
  },
  './npm': {},
  './command': {},
  '../permissions': permissions,
  '../security/policy': policy,
  '../security/run-manager': runs,
  '../security/tool-contracts': contracts,
  '../network/search-provider': {},
  '../network/public-page': {},
  '../network/public-image': {},
  './openApp': {},
  './app-catalog': {},
  './windows': windows,
  './screen': {
    invalidateScreenCoordinates: () => {
      invalidatedCaptures++
    },
    capturedWindow: () => lastCapturedWindow,
    settle: async (window) => {
      settled++
      assert.equal(window.hwnd, 2)
    },
    captureScreen: async (args, _guard, window) => {
      captures++
      captureArgs = args
      assert.equal(window.hwnd, 2)
      return { text: 'Fresh fixture image', image: 'data:image/png;base64,fixture' }
    },
    markCapture: (targets) => {
      markedTargets = targets
      return { image: 'data:image/jpeg;base64,marked', labels: targets.map((t) => t.label) }
    }
  },
  './interact': {
    clickScreen: async () => 'Clicked left at (1, 1).',
    typeText: async () => 'Typed 2 characters in "Fixture".',
    pressKeys: async () => 'Pressed Enter in "Fixture".'
  },
  './automation/controls': controls
})
let decision = 'once'
let approvalHook = () => {}
const runner = load('src/main/llm/run-tool.ts', {
  '../harness/store': {},
  '../settings': {},
  '../services/screen-glow': { hideScreenGlow: () => {} },
  '../tools': tools,
  '../permissions': {
    toolPermission: () => settings.tools.act_on_control,
    requestApproval: async () => {
      approvalHook()
      return decision
    }
  },
  '../security/policy': policy,
  '../security/run-manager': runs,
  '../security/tool-contracts': contracts,
  '../security/audit': { securityEvent: () => {} },
  '../security/local-action': local
}).runTool
const events = []
const execute = (name, args) =>
  runner(name, args, crypto.randomUUID(), (e) => events.push(e)).then((outcome) => outcome.text)
const unwrap = (text) => JSON.parse(JSON.parse(text).content)
async function main() {
  await assert.rejects(
    tools.executeTool('edit_file', { path: 'fixture.ts', old_text: 'old', new_text: 'new' }, run),
    (error) => error.code === 'PATCH_NOT_APPLIED'
  )
  settings.memory = { enabled: false }
  assert(!tools.activeToolSchemas().some((s) => s.function.name === 'harness_manage'))
  settings.memory.enabled = true
  assert(tools.activeToolSchemas().some((s) => s.function.name === 'harness_manage'))
  settings.memory.enabled = false
  assert.equal(windows.activeWindow(), null, 'Never choose an arbitrary app')
  assert.equal(windows.findWindow('Same title'), null)
  const listing = windows.listWindowsText()
  const refs = listing.match(/win-[\da-f-]{36}/g)
  assert.equal(refs.length, 2)
  assert.equal(windows.findWindow(refs[1]).hwnd, 2)
  foreground = 1
  windows.rememberExternalWindow()
  foreground = 0
  assert.equal(windows.activeWindow().hwnd, 1)
  pidOffset = 200
  assert.equal(windows.activeWindow(), null)
  assert.equal(windows.findWindow(refs[0]), null)
  pidOffset = 100
  const view = unwrap(await execute('inspect_app', { window: refs[1] }))
  assert.equal(workerCalls[0].hwnd, 2, 'Exact duplicate-title window reaches the worker')
  assert.equal(view.controls[0].control, 'c1')
  assert.equal(view.windowRef, refs[1], 'Inspection exposes the same exact window identity')
  assert.match(view.observation, /^obs-[a-f0-9]{12}$/)
  assert.deepEqual(view.windowSize, { width: 500, height: 400 })
  assert.deepEqual(view.controls[0].bounds, { x: 10, y: 10, width: 200, height: 25 })
  const args = {
    observation: view.observation,
    control: 'c1',
    action: 'set_value',
    text: 'New text'
  }
  assert.equal(controls.controlTarget(args, run).window.hwnd, 2)
  assert.throws(
    () => contracts.validateToolArguments('act_on_control', { ...args, action: 'invoke' }),
    /Text/
  )
  assert.throws(
    () => contracts.validateToolArguments('act_on_control', { ...args, text: '\u001b' }),
    /control characters/
  )
  contracts.validateToolArguments('act_on_control', { ...args, text: '' })
  const callsBeforeDenial = workerCalls.length
  assert.equal(windows.findWindow(refs[1] + ' "Same title"').hwnd, 2)
  assert.equal(windows.findWindow(refs[1] + ' "Same title" ' + refs[0]), null)
  assert.match(await execute('inspect_app', { window: 'Same title' }), /^Target not found:/)
  assert.equal(
    workerCalls.length,
    callsBeforeDenial,
    'Ambiguous targets never reach native automation'
  )
  decision = 'deny'
  assert.match(await execute('act_on_control', args), /^Denied/)
  assert.equal(workerCalls.length, callsBeforeDenial)
  decision = 'once'

  assert.match(await execute('act_on_control', args), /^Verified control action/)
  assert.equal(workerCalls.at(-1).text, 'New text')
  assert(
    events.some(
      (e) =>
        e.type === 'tool_preview' &&
        e.preview.includes('Draft field') &&
        e.preview.includes('New text')
    )
  )
  assert.match(await execute('act_on_control', args), /^Denied: Control reference/)
  let next = unwrap(await execute('inspect_app', { window: refs[1] }))
  const nextArgs = { ...args, observation: next.observation }
  approvalHook = () => {
    rect = { ...rect, right: 600 }
  }
  const beforeChange = workerCalls.length
  assert.match(await execute('act_on_control', nextArgs), /^Denied: The target window changed/)
  assert.equal(workerCalls.length, beforeChange)
  approvalHook = () => {}
  rect = { ...rect, right: 500 }
  protectedTarget = true
  assert.match(await execute('inspect_app', { window: refs[1] }), /^Denied/)
  protectedTarget = false
  blocked = true
  assert.match(await execute('inspect_app', { window: refs[1] }), /^Denied/)
  blocked = false
  const now = Date.now
  try {
    Date.now = () => now() + 121000
    assert.throws(() => controls.controlTarget(nextArgs, run), /expired/)
  } finally {
    Date.now = now
  }
  observed = Array.from({ length: 50 }, (_, i) => ({
    ...sample,
    name: 'x'.repeat(240),
    value: 'y'.repeat(240),
    runtime: [42, i]
  }))
  next = unwrap(await execute('inspect_app', { window: refs[1] }))
  assert(next.truncated)
  assert(JSON.stringify(next).length < 12000)
  assert.equal(
    next.nextOffset,
    next.controls.length,
    'Paging does not skip controls omitted by the host character budget'
  )
  const offsetPage = unwrap(
    await execute('inspect_app', { window: refs[1], query: 'Draft', offset: 7 })
  )
  assert.equal(workerCalls.at(-1).offset, 7)
  assert.equal(offsetPage.nextOffset, 7 + offsetPage.controls.length)
  assert.throws(() => contracts.validateToolArguments('inspect_app', { offset: -1 }))
  assert.throws(() => contracts.validateToolArguments('inspect_app', { offset: 1001 }))
  assert.throws(() => contracts.validateToolArguments('inspect_app', { offset: 1.5 }))
  observed = [sample]
  for (const permission of ['ask', 'block', 'allow']) {
    settings.tools.inspect_app = 'ask'
    const before = unwrap(await execute('inspect_app', { window: refs[1] }))
    settings.tools.inspect_app = permission
    const start = workerCalls.length
    const combined = await runner(
      'act_on_control',
      { ...args, observation: before.observation, readback_query: 'Draft' },
      crypto.randomUUID()
    )
    assert.equal(combined.status, 'verified')
    assert.equal(workerCalls.length - start, permission === 'allow' ? 2 : 1)
    if (permission === 'allow') {
      assert(combined.observation)
      assert.equal(workerCalls.at(-1).hwnd, 2)
      assert.equal(workerCalls.at(-1).query, 'Draft')
      assert.equal(
        controls.controlTarget({ ...args, observation: combined.observation.id }, run).window.hwnd,
        2
      )
    } else assert(!combined.observation, 'Read permission is not implied by action approval')
  }
  settings.tools.inspect_app = 'ask'
  assert(invalidatedCaptures > 0, 'Control actions invalidate screenshot coordinates')
  for (const permission of ['ask', 'block', 'allow']) {
    settings.tools.look_at_screen = permission
    const start = captures
    const clicked = await tools.executeTool('click', { x: 1, y: 1, capture_after: true }, run, {
      window: windows.listWindows().find((w) => w.hwnd === 2)
    })
    assert.equal(clicked.status, 'reported')
    assert.equal(captures - start, permission === 'allow' ? 1 : 0)
    assert.equal(Boolean(clicked.image), permission === 'allow')
  }
  // Input returns its own settled image by default: always for a click, and for
  // keys or text only when the task last captured that window.
  settings.tools.look_at_screen = 'allow'
  const fixture = { window: windows.listWindows().find((w) => w.hwnd === 2) }
  let start = captures
  const settledBefore = settled
  const clickedByDefault = await tools.executeTool('click', { x: 1, y: 1 }, run, fixture)
  assert.equal(captures - start, 1, 'A click captures its result by default')
  assert.equal(settled - settledBefore, 1, 'The capture waits for the window to settle')
  assert.equal(captureArgs.if_changed, true, 'An unchanged window does not resend its image')
  assert.match(clickedByDefault.text, /do not call look_at_screen again/)
  start = captures
  await tools.executeTool('click', { x: 1, y: 1, capture_after: false }, run, fixture)
  assert.equal(captures - start, 0, 'capture_after: false skips the capture')
  lastCapturedWindow = null
  start = captures
  let typed = await tools.executeTool('type_text', { text: 'hi' }, run, fixture)
  assert.equal(captures - start, 0, 'Typing on the accessibility route stays text-only')
  assert.equal(typeof typed, 'string')
  lastCapturedWindow = 2
  typed = await tools.executeTool('type_text', { text: 'hi' }, run, fixture)
  assert.equal(captures - start, 1, 'Typing into the captured window returns an image')
  assert(typed.image)
  start = captures
  await tools.executeTool('press_keys', { keys: 'Enter', capture_after: false }, run, fixture)
  assert.equal(captures - start, 0)
  settings.tools.look_at_screen = 'ask'
  start = captures
  typed = await tools.executeTool('type_text', { text: 'hi' }, run, fixture)
  assert.equal(captures - start, 0, 'Default capture never widens look_at_screen')
  assert.equal(typeof typed, 'string', 'A default skip adds no permission note')
  assert.throws(
    () =>
      contracts.validateToolArguments('click', {
        x: 1,
        y: 1,
        capture_after: false,
        readback_region: { x: 0, y: 0, width: 20, height: 20 }
      }),
    /readback_region/
  )
  contracts.validateToolArguments('click', {
    x: 1,
    y: 1,
    readback_region: { x: 0, y: 0, width: 20, height: 20 }
  })
  lastCapturedWindow = null
  // Set-of-Marks: one call returns the marked image plus a live observation whose
  // cN references match the drawn numbers. It never widens inspect_app's grant.
  const target = { window: windows.listWindows().find((w) => w.hwnd === 2) }
  const inspectGrant = settings.tools.inspect_app
  settings.tools.inspect_app = 'ask'
  const workerBefore = workerCalls.length
  let looked = await tools.executeTool('look_at_screen', { marks: true }, run, target)
  assert.match(looked.text, /Marks were skipped/)
  assert.equal(looked.image, 'data:image/png;base64,fixture', 'Unmarked image still returns')
  assert.equal(workerCalls.length, workerBefore, 'No control read without inspect_app allow')
  settings.tools.inspect_app = 'allow'
  looked = await tools.executeTool('look_at_screen', { marks: true }, run, target)
  assert.equal(looked.status, 'observed')
  assert.equal(looked.image, 'data:image/jpeg;base64,marked')
  assert(/^obs-[\da-f]{12}$/.test(looked.observation.id), 'Marks register a live observation')
  assert.match(looked.text, /Mark N is control cN/)
  assert.deepEqual(
    markedTargets.map((t) => t.label),
    [1],
    'Mark numbers are the observation control numbers'
  )
  assert.deepEqual(markedTargets[0].bounds, {
    x: sample.bounds[0],
    y: sample.bounds[1],
    width: sample.bounds[2],
    height: sample.bounds[3]
  })
  assert(controls.controlTarget({ ...args, observation: looked.observation.id }, run))
  settings.tools.inspect_app = inspectGrant
  assert.throws(() => contracts.validateToolArguments('click', { mark: 2, x: 1, y: 1 }), /not both/)
  assert.throws(() => contracts.validateToolArguments('click', {}), /x and y/)
  assert.throws(() => contracts.validateToolArguments('click', { mark: 1.5 }), /mark/)
  assert.throws(
    () => contracts.validateToolArguments('look_at_screen', { marks: true, if_changed: true }),
    /if_changed/
  )
  assert.deepEqual(contracts.validateToolArguments('click', { mark: 3 }), { mark: 3 })
  const markedLocal = load('src/main/security/local-action.ts', {
    '../network/search-provider': {},
    '../tools/openApp': {},
    '../tools/windows': windows,
    '../tools/win32': native,
    '../permissions': permissions,
    '../tools/automation/controls': controls,
    '../tools/files': {},
    '../tools/screen': {
      markPoint: (label) => (label === 3 ? { x: 5, y: 6 } : null),
      captureCoordinates: (x, y) => ({ x: x + 100, y: y + 100, window: target.window })
    },
    'fs/promises': {},
    path,
    './run-manager': runs,
    './workspace-policy': {}
  })
  const markArgs = { mark: 3, button: 'left' }
  const markBinding = await markedLocal.bindLocalAction('click', markArgs, run)
  assert.deepEqual(markArgs, { button: 'left', x: 5, y: 6 }, 'A mark becomes image coordinates')
  assert.equal(markBinding.scope.window.hwnd, 2)
  assert.deepEqual(contracts.validateToolArguments('click', markArgs), markArgs)
  await assert.rejects(
    markedLocal.bindLocalAction('click', { mark: 9 }, run),
    (error) => error.code === 'SCREENSHOT_REQUIRED'
  )
  next = unwrap(await execute('inspect_app', { window: refs[1] }))
  result = { status: 'uncertain', message: 'Changed after the action' }
  assert.match(
    await execute('act_on_control', { ...args, observation: next.observation }),
    /^Unverified/
  )
  assert.throws(
    () => controls.controlTarget({ ...args, observation: next.observation }, run),
    /expired/
  )
  run = { ...run, id: 'next-run' }
  assert.equal(windows.findWindow(refs[1]), null)
  let editorTitle = 'Blank editor'
  native.getTitle = (hwnd) => (hwnd === 1 ? editorTitle : 'Other app')
  const blank = windows.findWindow('Blank editor')
  editorTitle = '*Draft - Editor'
  windows.rememberEditedWindow(blank, native.getProcess(blank.hwnd).pid)
  assert.equal(windows.findWindow('Blank editor').hwnd, blank.hwnd)
  editorTitle = 'Externally switched document'
  assert.equal(
    windows.findWindow('Blank editor'),
    null,
    'Unrelated title changes cannot retarget an old document'
  )
  const switched = windows.findWindow(editorTitle)
  editorTitle = 'Replacement process'
  windows.rememberEditedWindow(switched, native.getProcess(switched.hwnd).pid + 1)
  assert.equal(
    windows.findWindow(switched.title),
    null,
    'Process identity must match before recording a title change'
  )
  run = { ...run, id: 'after-title-edit' }
  editorTitle = '*Draft - Editor'
  assert.equal(
    windows.findWindow('Blank editor'),
    null,
    'Edited title aliases expire with their request'
  )
  run = { ...run, mode: 'assistant' }
  assert(tools.activeToolSchemas().some((s) => s.function.name === 'inspect_app'))
  console.log(
    'PASS exact duplicate-title targeting, active-app identity, approval/binding/dispatch path, field previews, denied/stale actions, reference expiry/replay/scope, blocked apps, compact output; no model or app interaction'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
