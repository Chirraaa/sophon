const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/harness-rollback-'))
let failure
const filesystem = {
  ...fs,
  writeFileSync(file, ...args) {
    if (
      (failure === 'write' && file.endsWith('.tmp')) ||
      (failure === 'snapshot' && file.includes('revisions') && file.endsWith('.json'))
    )
      throw new Error('Injected rollback failure')
    return fs.writeFileSync(file, ...args)
  },
  renameSync(from, to) {
    if (failure === 'rename') throw new Error('Injected rollback failure')
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
let store = restart()
const category = 'skills'
const original =
  '# Rollback example\nSource: deterministic fixture.\nApplies to: procedure rollback.\nLimits: testing only.\nAccepted guidance.\n'
const replacement = original.replace('Accepted', 'Replacement')
const entry = (name) => store.harnessLifecycle(category, name)
const record = (name, run, success, version = entry(name).version) =>
  store.recordHarnessUse(category, name, run, success, success ? 'Passed' : 'Failed', version)
const action = (name, action) => store.manageHarness({ category, name, action })
async function prepare(name, content) {
  await store.manageHarness({ category, name, action: 'propose', content })
  await action(name, 'probe')
}
async function compose(name, content = original) {
  await prepare(name, content)
  await store.manageHarness({ category, name, action: 'compose' }, undefined, content)
  return entry(name).version
}
async function accept(name, content = original) {
  await compose(name, content)
  for (let i = 0; i < 3; i++) record(name, `accepted-${i}`, true)
  return entry(name)
}
function snapshotPath(reference, name) {
  return path.join(
    directory,
    'harness/revisions',
    `${category}-${name}-${reference.version}-${reference.hash}.json`
  )
}
function metadataWithoutSequence(value) {
  const copy = { ...value }
  delete copy.latestVersion
  return copy
}
async function main() {
  const accepted = await accept('failed-trial')
  await compose('failed-trial', replacement)
  record('failed-trial', 'bad-trial', false)
  assert.equal(entry('failed-trial').state, 'candidate')
  store = restart()
  const manifest = path.join(directory, 'harness/lifecycle/skills-failed-trial.json')
  const before = fs.readFileSync(manifest, 'utf8')
  for (const fault of ['write', 'rename']) {
    failure = fault
    await assert.rejects(action('failed-trial', 'rollback'), /Injected/)
    failure = undefined
    store = restart()
    assert.equal(fs.readFileSync(manifest, 'utf8'), before)
    assert.equal(store.readHarness(category, 'failed-trial'), replacement)
    assert.equal(entry('failed-trial').state, 'candidate')
  }
  assert.match(await action('failed-trial', 'rollback'), /accepted v1/)
  store = restart()
  assert.equal(store.readHarness(category, 'failed-trial', true), original)
  assert.deepEqual(
    metadataWithoutSequence(entry('failed-trial')),
    metadataWithoutSequence(accepted)
  )
  assert(store.harnessContext('procedure rollback', 'before_task').includes('Accepted guidance.'))
  await assert.rejects(action('failed-trial', 'rollback'), /No previous accepted/)
  await assert.rejects(
    store.manageHarness(
      { category, name: 'failed-trial', action: 'compose' },
      undefined,
      replacement
    ),
    /passing probe/
  )
  assert.equal(
    await compose('failed-trial', replacement),
    3,
    'Rejected version numbers must not be reused'
  )
  record('failed-trial', 'stale-run', false, 2)
  assert.equal(entry('failed-trial').uses, 0)
  // Replacing multiple unproven trials keeps the last accepted version available.
  await compose('failed-trial', replacement + '\nAnother trial.\n')
  assert.equal(entry('failed-trial').previousAccepted.version, 1)
  await action('failed-trial', 'rollback')
  assert.equal(entry('failed-trial').version, 1)
  assert.equal(entry('failed-trial').latestVersion, 4)
  assert.deepEqual(entry('failed-trial').outcomes, accepted.outcomes)
  // A successful replacement becomes the next rollback target with its own evidence.
  await accept('latest-accepted')
  await compose('latest-accepted', replacement)
  for (let i = 0; i < 3; i++) record('latest-accepted', `new-accepted-${i}`, true)
  const latest = entry('latest-accepted')
  assert.equal(latest.state, 'trial', 'A recovery point is not usefulness promotion')
  await compose('latest-accepted', replacement + '\nThird version.\n')
  record('latest-accepted', 'third-failed', false)
  await action('latest-accepted', 'rollback')
  const restored = entry('latest-accepted')
  assert.equal(restored.version, 2)
  assert.equal(restored.state, 'trial')
  assert.equal(restored.failures, latest.failures)
  assert.deepEqual(restored.outcomes, latest.outcomes)
  assert.deepEqual(restored.evidence, latest.evidence)
  assert.equal(store.readHarness(category, 'latest-accepted'), replacement)
  await compose('unproven')
  await compose('unproven', replacement)
  record('unproven', 'failed', false)
  await assert.rejects(action('unproven', 'rollback'), /No previous accepted/)
  // Archival rollback still restores that entry's actual lifecycle, including trial.
  await compose('archived')
  await action('archived', 'archive')
  await action('archived', 'rollback')
  assert.equal(entry('archived').state, 'trial')
  assert.equal(store.readHarness(category, 'archived'), original)
  // Starter guidance is an accepted v0 and can be restored without earning fake uses.
  const seed = store.readHarness('skills', 'learning')
  await compose('learning', replacement)
  await action('learning', 'rollback')
  assert.equal(entry('learning').version, 0)
  assert.equal(store.readHarness('skills', 'learning', true), seed)
  await accept('snapshot-failure')
  await prepare('snapshot-failure', replacement)
  const old = entry('snapshot-failure')
  failure = 'snapshot'
  await assert.rejects(
    store.manageHarness(
      { category, name: 'snapshot-failure', action: 'compose' },
      undefined,
      replacement
    ),
    /Injected/
  )
  failure = undefined
  assert.deepEqual(entry('snapshot-failure'), old)
  assert.equal(store.readHarness(category, 'snapshot-failure', true), original)
  // Recovery verifies both accepted metadata and the immutable content it names.
  await accept('corruption')
  await compose('corruption', replacement)
  const current = entry('corruption')
  const snapshot = snapshotPath(current.previousAccepted, 'corruption')
  const saved = fs.readFileSync(snapshot, 'utf8')
  fs.writeFileSync(snapshot, saved.replace('"state":"trial"', '"state":"active"'))
  assert.throws(() => restart().harnessLifecycle(category, 'corruption'), /hash/)
  await assert.rejects(action('corruption', 'rollback'), /hash/)
  fs.unlinkSync(snapshot)
  assert.throws(() => restart().harnessLifecycle(category, 'corruption'), /Missing accepted/)
  fs.writeFileSync(snapshot, saved)
  const previous = JSON.parse(saved).lifecycle
  const contentPath = path.join(
    directory,
    'harness/versions',
    `skills-corruption-${previous.version}-${previous.content.hash}.md`
  )
  fs.writeFileSync(contentPath, replacement)
  assert.throws(() => restart().harnessLifecycle(category, 'corruption'), /content hash/)
  fs.writeFileSync(contentPath, original)
  await action('corruption', 'rollback')
  assert.equal(entry('corruption').state, 'trial')
  console.log(
    'PASS failed-trial rollback, exact accepted content/lifecycle/evidence, restart, atomic failures, monotonic versions, trial safety, archive compatibility and corrupt recovery rejection'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
