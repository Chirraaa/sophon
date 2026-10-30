const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { load, root } = require('./security/load.cjs')
const worker = load('src/main/tools/automation/worker.ts', {
  child_process: { spawn },
  path,
  '../../security/worker-job': load('src/main/security/worker-job.ts', {
    koffi: { default: require('koffi') }
  }),
  '../../security/run-manager': { currentRun: () => null },
  '../../workflow/timing': { recordTiming: () => {} },
  './bridge.ps1?raw': {
    default: fs.readFileSync(path.join(root, 'src/main/tools/automation/bridge.ps1'), 'utf8')
  }
}).automationWorker
async function main() {
  const fixture = spawn(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, 'desktop-review/controls-fixture.ps1')
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  try {
    const identity = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture did not open')), 15000)
      let output = ''
      fixture.stdout.on('data', (data) => {
        output += data
        if (output.includes('\n')) {
          clearTimeout(timer)
          try {
            resolve(JSON.parse(output.trim()))
          } catch (error) {
            reject(error)
          }
        }
      })
      fixture.on('error', reject)
      fixture.stderr.on('data', (data) => {
        clearTimeout(timer)
        reject(new Error(String(data)))
      })
    })
    const signal = new AbortController().signal
    await new Promise((resolve) => setTimeout(resolve, 300))
    const inspect = () => worker({ ...identity, operation: 'inspect' }, signal)
    const act = (expected, action, text) =>
      worker({ ...identity, operation: 'act', expected, action, text }, signal)
    // The first request starts the persistent worker; later ones reuse it.
    let clock = performance.now()
    let view = await inspect()
    const cold = performance.now() - clock
    assert.equal(view.status, 'observed', JSON.stringify(view))
    clock = performance.now()
    for (let i = 0; i < 5; i++) assert.equal((await inspect()).status, 'observed')
    const warm = (performance.now() - clock) / 5
    assert(!JSON.stringify(view).includes('PASSWORD_CANARY'))
    assert(!view.controls.some((c) => c.name === 'Secret fixture'))
    const group = await worker(
      { ...identity, operation: 'inspect', query: 'Draft controls' },
      signal
    )
    assert(
      group.controls.some((c) => c.name === 'Draft message' && c.container === 'Draft controls')
    )
    assert(group.controls.some((c) => c.name === 'Apply draft' && c.container === 'Draft controls'))
    assert(!group.controls.some((c) => c.name === 'Fixture option'))
    assert.equal(group.scanLimit, 1200, 'Focused inspection has a larger bounded traversal')
    const page = await worker(
      { ...identity, operation: 'inspect', query: 'Draft controls', offset: 1 },
      signal
    )
    assert.deepEqual(
      page.controls.map((c) => c.runtime),
      group.controls.slice(1).map((c) => c.runtime)
    )
    const noMatch = await worker(
      { ...identity, operation: 'inspect', query: 'Missing fixture element' },
      signal
    )
    assert.equal(noMatch.diagnostic, 'no-match')
    assert.equal(noMatch.controls.length, 0)
    const field = view.controls.find((c) => c.name === 'Draft message')
    assert(field?.actions.includes('set_value'), JSON.stringify(view))
    assert.equal(
      (await act({ ...field, name: 'changed identity' }, 'set_value', 'wrong')).status,
      'failed'
    )
    const text = 'Bonjour — $(not executable); "quoted"'
    assert.equal((await act(field, 'set_value', text)).status, 'verified')
    assert.equal((await act(field, 'set_value', 'stale overwrite')).status, 'failed')
    view = await inspect()
    assert.equal(view.controls.find((c) => c.name === 'Draft message').value, text)
    const check = view.controls.find((c) => c.name === 'Fixture option')
    assert.equal((await act(check, 'toggle')).status, 'verified')
    view = await inspect()
    const button = view.controls.find((c) => c.name === 'Apply draft')
    assert.equal((await act(button, 'invoke')).status, 'reported')
    view = await inspect()
    assert(
      view.controls.some((c) => c.name === 'Applied: ' + text || c.value === 'Applied: ' + text),
      JSON.stringify(view)
    )
    const abort = new AbortController()
    const choice = view.controls.find(
      (c) => c.name === 'Choice two' && c.actions.includes('select')
    )
    assert(choice, 'Selection pattern missing')
    assert.equal((await act(choice, 'select')).status, 'verified')
    view = await inspect()
    const expander = view.controls.find(
      (c) => c.name === 'Fixture details' && c.actions.includes('expand')
    )
    assert(expander, 'Expand pattern missing')
    assert.equal((await act(expander, 'expand')).status, 'verified')
    view = await inspect()
    assert.equal(
      (
        await act(
          view.controls.find((c) => c.name === 'Fixture details' && c.actions.includes('collapse')),
          'collapse'
        )
      ).status,
      'verified'
    )
    view = await inspect()
    const scroll = view.controls.find(
      (c) => c.name === 'Fixture scroll' && c.actions.includes('scroll_down')
    )
    assert(scroll, 'Scroll pattern missing')
    assert.equal((await act(scroll, 'scroll_down')).status, 'verified')
    const pending = worker({ ...identity, operation: 'inspect' }, abort.signal)
    abort.abort()
    await assert.rejects(pending, /stopped|abort/i)
    console.log(
      'PASS real Windows UI Automation: named controls, Unicode field replacement/readback, stale identity/value rejection, toggle, selection, expand/collapse, scrolling, button invocation, password exclusion, cancellation; only isolated fixture app used'
    )
    console.log(
      `TIMING persistent worker inspect: first ${Math.round(cold)} ms (includes start), then ${Math.round(warm)} ms average`
    )
  } finally {
    fixture.kill()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
