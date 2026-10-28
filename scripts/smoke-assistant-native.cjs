const { app, BrowserWindow, globalShortcut, dialog, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const assert = require('node:assert/strict')
const { load, root } = require('./security/load.cjs')
const output = path.join(root, '.cache/assistant-native', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'profile'))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let prompts = 0
dialog.showMessageBox = async () => {
  prompts++
  return { response: 1 }
}
require('./security/consent-fixture.cjs')(
  app,
  async () => (await dialog.showMessageBox(null, {})).response === 1
)

let fixtureTransport = true
let fixtureCall
const originalRequest = http.request
http.request = (url, options, callback) => {
  if (!fixtureTransport && url.pathname.endsWith('/chat/completions')) {
    const measurement = { startedAt: Date.now() }
    report.modelRequests.push(measurement)
    return originalRequest(url, options, (response) => {
      let body = ''
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        measurement.latencyMs = Date.now() - measurement.startedAt
        const chunks = body.startsWith('data:')
          ? body
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
          : [body]
        for (const chunk of chunks) {
          try {
            const data = JSON.parse(chunk)
            if (data.usage) measurement.usage = data.usage
            if (data.choices) {
              measurement.responses ??= []
              for (const choice of data.choices) {
                const message = choice.message ?? choice.delta
                if (message?.tool_calls)
                  measurement.responses.push({ tool_calls: message.tool_calls })
              }
            }
          } catch {
            /* SSE terminal marker. */
          }
        }
        saveReport()
      })
      callback(response)
    })
  }
  if (!url.pathname.endsWith('/chat/completions')) return originalRequest(url, options, callback)
  const request = new EventEmitter()
  request.end = (body) => {
    queueMicrotask(() => {
      if (options.signal.aborted) return request.emit('error', new Error('Aborted'))
      const payload = JSON.parse(body)
      const last = payload.messages.at(-1)
      if (fixtureCall.hwnd && last.role === 'tool' && !fixtureCall.bound) {
        const rect = native.getVisibleRect(fixtureCall.hwnd)
        const row = String(last.content)
          .split('\n')
          .find((line) => line.includes(`at (${rect.left},${rect.top})`))
        const ref = row?.match(/win-[a-f0-9-]+/)?.[0]
        assert(ref, 'Owned window absent from list_windows: ' + last.content)
        fixtureCall.args[fixtureCall.name === 'close_window' ? 'title' : 'window'] = ref
        fixtureCall.bound = true
      }
      let reply =
        (last.role === 'user' ||
          (fixtureCall.hwnd && last.role === 'tool' && fixtureCall.bound && !fixtureCall.sent)) &&
        typeof last.content === 'string' &&
        (last.content === 'native fixture action' || fixtureCall.bound)
          ? {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'native-' + Date.now(),
                  type: 'function',
                  function:
                    fixtureCall.hwnd && !fixtureCall.bound
                      ? { name: 'list_windows', arguments: '{}' }
                      : { name: fixtureCall.name, arguments: JSON.stringify(fixtureCall.args) }
                }
              ]
            }
          : { role: 'assistant', content: 'Recorded the tool result.' }
      if (fixtureCall.bound && reply.tool_calls) fixtureCall.sent = true
      if (Array.isArray(last.content) && fixtureCall.afterImage) {
        const next = fixtureCall.afterImage
        delete fixtureCall.afterImage
        reply = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'click-' + Date.now(),
              type: 'function',
              function: { name: next.name, arguments: JSON.stringify(next.args) }
            }
          ]
        }
      }
      const response = new PassThrough()
      response.statusCode = 200
      response.headers = { 'content-type': 'application/json' }
      callback(response)
      response.end(JSON.stringify({ choices: [{ message: reply, finish_reason: 'stop' }] }))
    })
  }
  request.destroy = (error) => {
    if (error) request.emit('error', error)
    return request
  }
  return request
}

