const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { load, root } = require('./security/load.cjs')
const registry = load('src/main/tools/registry.ts')
const schemas = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const { validateToolArguments } = load('src/main/security/tool-contracts.ts', {
  '../tools/schemas': schemas
})
const { assessResult, MUTATIONS } = load('src/main/workflow/results.ts')
for (const tool of ['set_volume', 'set_radio']) assert(MUTATIONS.has(tool))
assert.equal(
  assessResult('set_volume', { volume: 30 }, JSON.stringify({ verified: true, volume: 30 })).status,
  'verified'
)
assert.equal(
  assessResult('set_volume', { volume: 30 }, JSON.stringify({ verified: true, volume: 80 })).status,
  'uncertain'
)
assert.equal(
  assessResult('set_radio', { enabled: true }, JSON.stringify({ verified: false, state: 'Off' }))
    .status,
  'uncertain'
)
assert.equal(
  assessResult('set_radio', { enabled: true }, JSON.stringify({ verified: true, state: 'On' }))
    .status,
  'verified'
)
for (const name of ['list_audio', 'set_volume', 'list_radios', 'set_radio']) {
  assert(registry.isKnownTool(name))
  assert.equal(registry.defaultToolPermissions()[name], 'ask')
}
for (const args of [
  {},
  { volume: -1 },
  { volume: 101 },
  { volume: NaN },
  { muted: 'yes' },
  { volume: 10, target: '' },
  { volume: 10, command: 'bad' }
])
  assert.throws(() => validateToolArguments('set_volume', args))
for (const args of [
  { kind: 'ethernet', enabled: true },
  { kind: 'wifi' },
  { kind: 'wifi', enabled: 'true' }
])
  assert.throws(() => validateToolArguments('set_radio', args))
validateToolArguments('set_volume', { volume: 0, muted: false })
validateToolArguments('set_volume', { volume: 100 })
validateToolArguments('set_radio', { kind: 'wifi', enabled: false })

const run = { signal: new AbortController().signal }
let blocked = false
let cancelled = false
let mismatch = false
let audio = [
  { endpoint: 'speakers', session: '', name: 'system', pid: 0, volume: 50, muted: false },
  {
    endpoint: 'speakers',
    session: 'session-1',
    name: 'spotify.exe',
    pid: 123,
    volume: 30,
    muted: false
  }
]
let radios = [
  { name: 'Wireless', kind: 'WiFi', state: 'On' },
  { name: 'Bluetooth', kind: 'Bluetooth', state: 'Off' }
]
const requests = []
const controls = load('src/main/tools/system-control.ts', {
  crypto,
  './system-control-worker': {
    systemControlWorker: async (request) => {
      requests.push(request)
      if (request.operation === 'audio') return { ok: true, items: audio }
      if (request.operation === 'radios') return { ok: true, items: radios }
      if (request.operation === 'volume') {
        const row = audio.find(
          (r) => r.endpoint === request.endpoint && r.session === request.session
        )
        if (!mismatch) {
          if (request.volume !== undefined) row.volume = request.volume
          if (request.muted !== undefined) row.muted = request.muted
        }
        return { ok: true, items: [row] }
      }
      if (request.operation === 'radio')
        return { ok: true, items: [{ ...radios[0], state: 'Disabled' }] }
      throw new Error('Unexpected operation')
    }
  },
  '../security/run-manager': {
    assertRun: () => {
      if (cancelled) throw new Error('cancelled')
    }
  },
  '../permissions': { blockedAppRule: () => blocked, protectedWindowRule: () => false },
  './windows': { listWindows: () => [] }
})

