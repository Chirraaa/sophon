const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.cache/model-insights')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let settings
let manageUsage = 0
let info = {
  id: 'gpt-6.1-sol',
  label: 'GPT-6.1 Sol',
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  reasoningSource: 'provider',
  defaultReasoningEffort: 'medium',
  contextWindow: 200000,
  contextSource: 'provider'
}
const context = {
  estimatedInputTokens: 38000,
  estimatedTotalTokens: 40000,
  inputBudget: null,
  reservedOutputTokens: 0,
  contextWindow: 200000,
  windowSource: 'provider',
  model: info.id,
  provider: 'chatgpt',
  measuredAt: Date.now(),
  droppedTurns: 2,
  memories: [{ id: 'one', title: 'Project preference' }],
  playbooks: ['coding'],
  guidance: ['Review guide'],
  availableTools: ['read_file'],
  breakdown: [
    { category: 'instructions', tokens: 8000 },
    { category: 'history', tokens: 12000 },
    { category: 'request', tokens: 4000 },
    { category: 'attachments', tokens: 6000 },
    { category: 'memories', tokens: 1000 },
    { category: 'toolResults', tokens: 7000 },
    { category: 'tools', tokens: 2000 }
  ]
}
const usage = {
  calls: 3,
  reportedCalls: 2,
  inputTokens: 60000,
  outputTokens: 8000,
  totalTokens: 68000,
  cachedInputTokens: 40000,
  reasoningTokens: 6000,
  cachedReportedCalls: 2,
  reasoningReportedCalls: 2
}
let state = {
  chatId: 'insights-fixture',
  mode: 'assistant',
  busy: false,
  chats: [{ id: 'insights-fixture', title: 'Project insights', updatedAt: Date.now() }],
  items: [
    {
      id: 'answer',
      from: 'agent',
      text: 'Your changes are ready.',
      pending: false,
      actions: [],
      context,
      usage
    }
  ]
}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel === 'settings:get') {
      settings ??= {
        ...(await listener(...args)),
        profile: { ...(await listener(...args)).profile, onboardingComplete: true },
        model: {
          ...(await listener(...args)).model,
          provider: 'chatgpt',
          endpoint: 'https://api.openai.com/v1',
          modelId: info.id,
          reasoningEffort: 'medium'
        }
      }
      return settings
    }
    if (channel === 'settings:update') {
      settings = { ...settings, model: { ...settings.model, ...args[1].model } }
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('settings:changed', settings)
      return { ok: true, settings }
    }
    if (channel === 'session:get') return state
    if (channel === 'llm:status') return { online: true, model: info.id }
    if (channel === 'llm:modelInfo') return info
    if (channel === 'llm:model-choices') return [info]
    if (channel === 'chatgpt:status')
      return {
        activeId: 'fixture',
        pending: false,
        welcome: false,
        accounts: [
          {
            id: 'fixture',
            email: 'fixture@example.test',
            label: 'Test',
            signedIn: true,
            planEnabled: true
          }
        ]
      }
    if (channel === 'chatgpt:usage') {
      manageUsage++
      return
    }
    return listener(...args)
  })