const koffi = require('koffi')
const testKoffi = {
  ...koffi,
  proto: (declaration) =>
    koffi.proto(declaration.replaceAll('EnumWindowsProc', 'AssistantTestEnumWindowsProc')),
  load: (library) => {
    const dll = koffi.load(library)
    return {
      func: (declaration) =>
        dll.func(declaration.replaceAll('EnumWindowsProc', 'AssistantTestEnumWindowsProc'))
    }
  }
}
const native = load('src/main/tools/win32.ts', { koffi: { default: testKoffi } })
const worker = load('src/main/tools/automation/worker.ts', {
  child_process: { spawn },
  path,
  '../../security/worker-job': load('src/main/security/worker-job.ts', {
    koffi: { default: require('koffi') }
  }),
  './bridge.ps1?raw': {
    default: fs.readFileSync(path.join(root, 'src/main/tools/automation/bridge.ps1'), 'utf8')
  }
}).automationWorker
const report = {
  live: process.argv.includes('--live'),
  checks: [],
  modelReplies: [],
  modelRequests: []
}
const saveReport = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
let fixture
let main
let evaluate
const ownedNotepads = new Set()
require(path.join(root, 'out/main/index.js'))
async function wait(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(80)
  }
  throw new Error('Timed out: ' + label)
}
const check = (label) => {
  report.checks.push(label)
  saveReport()
  console.log('PASS ' + label)
}
async function action(name, args, hwnd) {
  fixtureCall = { name, args, hwnd }
  await evaluate('window.api.chats.create()')
  await evaluate('window.api.send("native fixture action")')
  const state = await evaluate('window.api.getSession()')
  const result = state.items.at(-1).actions.at(-1)
  assert(result, JSON.stringify(state.items.at(-1)))
  assert.equal(result.status, 'done', result.detail)
  return result
}
const listing = async () => (await action('list_windows', {})).detail
const recordImage = async (item, file) => {
  assert(item.attachments.length > 0, 'Missing tool screenshot')
  const image = await evaluate(
    `window.api.attachments.preview(${JSON.stringify(item.attachments.at(-1).id)})`
  )

  const url = typeof image === 'string' ? image : image.url
  fs.writeFileSync(path.join(output, file), nativeImage.createFromDataURL(url).toPNG())
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'app windows')
  main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  main.webContents.setBackgroundThrottling(false)
  evaluate = (code) => main.webContents.executeJavaScript(code, true)
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'renderer ready')
  const toolNames = await evaluate('window.api.toolsInfo()')
  assert(
    (
      await evaluate(
        `window.api.updateSettings(${JSON.stringify({
          tools: Object.fromEntries(
            toolNames.map((t) => [
              t.name,
              !process.argv.includes('--reference-only') ||
              [
                'list_windows',
                'move_window',
                'focus_window',
                'look_at_screen',
                'inspect_app',
                'act_on_control',
                'click'
              ].includes(t.name)
                ? 'allow'
                : 'block'
            ])
          ),

          rules: { blockedApps: [] },
          model: {
            modelId: 'native-fixture',
            contextWindow: 60000,
            maxTokens: 1024,
            maxSteps: 30,
            historyTurns: 4
          }
        })})`
      )
    ).ok
  )
  const confirmedPrompts = prompts
  if (process.argv.includes('--tools-only')) {
    assert(report.live, '--tools-only requires --live')
    fixtureTransport = false
    await require('./desktop-review/tools-live.cjs')({
      evaluate,
      output,
      report,
      saveReport,
      check,
      wait,
      main,
      app,
      dialog
    })
    report.ok = true
    saveReport()
    console.log('Evidence: ' + output)
    return
  }
  let view
  if (!process.argv.includes('--reference-only')) {
    const before = native
      .enumTopLevelWindows()
      .filter((h) => /notepad/i.test(native.getProcess(h).exe))

    await action('open_app', { name: 'notepad' })
    let notepad
    await wait(() => {
      notepad = native
        .enumTopLevelWindows()
        .find(
          (h) =>
            !before.includes(h) &&
            /notepad/i.test(native.getProcess(h).exe) &&
            native.isVisible(h) &&
            native.getTitle(h)
        )
      return !!notepad
    }, 'new Notepad window')
    ownedNotepads.add(notepad)
    check('open_app opens a new Notepad window')
    const target = () => native.getTitle(notepad)

    await action('press_keys', { window: target(), keys: 'Ctrl+N' }, notepad)
    await delay(300)
    const sample = 'Sophon desktop test 7429'
    await action('type_text', { window: target(), text: sample }, notepad)
    await delay(200)
    view = await worker(
      { operation: 'inspect', hwnd: notepad, pid: native.getProcess(notepad).pid },
      new AbortController().signal
    )
    assert(
      view.controls.some((c) => c.value.includes(sample) || c.name.includes(sample)),
      JSON.stringify(view)
    )
    check('type_text writes text in Notepad, independently read back with UI Automation')
    await action('press_keys', { window: target(), keys: 'Ctrl+A' }, notepad)
    await action('press_keys', { window: target(), keys: 'Backspace' }, notepad)
    await delay(200)
    view = await worker(
      { operation: 'inspect', hwnd: notepad, pid: native.getProcess(notepad).pid },
      new AbortController().signal
    )
    assert(!view.controls.some((c) => c.value.includes(sample) || c.name.includes(sample)))
    assert(
      view.controls.some((c) => ['Edit', 'Document'].includes(c.role) && !c.value.trim()),
      JSON.stringify(view)
    )
    check('Ctrl+A and Backspace delete exactly the test text; empty editor checked independently')
    await action('close_window', { title: target() }, notepad)

    if (native.enumTopLevelWindows().includes(notepad) && native.isVisible(notepad)) {
      view = await worker(
        { operation: 'inspect', hwnd: notepad, pid: native.getProcess(notepad).pid },
        new AbortController().signal
      )
      const discard = view.controls.find(
        (c) =>
          /don't save|do not save|ne pas enregistrer/i.test(c.name) && c.actions.includes('invoke')
      )
      assert(
        discard,
        'Owned Notepad remains open without a recognized discard prompt: ' + JSON.stringify(view)
      )
      await worker(
        {
          operation: 'act',
          hwnd: notepad,
          pid: native.getProcess(notepad).pid,
          expected: discard,
          action: 'invoke'
        },
        new AbortController().signal
      )
    }
    await wait(
      () => !native.enumTopLevelWindows().includes(notepad) || !native.isVisible(notepad),
      'Notepad closes'
    )
    ownedNotepads.delete(notepad)
    check('close_window closes the test Notepad')
  }

  const title = 'Sophon reference test ' + Date.now()
  fixture = spawn(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, 'desktop-review/assistant-fixture.ps1'),
      '-OutputDirectory',
      output,
      '-WindowTitle',
      title
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const identity = await new Promise((resolve, reject) => {
    let data = ''
    fixture.stdout.on('data', (chunk) => {
      data += chunk
      if (data.includes('\n')) {
        try {
          resolve(JSON.parse(data.trim()))
        } catch (error) {
          reject(error)
        }
      }
    })
    fixture.stderr.on('data', (chunk) => reject(new Error(String(chunk))))
    fixture.on('error', reject)
    setTimeout(() => reject(new Error('Reference fixture did not open')), 15000).unref()
  })
  await delay(300)
  const initial = native.getVisibleRect(identity.hwnd)
  await action('move_window', { title, x: initial.left + 100, y: initial.top + 40 })
  const moved = native.getVisibleRect(identity.hwnd)
  assert(
    Math.abs(moved.left - initial.left - 100) < 5 && Math.abs(moved.top - initial.top - 40) < 5
  )
  check('move_window moves the test window by the requested offset, verified independently')
  await action('look_at_screen', { window: title })
  let state = await evaluate('window.api.getSession()')
  await recordImage(state.items.at(-1), 'screenshot-reference.png')
  const screenshotInfo = state.items.at(-1).actions.at(-1).detail
  const size = /(\d+)\D(\d+) pixels/.exec(screenshotInfo)
  assert(size, screenshotInfo)
  view = await worker({ ...identity, operation: 'inspect' }, new AbortController().signal)
  const button = view.controls.find((c) => c.name === 'Click test')
  assert(button, JSON.stringify(view))
  const current = native.getVisibleRect(identity.hwnd)

  const x =
    ((button.bounds[0] + button.bounds[2] / 2 - current.left) * Number(size[1])) /
    (current.right - current.left)
  const y =
    ((button.bounds[1] + button.bounds[3] / 2 - current.top) * Number(size[2])) /
    (current.bottom - current.top)

  fixtureCall = { name: 'look_at_screen', args: { window: title } }

  fixtureCall.afterImage = { name: 'click', args: { x, y, capture_after: true } }
  await evaluate('window.api.chats.create()')
  await evaluate('window.api.send("native fixture action")')
  await wait(() => fs.existsSync(path.join(output, 'clicks.txt')), 'native click event')
  assert.equal(fs.readFileSync(path.join(output, 'clicks.txt'), 'utf8'), '1')
  check('click from screenshot coordinates triggers the native button exactly once')
  state = await evaluate('window.api.getSession()')
  assert(
    state.items.at(-1).attachments.length >= 2,
    'Click returns a post-action screenshot without a separate model tool call'
  )
  assert(
    state.items
      .at(-1)
      .actions.some((a) => a.name === 'click' && a.detail.includes('Post-action observation'))
  )
  check('visual fallback returns post-click evidence in the same tool call')
  assert.equal(prompts, confirmedPrompts, 'Always allow must not prompt for each action')
  check('Always allow runs native tools without repeated prompts')
  assert((await listing()).includes(title))
  if (report.live) {
    fixtureTransport = false
    assert((await evaluate('window.api.updateSettings({model:{modelId:""}})')).ok)
    const status = await evaluate('window.api.llmStatus()')
    assert(status.online, 'No model listening at the configured local endpoint')
    report.model = status.model
    if (!process.argv.includes('--browser-only')) {
      await evaluate('window.api.chats.create()')
      await evaluate(
        `window.api.send(${JSON.stringify(`Take a screenshot of the window titled "${title}". Read the project name and numeric code from its image, and count the blue squares and red circles. Report exactly what you see. Do not use inspect_app for this image-reading test.`)})`
      )
      state = await evaluate('window.api.getSession()')
      report.modelReplies.push({ test: 'vision', reply: state.items.at(-1) })
      saveReport()
      await recordImage(state.items.at(-1), 'live-model-screenshot.png')
      const answer = state.items.at(-1).text
      assert.match(answer, /ORION/i)
      assert.match(answer, /7429/)
      assert.match(
        answer,
        /(?:3|three)[^\n.]{0,40}(?:blue|square)|(?:blue|square)[^\n.]{0,40}(?:3|three)/i
      )
      assert.match(
        answer,
        /(?:2|two)[^\n.]{0,40}(?:red|circle)|(?:red|circle)[^\n.]{0,40}(?:2|two)/i
      )
      check(
        'loaded model reads ORION / 7429 and correctly counts 3 blue squares and 2 red circles from its screenshot'
      )
      await evaluate('window.api.chats.create()')
      await evaluate(
        `window.api.send(${JSON.stringify(`Move the window titled "${title}" to the right half of its current monitor using the position preset. Then inspect that window and activate its "Click test" button exactly once using its supported accessibility action. Inspect the result: its click count must change from 1 to 2. Do not interact with other windows.`)})`
      )
      state = await evaluate('window.api.getSession()')
      report.modelReplies.push({ test: 'move-and-click', reply: state.items.at(-1) })
      saveReport()
      for (let index = 0; index < state.items.at(-1).attachments.length; index++) {
        const item = { attachments: [state.items.at(-1).attachments[index]] }
        await recordImage(item, `move-click-${index + 1}.png`)
      }
      assert.equal(
        fs.readFileSync(path.join(output, 'clicks.txt'), 'utf8'),
        '2',
        state.items.at(-1).text
      )
      assert(
        state.items.at(-1).actions.some((a) => a.name === 'move_window' && a.status === 'done')
      )
      check('loaded model moves the window, clicks the intended button once and observes the count')
    }
    const liveSend = async (test, prompt) => {
      const startedAt = Date.now()
      console.log('RUN ' + test)
      await evaluate(`window.api.send(${JSON.stringify(prompt)})`)
      const session = await evaluate('window.api.getSession()')
      const reply = session.items.at(-1)
      report.modelReplies.push({ test, latencyMs: Date.now() - startedAt, reply })
      saveReport()
      assert(!/^Error:|^Stopped/i.test(reply.text), reply.text)
      return reply
    }
    if (process.argv.includes('--visual')) {
      await evaluate('window.api.chats.create()')
      const visual = await liveSend(
        'live-visual',
        'Create an interactive plot of y = a*x*x with a working slider for a from 0 to 4, default 1. Use sophon.explorer with control id a, a line chart for x from -3 to 3, and a metric labeled y at x=2 equal to 4*a. Put the entire working visual in one complete HTML block.'
      )
      assert.match(visual.text, /```html/)
      let frame
      await wait(() => {
        frame = main.webContents.mainFrame.frames.find((f) => f.url.startsWith('sophon-visual:'))
        return !!frame
      }, 'live generated visual frame')
      await wait(
        () => frame.executeJavaScript('!!document.querySelector("input[type=range]")'),
        'live slider'
      )
      const beforeVisual = await frame.executeJavaScript('document.body.innerText')
      await frame.executeJavaScript(
        'const slider=document.querySelector("input[type=range]");slider.value="3";slider.dispatchEvent(new Event("input",{bubbles:true}))'
      )
      const afterVisual = await frame.executeJavaScript('document.body.innerText')
      assert.notEqual(afterVisual, beforeVisual, 'Slider must update visible output')
      assert.match(afterVisual, /12/)
      const chartPoint = async (desiredX) =>
        frame.executeJavaScript(
          `(()=>{const chart=document.querySelector('svg[tabindex]');chart.dispatchEvent(new KeyboardEvent('keydown',{key:'Home'}));for(let i=0;i<200;i++){const detail=document.querySelector('.sophon-chart-detail').textContent;if(Math.abs(parseFloat(detail)-${desiredX})<1e-8)return detail;chart.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))}throw new Error('Missing chart sample at x=${desiredX}')})()`
        )
      assert.match(await chartPoint(0), /:\s*0(?:\D|$)/, 'Curve must pass through x=0, y=0')
      assert.match(await chartPoint(2), /:\s*12(?:\D|$)/, 'Curve and metric must agree at x=2, a=3')
      assert.equal(
        await frame.executeJavaScript('typeof window.api+":"+typeof require'),
        'undefined:undefined'
      )
      await evaluate(
        `document.querySelector('iframe[src^="sophon-visual:"]').scrollIntoView({block:"center"})`
      )
      await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      await delay(250)
      fs.writeFileSync(
        path.join(output, 'live-generated-visual.png'),
        (
          await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG()
      )
      check(
        'loaded model generates a running quadratic slider; a=3 updates the displayed y(2) to 12 in the isolated renderer'
      )
    }
    if (!process.argv.includes('--browser-only') && !process.argv.includes('--reference-only')) {
      await evaluate('window.api.chats.create()')
      const existing = native
        .enumTopLevelWindows()
        .filter((h) => /notepad/i.test(native.getProcess(h).exe))
      await liveSend(
        'notepad-open',
        'Open Notepad and create a fresh blank document for this test. Leave any restored or existing documents untouched.'
      )
      let liveNotepad
      await wait(() => {
        liveNotepad = native
          .enumTopLevelWindows()
          .find(
            (h) =>
              !existing.includes(h) &&
              native.isVisible(h) &&
              /notepad/i.test(native.getProcess(h).exe) &&
              native.getTitle(h)
          )
        return !!liveNotepad
      }, 'model opens Notepad')
      ownedNotepads.add(liveNotepad)
      check('loaded model opens Notepad through open_app')
      const liveText = 'Sophon live model test 9137'
      await liveSend(
        'notepad-write',
        `In the Notepad window titled "${native.getTitle(liveNotepad)}", type exactly "${liveText}" into the blank editor. Verify the editor contains it. Do not save a file.`
      )
      let actual = await worker(
        { operation: 'inspect', hwnd: liveNotepad, pid: native.getProcess(liveNotepad).pid },
        new AbortController().signal
      )
      assert(
        actual.controls.some((c) => c.value.includes(liveText)),
        JSON.stringify(actual)
      )
      check('loaded model writes the requested Notepad text; independent editor readback matches')
      await liveSend(
        'notepad-delete',
        `Delete only the text you just wrote in the Notepad window titled "${native.getTitle(liveNotepad)}". Clear its editor and verify that it is empty. Leave the window open.`
      )
      actual = await worker(
        { operation: 'inspect', hwnd: liveNotepad, pid: native.getProcess(liveNotepad).pid },
        new AbortController().signal
      )
      assert(
        actual.controls.some((c) => ['Edit', 'Document'].includes(c.role) && !c.value.trim()),
        JSON.stringify(actual)
      )
      check('loaded model deletes its test text; independent readback confirms an empty editor')
      await liveSend(
        'notepad-close',
        `Close only the Notepad window titled "${native.getTitle(liveNotepad)}". It contains only the empty test document; discard that test document if asked. Verify that the window closed.`
      )
      await wait(
        () => !native.enumTopLevelWindows().includes(liveNotepad) || !native.isVisible(liveNotepad),
        'model closes Notepad'
      )
      ownedNotepads.delete(liveNotepad)
      check('loaded model closes its test Notepad, independently checked')
    }
    if (process.argv.includes('--browser')) {
      await evaluate('window.api.chats.create()')
      const chromeBefore = new Set(
        native.enumTopLevelWindows().filter((h) => /chrome\.exe/i.test(native.getProcess(h).exe))
      )
      await liveSend(
        'chrome-open',
        'Open Google Chrome, then create a new Chrome window with Ctrl+N reserved for this test. Leave existing browser tabs and windows untouched. Inspect the new window.'
      )
      let chrome
      await wait(() => {
        chrome = native
          .enumTopLevelWindows()
          .find(
            (h) =>
              !chromeBefore.has(h) &&
              native.isVisible(h) &&
              /chrome\.exe/i.test(native.getProcess(h).exe) &&
              native.getTitle(h)
          )
        return !!chrome
      }, 'new owned Chrome window')
      report.chrome = chrome
      check('loaded model opens a new Chrome window')
      await liveSend(
        'chrome-tab',
        `In the test Chrome window titled "${native.getTitle(chrome)}", open a new tab and navigate to https://en.wikipedia.org/wiki/Quadratic_equation . Inspect the loaded page. Leave other browser windows untouched.`
      )
      await wait(
        () => /quadratic equation/i.test(native.getTitle(chrome)),
        'Wikipedia title',
        30000
      )
      check('loaded model opens a new tab and navigates Chrome to Wikipedia')
      const observed = await liveSend(
        'chrome-understand',
        `Take a screenshot of the Chrome window titled "${native.getTitle(chrome)}" and tell me what you see and what the equation on the page means. Use the visible page as evidence.`
      )
      assert(observed.actions.some((a) => a.name === 'look_at_screen' && a.status === 'done'))
      assert.match(observed.text, /quadratic|second.degree|degree.two/i)
      await recordImage(observed, 'chrome-wikipedia.png')
      check('loaded model observes and explains the Wikipedia equation page')
      await liveSend(
        'chrome-close-tab',
        `Close only the Wikipedia tab you opened in the Chrome window titled "${native.getTitle(chrome)}" using Ctrl+W, then inspect the remaining test window. Leave all other windows and tabs untouched.`
      )
      await wait(() => !/quadratic equation/i.test(native.getTitle(chrome)), 'Wikipedia tab closes')
      check('loaded model closes only the Wikipedia tab')

      native.requestClose(chrome)
      await wait(() => !native.isVisible(chrome), 'owned browser cleanup')
      delete report.chrome
      await evaluate('window.api.updateSettings({research:{enabled:true,provider:"exa"}})')
      await evaluate('window.api.chats.create()')
      const research = await liveSend(
        'live-search',
        'Use web search to find the Wikipedia page on quadratic equations. Read the page if available, explain what a quadratic equation is briefly and include a clickable source. Ask whether I would like to see the page; do not open a browser without my answer.'
      )
      assert(research.actions.some((a) => a.name === 'web_search' && a.status === 'done'))
      assert(research.sources.length > 0)
      assert.match(research.text, /https:\/\//)
      assert(
        !research.actions.some((a) => ['open_app', 'type_text', 'press_keys'].includes(a.name))
      )
      check(
        'loaded model searches real web sources and cites them without unrequested browser actions'
      )
    }
  }
  report.ok = true
  saveReport()
  console.log('Evidence: ' + output)
}
review()
  .then(() => {
    fixture?.kill()
    if (report.chrome) native.requestClose(report.chrome)
    app.quit()
  })
  .catch((error) => {
    report.error = String(error.stack)
    saveReport()
    console.error(error)
    fixture?.kill()
    if (report.chrome) native.requestClose(report.chrome)
    for (const hwnd of ownedNotepads) native.requestClose(hwnd)
    app.exit(1)
  })