async function main() {
  const listed = JSON.parse(await controls.listAudio(run))
  assert.equal(listed[0].target, 'system')
  assert.match(listed[1].target, /^audio-[a-f0-9]{24}$/)
  assert(!JSON.stringify(listed).includes('session-1'))
  const target = await controls.prepareDeviceTarget('set_volume', { target: 'spotify' }, run)
  assert.equal(
    (await controls.prepareDeviceTarget('set_volume', { target: listed[1].target }, run)).session,
    target.session
  )
  const result = JSON.parse(await controls.setDevice({ volume: 0, muted: true }, target, run))
  assert.equal(result.verified, true)
  assert.equal(result.volume, 0)
  assert.equal(result.muted, true)
  await controls.setDevice({ volume: 25 }, target, run)
  assert.equal(audio[1].muted, true, 'Setting volume preserves mute')
  mismatch = true
  assert.match(await controls.setDevice({ volume: 80 }, target, run), /did not confirm/)
  mismatch = false
  audio.push({ ...audio[1], session: 'session-2' })
  await assert.rejects(
    controls.prepareDeviceTarget('set_volume', { target: 'spotify' }, run),
    /ambiguous/
  )
  audio.pop()
  blocked = true
  assert.equal(JSON.parse(await controls.listAudio(run)).length, 1)
  await assert.rejects(controls.setDevice({ muted: false }, target, run), /protected/)
  blocked = false
  audio[1] = { ...audio[1], session: 'replacement-session' }
  const count = requests.filter((r) => r.operation === 'volume').length
  await assert.rejects(controls.setDevice({ volume: 80 }, target, run), /changed/)
  assert.equal(requests.filter((r) => r.operation === 'volume').length, count)
  const radio = await controls.prepareDeviceTarget(
    'set_radio',
    { kind: 'wifi', enabled: true },
    run
  )
  assert.equal(JSON.parse(await controls.setDevice({ enabled: true }, radio, run)).verified, false)
  radios.push({ name: 'USB wireless', kind: 'WiFi', state: 'Off' })
  await assert.rejects(
    controls.prepareDeviceTarget('set_radio', { kind: 'wifi' }, run),
    /ambiguous/
  )
  assert.equal(
    (await controls.prepareDeviceTarget('set_radio', { kind: 'wifi', name: 'USB wireless' }, run))
      .name,
    'USB wireless'
  )
  radios = []
  await assert.rejects(controls.setDevice({ enabled: false }, radio, run), /changed/)
  cancelled = true
  await assert.rejects(controls.listAudio(run), /cancelled/)

  if (process.argv.includes('--native')) {
    const program = fs.readFileSync(path.join(root, 'src/main/tools/system-control.ps1'), 'utf8')
    const job = load('src/main/security/worker-job.ts', { koffi: { default: require('koffi') } })
    const { systemControlWorker } = load('src/main/tools/system-control-worker.ts', {
      child_process: require('node:child_process'),
      path,
      '../security/worker-job': job,
      './system-control.ps1?raw': { default: program }
    })
    const native = async (request) => {
      const response = await systemControlWorker(request, new AbortController().signal)
      assert.equal(response.ok, true, response.error)
      return response.items
    }
    const rows = await native({ operation: 'audio' })
    assert(rows.some((r) => r.session === ''))
    const wireless = await native({ operation: 'radios' })
    assert(wireless.every((r) => ['WiFi', 'Bluetooth'].includes(r.kind)))

    for (const row of [rows.find((r) => !r.session), rows.find((r) => r.session && r.pid)]) {
      if (!row) continue
      const [after] = await native({
        operation: 'volume',
        endpoint: row.endpoint,
        session: row.session,
        volume: row.volume,
        muted: row.muted
      })
      assert(Math.abs(after.volume - row.volume) < 1)
      assert.equal(after.muted, row.muted)
    }
    console.log(
      `PASS native audio discovery, system/app setters with unchanged values, and radio discovery (${wireless.length} radios); radios unchanged`
    )
  }
  console.log(
    'PASS device tool registration, argument bounds, exact audio/radio targets, stale targets, blocked apps, cancellation, mute preservation and read-back failures'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
