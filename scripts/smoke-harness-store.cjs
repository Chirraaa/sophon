const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/harness-store-'))
let failure
const filesystem = {
  ...fs,
  writeFileSync(file, ...args) {
    if (failure === 'write' && file.endsWith('.tmp')) throw new Error('Injected manifest failure')
    return fs.writeFileSync(file, ...args)
  },
  renameSync(from, to) {
    if (failure === 'rename') throw new Error('Injected manifest failure')
    return fs.renameSync(from, to)
  }
}
const restart = () =>
  load('src/main/harness/store.ts', {
    electron: { app: { getPath: () => directory } },
    path,
    fs: filesystem,
    crypto,
    './python': {}
  })
const args = { category: 'skills', name: 'atomic-example' }
const original =
  '# Atomic example\nSource: fixture.\nApplies to: atomic updates.\nLimits: testing only.\nOriginal guidance.\n'
const replacement = original.replace('Original', 'Replacement')
const manifest = path.join(directory, 'harness/lifecycle/skills-atomic-example.json')
async function prepare(store, content, target = args) {
  await store.manageHarness({ ...target, action: 'propose', content })
  await store.manageHarness({ ...target, action: 'probe' })
}
async function main() {
  let store = restart()
  await prepare(store, original)
  await store.manageHarness({ ...args, action: 'compose' }, undefined, original)
  for (let i = 0; i < 3; i++)
    store.recordHarnessUse(args.category, args.name, `run-${i}`, true, 'Passed')
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'active')
  for (const fault of ['write', 'rename']) {
    await prepare(store, replacement)
    const before = fs.readFileSync(manifest, 'utf8')
    failure = fault
    await assert.rejects(
      store.manageHarness({ ...args, action: 'compose' }, undefined, replacement),
      /Injected/
    )
    failure = undefined
    store = restart()
    assert.equal(fs.readFileSync(manifest, 'utf8'), before)
    assert.equal(store.readHarness(args.category, args.name, true), original)
    assert.equal(store.harnessLifecycle(args.category, args.name).state, 'active')
  }
  await prepare(store, replacement)
  await store.manageHarness({ ...args, action: 'compose' }, undefined, replacement)
  assert.equal(store.readHarness(args.category, args.name), replacement)
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'trial')
  assert.equal(store.harnessLifecycle(args.category, args.name).successes, 0)
  failure = 'rename'
  await assert.rejects(store.manageHarness({ ...args, action: 'archive' }), /Injected/)
  failure = undefined
  store = restart()
  assert.equal(store.readHarness(args.category, args.name), replacement)
  await store.manageHarness({ ...args, action: 'archive' })
  failure = 'write'
  await assert.rejects(store.manageHarness({ ...args, action: 'rollback' }), /Injected/)
  failure = undefined
  store = restart()
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'deprecated')
  await store.manageHarness({ ...args, action: 'rollback' })
  assert.equal(store.harnessLifecycle(args.category, args.name).state, 'trial')
  const saved = fs.readFileSync(manifest, 'utf8')
  const metadata = JSON.parse(saved)
  const version = path.join(
    directory,
    'harness/versions',
    `skills-${args.name}-${metadata.version}-${metadata.content.hash}.md`
  )
  fs.writeFileSync(version, original)
  assert.throws(() => restart().readHarness(args.category, args.name), /hash/)
  fs.writeFileSync(version, replacement)
  fs.writeFileSync(manifest, JSON.stringify({ ...metadata, version: metadata.version + 1 }))
  assert.throws(() => restart().readHarness(args.category, args.name), /manifest/)
  fs.writeFileSync(manifest, saved)
  fs.unlinkSync(version)
  assert.throws(() => restart().readHarness(args.category, args.name), /Missing/)
  fs.writeFileSync(version, replacement)
  fs.unlinkSync(manifest)
  assert.throws(() => restart().readHarness(args.category, args.name), /manifest/)
  assert.throws(() => restart().inspectHarness(), /manifest/)
  fs.writeFileSync(manifest, saved)
  const fresh = { category: 'skills', name: 'fresh-example' }
  store = restart()
  await prepare(store, original, fresh)
  failure = 'rename'
  await assert.rejects(
    store.manageHarness({ ...fresh, action: 'compose' }, undefined, original),
    /Injected/
  )
  failure = undefined
  store = restart()
  assert.equal(store.harnessLifecycle(fresh.category, fresh.name).state, 'candidate')
  assert.throws(() => store.readHarness(fresh.category, fresh.name, true), /inactive/)
  assert(!store.inspectHarness().documents.includes('skills/fresh-example.md'))
  fs.writeFileSync(path.join(directory, 'harness/skills/legacy.md'), replacement)
  const legacy = path.join(directory, 'harness/lifecycle/skills-legacy.json')
  fs.writeFileSync(
    legacy,
    JSON.stringify({
      state: 'active',
      version: 4,
      successes: 3,
      failures: 0,
      uses: 3,
      evidence: [],
      runs: []
    })
  )
  assert.equal(restart().harnessLifecycle('skills', 'legacy').state, 'trial')
  fs.writeFileSync(path.join(directory, 'harness/skills/unbound.md'), replacement)
  assert.equal(restart().harnessLifecycle('skills', 'unbound').state, 'trial')
  // Recall must reject missing manifests even when a legacy starter file still exists.
  fs.writeFileSync(path.join(directory, 'harness/loop-hooks/before-task.md'), replacement)
  fs.unlinkSync(path.join(directory, 'harness/lifecycle/loop-hooks-before-task.json'))
  assert.throws(() => restart().harnessContext('atomic updates', 'before_task'), /manifest/)
  console.log(
    'PASS atomic procedure commits, failed writes/renames, restart recovery, archive/rollback, corruption rejection and legacy trial migration'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