require(path.join(root, 'out/main/index.js'))
async function wait(check, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await check()) return
    await delay(50)
  }
  throw new Error('Timed out: ' + label)
}
async function review() {
  await app.whenReady()
  await wait(() => BrowserWindow.getAllWindows().length === 2, 'windows')
  const main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  const compact = BrowserWindow.getAllWindows().find((win) => !win.isResizable())
  const evaluate = (win, code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error('Renderer evaluation failed: ' + code, { cause: error })
    })
  const click = (win, label) =>
    evaluate(win, `document.querySelector('[aria-label="${label}"]').click()`)
  const capture = async (name) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        await delay(300)
        fs.writeFileSync(
          path.join(output, name + '.png'),
          (
            await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          ).toPNG()
        )
        return
      } catch (error) {
        if (attempt >= 3 || !String(error).includes('UnknownVizError')) throw error
        await delay(300)
      }
    }
  }
  for (const win of [main, compact]) {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await wait(
      () => evaluate(win, `!!document.querySelector('[aria-label="Reasoning effort"]')`),
      'effort control'
    )
    await click(win, 'Reasoning effort')
    await wait(
      () => evaluate(win, 'document.querySelectorAll("[role=option]").length === 6'),
      'six effort choices'
    )
    assert(
      await evaluate(
        win,
        'document.body.innerText.includes("Extra high effort") && document.body.innerText.includes("Maximum effort")'
      )
    )
    await evaluate(
      win,
      'Array.from(document.querySelectorAll("[role=option]")).find(el=>el.textContent.includes("Maximum effort")).click()'
    )
    await wait(() => settings.model.reasoningEffort === 'max', 'saved max effort')
    await click(win, 'Context and usage')
    await wait(
      () => evaluate(win, '!!document.querySelector("[role=dialog] [data-context-details]")'),
      'context dialog'
    )
    assert.equal(
      await evaluate(
        win,
        'document.querySelector("[role=dialog] [role=progressbar]").getAttribute("aria-valuenow")'
      ),
      '20'
    )
    assert(
      await evaluate(win, 'document.querySelector("[role=dialog]").innerText.includes("30.0%")')
    )
    assert(
      await evaluate(win, 'document.querySelector("[role=dialog]").innerText.includes("68,000")')
    )
    assert(
      await evaluate(win, 'document.querySelector("[role=dialog]").innerText.includes("2/3 calls")')
    )
    if (win === main) await capture('context-and-usage')
    await evaluate(
      win,
      'Array.from(document.querySelectorAll("[role=dialog] button")).find(el=>el.textContent.trim()==="Manage usage").click()'
    )
    await click(win, 'Close context and usage')
    await wait(() => evaluate(win, '!document.querySelector("[role=dialog]")'), 'close dialog')
  }
  assert.equal(manageUsage, 2)
  info = { id: 'unknown-model', label: 'Unknown model' }
  settings = { ...settings, model: { ...settings.model, modelId: 'unknown-model' } }
  for (const win of [main, compact]) win.webContents.send('settings:changed', settings)
  await wait(
    () =>
      evaluate(
        main,
        `document.querySelector('[aria-label="Reasoning effort"]').textContent.includes('Auto effort')`
      ),
    'unsupported saved effort falls back'
  )
  await click(main, 'Reasoning effort')
  await wait(
    () => evaluate(main, 'document.querySelectorAll("[role=option]").length===1'),
    'unknown model only Auto'
  )
  await evaluate(main, 'document.querySelector("[role=option]").click()')
  state = {
    ...state,
    items: [
      {
        ...state.items[0],
        context: { ...context, contextWindow: null, windowSource: 'unknown' },
        usage: { ...usage, calls: 1, reportedCalls: 0 }
      }
    ]
  }
  main.webContents.send('session:update', state)
  await click(main, 'Context and usage')
  await wait(
    () =>
      evaluate(
        main,
        'document.querySelector("[role=dialog]")?.innerText.includes("capacity unavailable")'
      ),
    'unknown capacity explained'
  )
  assert.equal(
    await evaluate(main, 'document.querySelectorAll("[role=dialog] [role=progressbar]").length'),
    0
  )
  assert(
    await evaluate(
      main,
      'document.querySelector("[role=dialog]").innerText.includes("has not reported token counts")'
    )
  )
  await click(main, 'Close context and usage')
  state = { ...state, chatId: 'empty-chat', items: [] }
  main.webContents.send('session:update', state)
  await click(main, 'Context and usage')
  await wait(
    () =>
      evaluate(
        main,
        'document.querySelector("[role=dialog]")?.innerText.includes("Send a message")'
      ),
    'empty chat resets context'
  )
  await click(main, 'Close context and usage')
  await evaluate(
    main,
    'Array.from(document.querySelectorAll("nav button")).find(el=>el.textContent==="Settings").click()'
  )
  await evaluate(
    main,
    'Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent==="Model").click()'
  )
  await evaluate(
    main,
    'Array.from(document.querySelectorAll("[role=tab]")).find(el=>el.textContent==="Generation").click()'
  )
  await wait(
    () =>
      evaluate(main, `!!document.querySelector('[role=tabpanel] [aria-label="Reasoning effort"]')`),
    'settings effort'
  )
  await click(main, 'Reasoning effort')
  await wait(
    () => evaluate(main, 'document.querySelectorAll("[role=option]").length===1'),
    'settings also filters unsupported effort'
  )
  console.log(
    'PASS full/compact effort choices and persistence, context percentages, token subsets, partial usage, plan management link, unknown capacity/model, empty-chat reset, settings parity; no real account calls'
  )
}
review()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
