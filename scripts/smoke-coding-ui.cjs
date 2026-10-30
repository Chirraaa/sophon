const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/coding-ui')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let state,
  stops = 0,
  hides = 0
const decisions = []
let memoryFixture = false
let detailReads = 0
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel === 'session:get' && state) return state
    if (memoryFixture && channel === 'session:page')
      return {
        items: Array.from({ length: 60 }, (_, n) => ({
          id: `older-${n}`,
          from: 'you',
          text: `Archived message ${n}`,
          actions: [],
          pending: false
        })),
        start: 0,
        total: 120
      }
    if (memoryFixture && channel === 'session:action-details') {
      detailReads++
      return { detail: 'EXACT_ARCHIVED_TOOL_RESULT', preview: '{}' }
    }
    if (channel === 'approval:resolve') {
      decisions.push(args.slice(1))
      return
    }
    if (channel === 'agent:stop') {
      stops++
      return
    }
    return listener(...args)
  })
const on = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, listener) =>
  on(channel, (...args) => {
    if (channel === 'compact:hide' || channel === 'compact:dismiss') hides++
    return listener(...args)
  })
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => errors.push(details))
  contents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes("Loading the font 'data:"))
      errors.push(details.message)
  })
})
require(path.join(root, 'out/main/index.js'))
const patch = {
  path: 'src/components/SearchBox.tsx',
  edits: [
    {
      old_text: 'const results = items.filter(matchQuery)',
      new_text: 'const results = query.trim() ? items.filter(matchQuery) : []'
    },
    {
      old_text: '<input value={query} onChange={onChange} />',
      new_text: '<input aria-label="Search projects" value={query} onChange={onChange} />'
    }
  ]
}
function fixture(waiting = false) {
  return {
    chatId: 'coding-fixture',
    mode: 'assistant',
    busy: true,
    runningChatId: 'coding-fixture',
    chats: [{ id: 'coding-fixture', title: 'Polish project search', updatedAt: Date.now() }],
    items: [
      {
        id: 'user',
        from: 'you',
        text: 'Fix empty search results and make the search field accessible. Keep the changes focused.',
        actions: [],
        pending: false
      },
      {
        id: 'agent',
        from: 'agent',
        text: 'I found the search component. I’m patching the empty-query handling and adding an accessible label, then running the project checks.',
        pending: true,
        actions: [
          {
            id: 'patch',
            name: 'edit_file',
            label: 'Edit project files',
            status: waiting ? 'waiting' : 'done',
            canAlwaysAllow: true,
            preview: JSON.stringify({
              arguments: patch,
              destination: 'M:\\Projects\\app\\src\\components\\SearchBox.tsx'
            }),
            detail: waiting
              ? undefined
              : 'Edited src/components/SearchBox.tsx. Verified by reading back identical bytes.'
          },
          {
            id: 'test',
            name: 'run_npm',
            label: 'Run npm commands',
            status: 'done',
            preview: JSON.stringify({ arguments: { path: '.', args: ['run', 'test'] } }),
            detail: JSON.stringify({
              exitCode: 1,
              stopped: false,
              output: 'FAIL empty-query case: expected [], got 4 results'
            })
          },
          {
            id: 'test-pass',
            name: 'run_npm',
            label: 'Run npm commands',
            status: 'done',
            preview: JSON.stringify({ arguments: { path: '.', args: ['run', 'test'] } }),
            detail: JSON.stringify({ exitCode: 0, stopped: false, output: '12 tests passed' })
          }
        ],
        workflow: {
          version: 1,
          id: 'workflow-fixture',
          mode: 'assistant',
          workspaceKey: 'fixture',
          goal: 'Fix empty search results and make the search field accessible.',
          phase: 'act',
          outcome: 'running',
          nextStep: 'Run checks after the focused patch.',
          evidence: [],
          omittedEvidence: 0,
          updatedAt: Date.now(),
          codingSession: {
            version: 1,
            plan: 'Inspect the search behavior, patch the empty-query case and accessible name, then verify both changes.',
            tasks: [
              {
                id: 'inspect',
                title: 'Locate the search component and existing tests',
                status: 'verified',
                dependsOn: [],
                tools: ['read_file'],
                skill: 'none',
                profile: 'main'
              },
              {
                id: 'patch',
                title: 'Patch empty-query handling and the accessible label',
                status: 'active',
                dependsOn: ['inspect'],
                tools: ['edit_file'],
                skill: 'none',
                profile: 'main'
              },
              {
                id: 'verify',
                title: 'Run regression checks and review the changes',
                status: 'pending',
                dependsOn: ['patch'],
                tools: ['run_npm'],
                skill: 'none',
                profile: 'main'
              }
            ],
            docs: '',
            decisions: 'Preserve the existing filtering logic for nonempty queries.',
            lesson: '',
            inspections: [],
            trace: [],
            changes: [],
            revision: 1,
            checkpointRevision: 1,
            compactions: 0,
            edgeReview: '',
            review: '',
            reviewRevision: -1,
            reviewPending: false,
            verification: ''
          }
        }
      }
    ]
  }
}
async function wait(check, label) {
  const until = Date.now() + 12000
  while (Date.now() < until) {
    if (await check()) return
    await delay(40)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  for (const [name, win] of [
    ['chat', main],
    ['shortcut', compact]
  ]) {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
    const evaluate = (code) =>
      win.webContents.executeJavaScript(code, true).catch((error) => {
        throw new Error(name + ' evaluation failed: ' + code, { cause: error })
      })
    const click = (selector) =>
      evaluate(
        `{ const b = document.querySelector(${JSON.stringify(selector)}); b.focus(); b.click() }`
      )
    const key = (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    }
    const publish = async (value) => {
      state = value
      win.webContents.send('session:update', state)
      await wait(
        () => evaluate('!!document.querySelector("[data-coding-run]")'),
        name + ' coding card'
      )
      await delay(250)
    }
    const capture = async (file) => {
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      await delay(100)
      fs.writeFileSync(
        path.join(output, file + '.png'),
        (
          await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG()
      )
    }
    await wait(() => evaluate('!!document.querySelector("textarea")'), name + ' ready')
    await evaluate(
      'window.api.updateSettings({motion:"reduced",profile:{onboardingComplete:true}})'
    )
    await publish(fixture())
    if (name === 'shortcut') {
      await wait(() => compact.getBounds().width > 680, 'expanded native shortcut')
      const bounds = compact.getBounds(),
        area = screen.getDisplayMatching(bounds).workArea
      assert(
        bounds.x >= area.x &&
          bounds.y >= area.y &&
          bounds.x + bounds.width <= area.x + area.width &&
          bounds.y + bounds.height <= area.y + area.height
      )
    }
    const generating = fixture()
    generating.items.at(-1).actions = []
    generating.items.at(-1).modelProgress = { toolName: 'write_file', generatedChars: 12000 }
    await publish(generating)
    await wait(
      () =>
        evaluate(
          'document.body.textContent.includes("Generating file contents") && document.body.textContent.includes("12,000 characters received")'
        ),
      'Streamed file generation progress'
    )
    await capture(name + '-generating')
    generating.items.at(-1).modelProgress.generatedChars = 18000
    await publish(generating)
    await wait(
      () => evaluate('document.body.textContent.includes("18,000 characters received")'),
      'File generation progress grows'
    )
    await publish(fixture())
    await wait(
      () => evaluate('!document.body.textContent.includes("characters received")'),
      'Generation progress clears before execution'
    )
    await capture(name + '-progress')
    await click('[aria-label="Stop response"]')
    await wait(() => stops === (name === 'chat' ? 1 : 2), 'Stop remains reachable')
    await click('[aria-label="Open coding progress"]')
    await wait(
      () => evaluate('!!document.querySelector("[data-slot=dialog-content]")'),
      'details dialog'
    )
    assert(
      await evaluate(
        'document.querySelector("[role=dialog]").textContent.includes("Locate the search component")'
      )
    )
    await wait(
      () => evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)'),
      'Dialog must own keyboard focus'
    )

    for (const [motion, systemReduced, reduced] of [
      ['full', true, false],
      ['system', true, true],
      ['reduced', false, true],
      ['system', false, false]
    ]) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: systemReduced ? 'reduce' : 'no-preference' }
        ]
      })
      await evaluate(`window.api.updateSettings({motion:${JSON.stringify(motion)}})`)
      await wait(
        () => evaluate(`document.documentElement.dataset.reducedMotion === '${reduced}'`),
        `${name} motion preference: ${motion}/${systemReduced}`
      )
      const selectors = ['[data-coding-run] .animate-spin', '[role=dialog] li .animate-spin']
      const sample = async () => {
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        return evaluate(`(${JSON.stringify(selectors)}).map(selector => {
          const icon = document.querySelector(selector);
          if (!icon) throw new Error('Missing progress icon: ' + selector);
          const style = getComputedStyle(icon);
          return {
            transform: style.transform, iterations: style.animationIterationCount,
            animations: icon.getAnimations().map(a => ({name: a.animationName, time: a.currentTime, state: a.playState}))
          };
        })`)
      }
      await delay(80)
      const before = await sample()
      await delay(150)
      const after = await sample()
      for (let index = 0; index < selectors.length; index++) {
        const label = `${name} ${selectors[index]} with ${motion}/${systemReduced}`
        if (reduced) {
          assert.equal(after[index].iterations, '1', label + ' respects reduced motion')
          assert.equal(after[index].transform, before[index].transform, label + ' stays still')
        } else {
          assert.equal(after[index].iterations, 'infinite', label + ' spins continuously')
          assert.notEqual(
            after[index].transform,
            before[index].transform,
            label + ' rotates: ' + JSON.stringify({ before: before[index], after: after[index] })
          )
        }
      }
    }
    await evaluate('window.api.updateSettings({motion:"reduced"})')
    await evaluate(
      'Array.from(document.querySelectorAll("[role=tab]")).find(t => t.textContent.startsWith("Files")).click()'
    )
    await wait(
      () => evaluate('!!document.querySelector("[role=dialog] [data-patch-preview]")'),
      'patch preview'
    )
    assert(
      await evaluate('document.querySelector("[role=dialog]").textContent.includes("aria-label=")')
    )
    await capture(name + '-patches')
    if (name === 'shortcut') {
      const shape = await evaluate(`(() => {
        const backdrop = document.querySelector('.popup-backdrop')
        const panel = document.querySelector('[data-compact-size]').getBoundingClientRect()
        return { clip: getComputedStyle(backdrop).clipPath, panel: { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom },
          width: innerWidth, height: innerHeight }
      })()`)
      assert.match(
        shape.clip,
        /^path\(/,
        'Shortcut modal backdrop uses visible rounded panel shapes'
      )
      await delay(100)
      const shot = await win.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true
      })
      const bitmap = shot.toBitmap(),
        size = shot.getSize()
      const pixelAlpha = (x, y) =>
        bitmap[
          (Math.floor((y * size.height) / shape.height) * size.width +
            Math.floor((x * size.width) / shape.width)) *
            4 +
            3
        ]
      assert.equal(pixelAlpha(2, 2), 0, 'Window padding remains transparent behind a modal')
      assert(
        pixelAlpha(shape.panel.right - 1, shape.panel.y + 1) <= 8,
        'Rounded panel corner keeps only the faint panel shadow, not the modal rectangle'
      )
    }
    await evaluate(
      'Array.from(document.querySelectorAll("[role=tab]")).find(t => t.textContent === "Checks").click()'
    )
    await wait(
      () => evaluate('document.querySelector("[role=dialog]").textContent.includes("Failed (1)")'),
      'failed command must not look passed'
    )
    assert(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Passed")'))
    const hidesBefore = hides
    key('Escape')
    await wait(() => evaluate('!document.querySelector("[role=dialog]")'), 'dismiss details')
    assert.equal(hides, hidesBefore, 'Escape closes the dialog, not the shortcut')
    await wait(
      () =>
        evaluate('document.activeElement.getAttribute("aria-label") === "Open coding progress"'),
      'restore trigger focus'
    )
    await publish(fixture(true))
    const beforeTyping = decisions.length
    await evaluate(`{
      const composer = document.querySelector('textarea');
      composer.focus();
      for (const key of ['1', '2', '3']) composer.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    }`)
    await delay(100)
    assert.equal(
      decisions.length,
      beforeTyping,
      'Typing and Ctrl+Enter in the composer cannot approve'
    )
    assert(
      await evaluate('!!document.querySelector("section [data-patch-preview]")'),
      'Approval shows the actual patch'
    )
    const layout = await evaluate(`(() => {
      const a = document.querySelector('section[aria-busy]').getBoundingClientRect();
      const c = document.querySelector('textarea').getBoundingClientRect();
      return { a: a.bottom, c: c.top, bottom: c.bottom, height: innerHeight, width: innerWidth, scroll: document.documentElement.scrollWidth, y: scrollY }
    })()`)
    assert(
      layout.a <= layout.c &&
        layout.bottom <= layout.height &&
        layout.scroll <= layout.width &&
        layout.y === 0,
      name + ' approval/composer layout: ' + JSON.stringify(layout)
    )
    await capture(name + '-approval')
    await evaluate(
      'Array.from(document.querySelectorAll("section button")).find(b => b.textContent.includes("Allow once")).click()'
    )
    await wait(() => decisions.length === (name === 'chat' ? 1 : 2), 'exact one-use approval')
    assert.deepEqual(decisions.at(-1), ['patch', 'once'])
    if (name === 'shortcut') {
      await click('[aria-label="Use smaller window"]')
      await wait(
        () =>
          compact.getBounds().width ===
          (screen.getDisplayMatching(compact.getBounds()).workArea.width >= 1016
            ? 1016
            : Math.min(680, screen.getDisplayMatching(compact.getBounds()).workArea.width)),
        'manual compact width'
      )
      await capture('shortcut-small-approval')
      await click('[aria-label="Expand quick command"]')
      await wait(() => compact.getBounds().width > 680, 'manual expansion')
      const long = fixture()
      long.items[1].text = 'Earlier project context.\n\n'.repeat(200)
      await publish(long)
      await evaluate('document.querySelector("[data-chat-viewport]").scrollTop = 0')
      await delay(100)
      long.items[1].text += '\nAnother update while you read.'
      await publish(long)
      assert.equal(
        await evaluate('document.querySelector("[data-chat-viewport]").scrollTop'),
        0,
        'Streaming must not pull a reader to the bottom'
      )
    }
    const paused = fixture()
    paused.busy = false
    paused.runningChatId = null
    paused.items[1].pending = false
    paused.items[1].workflow.outcome = 'interrupted'
    await publish(paused)
    assert(
      await evaluate('document.querySelector("[data-coding-run]").textContent.includes("Paused")')
    )
    assert(
      await evaluate(
        'document.querySelector("[data-coding-run]").textContent.includes("Continue task")'
      )
    )
    await capture(name + '-paused')
    if (name === 'chat') {
      assert.equal(await evaluate('!!document.querySelector("[data-compact-task]")'), false)
      continue
    }
    let nativeHides = 0
    const hideCompact = compact.hide.bind(compact)
    compact.hide = () => {
      nativeHides++
      hideCompact()
    }
    compact.emit('blur')
    assert.equal(nativeHides, 0, 'Task progress stays visible on blur, including paused tasks')
    main.emit('focus')
    assert.equal(nativeHides, 1, 'Focusing the full app hides the shortcut and its task panel')
    const taskLayout = () =>
      evaluate(`(() => {
      const popup = document.querySelector('[data-compact-size]').getBoundingClientRect();
      const task = document.querySelector('[data-compact-task]').getBoundingClientRect();
      return { gap: popup.left - task.right, center: (popup.left + popup.right) / 2, width: innerWidth, bottom: task.bottom, height: innerHeight,
        copies: document.querySelectorAll('[data-coding-run]').length,
        inScroll: !!document.querySelector('[data-chat-viewport] [data-coding-run]') }
    })()`)
    let placement = await taskLayout()
    assert.equal(placement.gap, 16, JSON.stringify(placement))
    assert(
      Math.abs(placement.center - (placement.width + 336) / 2) <= 1,
      'Main popup stays centered beside task cards'
    )
    assert(placement.bottom <= placement.height - 19, JSON.stringify(placement))
    assert.equal(placement.copies, 1)
    assert.equal(placement.inScroll, false)
    await click('[aria-label="Collapse coding task"]')
    await wait(
      () => evaluate(`!!document.querySelector('[aria-label="Expand coding task"]')`),
      'collapse task'
    )
    await capture('shortcut-collapsed-task')
    await click('[aria-label="Expand coding task"]')
    const stopsBefore = stops
    await click('[aria-label="Hide coding task"]')
    await wait(() => evaluate('!document.querySelector("[data-compact-task]")'), 'hide task')
    await delay(100)
    compact.emit('blur')
    assert.equal(nativeHides, 2, 'Explicitly hidden task restores normal shortcut blur behavior')
    assert.equal(await evaluate('document.querySelectorAll("[data-coding-run]").length'), 0)
    assert.equal(stops, stopsBefore, 'Hiding progress must not stop the task')
    compact.webContents.send('compact:shown', { mode: 'command', token: 101 })
    await delay(250)
    assert.equal(
      await evaluate('!!document.querySelector("[data-compact-task]")'),
      false,
      'Hidden choice survives reopening'
    )
    await click('[aria-label="Show coding task"]')
    await wait(() => evaluate('!!document.querySelector("[data-compact-task]")'), 'restore task')
    await capture('shortcut-reopened-task')
    assert.equal(
      await evaluate('!!document.querySelector("[data-chat-viewport]")'),
      false,
      'Idle reopen starts a fresh prompt'
    )
    assert.equal(
      (await taskLayout()).copies,
      1,
      'Completed task survives an empty visible transcript'
    )

    await click('[aria-label="Hide coding task"]')
    const next = fixture()
    next.items[1].id = 'new-task'
    await publish(next)
    assert(await evaluate('!!document.querySelector("[data-compact-task]")'))

    const followup = structuredClone(next)
    followup.items[1].pending = false
    followup.items.push({ id: 'followup', from: 'agent', text: '', pending: true, actions: [] })
    await publish(followup)
    assert.equal((await taskLayout()).copies, 1)
    followup.items[2].pending = false
    followup.busy = false
    state = followup
    compact.webContents.send('session:update', state)
    await wait(
      () => evaluate('!document.querySelector("[data-compact-task]")'),
      'retire old task after non-coding reply'
    )

    const short = fixture(true)
    short.items[1].id = 'short-display-task'
    await publish(short)
    const displayMatching = screen.getDisplayMatching.bind(screen)
    screen.getDisplayMatching = (bounds) => {
      const display = displayMatching(bounds)
      return { ...display, workArea: { ...display.workArea, width: 680, height: 520 } }
    }
    screen.emit('display-metrics-changed')
    await delay(400)
    await capture('shortcut-short-display')
    placement = await taskLayout()
    assert(placement.bottom <= 500, JSON.stringify(placement))
    assert(compact.getBounds().height <= 520 && compact.getBounds().width <= 680)
    assert(
      await evaluate(`(() => {
      const stop = document.querySelector('[aria-label="Stop response"]').getBoundingClientRect();
      const popup = document.querySelector('[data-compact-size]').getBoundingClientRect();
      return stop.top >= popup.top && stop.bottom <= popup.bottom
    })()`),
      'Stop stays reachable on short displays'
    )
    await evaluate(`(() => {
      const approval = document.querySelector('section[aria-busy]').closest('[data-slot="scroll-area-viewport"]');
      approval.scrollTop = approval.scrollHeight;
      Array.from(document.querySelectorAll('section[aria-busy] button')).find(b => b.textContent.includes('Allow once')).scrollIntoView({block:'nearest'});
    })()`)
    assert(
      await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('section[aria-busy] button')).find(b => b.textContent.includes('Allow once')).getBoundingClientRect();
      const scroller = document.querySelector('section[aria-busy]').closest('[data-slot="scroll-area-viewport"]').getBoundingClientRect();
      return button.top >= scroller.top && button.bottom <= scroller.bottom;
    })()`),
      'Approval decisions remain reachable on short displays'
    )
    screen.getDisplayMatching = displayMatching
    screen.emit('display-metrics-changed')

    state = { ...fixture(), chatId: 'empty-chat', items: [], busy: false, runningChatId: null }
    compact.webContents.send('session:update', state)
    await wait(
      () => evaluate('!document.querySelector("[data-compact-task]")'),
      'no stale task on chat switch'
    )

    if (await evaluate('!!document.querySelector(\'[aria-label="Use smaller window"]\')'))
      await click('[aria-label="Use smaller window"]')
    await delay(300)
    const beforeContext = compact.getBounds()
    const contextBounds = []
    const recordContextBounds = () => contextBounds.push(compact.getBounds())
    compact.on('resize', recordContextBounds)
    compact.on('move', recordContextBounds)
    await evaluate(`(() => {
      window.contextFrames = [];
      const sample = () => {
        const box = document.querySelector('[data-compact-size]').getBoundingClientRect();
        window.contextFrames.push({left: box.left, width: box.width});
      };
      window.contextObserver = new MutationObserver(sample);
      window.contextObserver.observe(document.getElementById('root'), {childList: true, subtree: true, attributes: true});
      sample();
    })()`)
    for (let toggle = 0; toggle < 3; toggle++) {
      await click('[aria-label="Show GitHub context"]')
      await wait(
        () => evaluate('!!document.querySelector("[data-github-context]")'),
        'repo card open'
      )
      await delay(100)
      await click('[aria-label="Hide GitHub context"]')
      await wait(
        () => evaluate('!document.querySelector("[data-github-context]")'),
        'repo card closed'
      )
      await delay(100)
    }
    const contextFrames = await evaluate(`(() => {
      window.contextObserver.disconnect();
      return window.contextFrames;
    })()`)
    compact.removeListener('resize', recordContextBounds)
    compact.removeListener('move', recordContextBounds)
    assert(contextFrames.length > 1, 'Sampled repo-card transition frames')
    assert(
      contextFrames.every(
        (frame) => frame.left === contextFrames[0].left && frame.width === contextFrames[0].width
      ),
      'Repo-card toggles keep the command panel stationary'
    )
    assert(
      contextBounds.every(
        (bounds) => bounds.x === beforeContext.x && bounds.width === beforeContext.width
      ),
      'Repo-card toggles keep native width and horizontal position stable'
    )
    key('Escape')
    await wait(() => hides > hidesBefore, 'Escape still hides shortcut')
    assert.equal(stops, stopsBefore, 'Visibility controls never stop a run')
  }
  memoryFixture = true
  state = {
    ...fixture(),
    totalItems: 120,
    items: Array.from({ length: 60 }, (_, n) => ({
      id: `recent-${n}`,
      from: 'agent',
      text: `Recent message ${n}`,
      pending: n === 59,
      actions:
        n === 58
          ? [
              {
                id: 'a0000000-0000-4000-8000-000000000001',
                name: 'read_file',
                label: 'Read file',
                status: 'done',
                detailsStored: true,
                detail: 'Excerpt'
              }
            ]
          : []
    }))
  }
  main.webContents.send('session:update', state)
  const mainEval = (code) => main.webContents.executeJavaScript(code)
  await wait(
    () => mainEval('document.body.textContent.includes("Recent message 59")'),
    'memory fixture'
  )
  assert.equal(detailReads, 0, 'Archived output stays unloaded until expanded')
  await mainEval(
    'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Earlier messages").click()'
  )
  await wait(
    () => mainEval('document.body.textContent.includes("Archived message 0")'),
    'history page'
  )
  await mainEval(
    'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Close history").click()'
  )
  await wait(
    () => mainEval('!document.body.textContent.includes("Archived message 0")'),
    'release history page'
  )
  await mainEval(
    'Array.from(document.querySelectorAll("[data-slot=collapsible-trigger]")).find(s => s.textContent.includes("Actions (1)")).click()'
  )
  await wait(
    () =>
      mainEval(
        'Array.from(document.querySelectorAll("[data-slot=collapsible-trigger]")).some(s => s.textContent === "Full action details")'
      ),
    'stored details control'
  )
  await mainEval(
    'Array.from(document.querySelectorAll("[data-slot=collapsible-trigger]")).find(s => s.textContent === "Full action details").click()'
  )
  await wait(
    () => mainEval('document.body.textContent.includes("EXACT_ARCHIVED_TOOL_RESULT")'),
    'exact stored details'
  )
  assert.equal(detailReads, 1)
  await mainEval(
    'Array.from(document.querySelectorAll("[data-slot=collapsible-trigger]")).find(s => s.textContent === "Full action details").click()'
  )
  await wait(
    () => mainEval('!document.body.textContent.includes("EXACT_ARCHIVED_TOOL_RESULT")'),
    'release stored details'
  )
  main.webContents.send('session:text', {
    chatId: state.chatId,
    itemId: 'recent-59',
    text: 'INCREMENTAL_REPLY_CANARY'
  })
  await wait(
    () => mainEval('document.body.textContent.includes("INCREMENTAL_REPLY_CANARY")'),
    'incremental response'
  )
  console.log(
    'PASS memory UI: paged history, closing releases content, on-demand exact tool output and incremental response updates'
  )
  assert.deepEqual(errors, [])
  assert.equal(main.isVisible(), false)
  assert.equal(compact.isVisible(), false)
  console.log(
    'PASS coding UI: task/file/check tabs, focus/Escape, approvals, shortcut sizing, left-side cards with 16px gap, collapse/hide/restore, reopening, new tasks, follow-ups, short displays, chat switching, reading-position retention and resume; hidden isolated profile'
  )
  console.log('Screenshots: ' + output)
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
