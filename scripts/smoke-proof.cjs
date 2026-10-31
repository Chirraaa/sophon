// Proof harness: failure fingerprints, the verification contract and its witnesses, the
// convergence governor, run-scoped check grants, falsifier probe intake, probe files, and
// the whole proof loop driven through the real chat loop with a scripted model.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { load } = require('./security/load.cjs')

const fingerprint = load('src/main/workflow/proof/fingerprint.ts', { crypto })
const contractModule = load('src/main/workflow/proof/contract.ts', { crypto })
const governorModule = load('src/main/workflow/proof/governor.ts')
const falsifier = load('src/main/workflow/proof/falsifier.ts', {
  './contract': contractModule
})
const grants = load('src/main/security/grants.ts')
const budgetsModule = load('src/main/workflow/loop-budgets.ts')
const limits = load('src/shared/loop-limits.ts')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sophon-proof-'))
const probeFiles = load('src/main/workflow/proof/probe-files.ts', {
  electron: { app: { getPath: () => path.join(scratch, 'user-data') } },
  crypto,
  fs,
  path
})
fs.mkdirSync(path.join(scratch, 'user-data'))

function fingerprints() {
  const a = fingerprint.failureFingerprint(
    [
      'src/sum.ts(12,5): error TS2322: Type string is not assignable to type number.',
      'FAIL test/sum.test.js (35 ms)',
      '  ✗ adds numbers (4 ms)',
      'Tests: 1 failed, 3 passed',
      'Done in 2.31s'
    ].join('\n'),
    'M:\\Project'
  )
  const moved = fingerprint.failureFingerprint(
    [
      'src/sum.ts(14,5): error TS2322: Type string is not assignable to type number.',
      'FAIL test/sum.test.js (51 ms)',
      '  ✗ adds numbers (9 ms)',
      'Tests: 1 failed, 3 passed',
      'Done in 4.02s'
    ].join('\n')
  )
  assert.equal(a.key, moved.key, 'Line numbers and durations do not change the failure identity')
  assert(
    a.signals.some((signal) => signal.includes('ts2322')),
    'Diagnostic codes survive'
  )
  assert(a.paths.includes('src/sum.ts') && a.paths.includes('test/sum.test.js'))
  const other = fingerprint.failureFingerprint(
    'src/sum.ts(12,5): error TS2339: Property total does not exist.'
  )
  assert.notEqual(other.key, a.key, 'A different diagnostic is a different failure')
  assert.equal(
    fingerprint.failureFingerprint('Tests: 4 failed, 1 passed\nAssertionError: x').count,
    4,
    'Summary counts estimate how much is failing'
  )
  const silent = fingerprint.failureFingerprint('')
  assert.equal(silent.count, 1)
  assert.equal(
    fingerprint.commandText(JSON.stringify({ exitCode: 1, output: { content: 'boom' } })),
    'boom'
  )
  assert.equal(fingerprint.commandText('plain'), 'plain')
  console.log('PASS fingerprints: stable across moved lines and timings, codes, counts, paths')
}

const red = (key = 'k1', count = 1, signals = ['assertionerror: expected #']) => ({
  key,
  signals,
  count,
  paths: []
})

function contracts() {
  const { ProofContract, validProofState, probeSpecIssue } = contractModule
  const proof = new ProofContract()
  const claims = [
    { id: 'c-sum', text: 'sum([1,2,3]) returns 6', kind: 'behavior' },
    { id: 'c-tests', text: 'Existing tests still pass', kind: 'guard' },
    { id: 'c-look', text: 'The page looks tidy', kind: 'manual' }
  ]
  for (const [input, pattern] of [
    [{ claims, probes: [{ id: 'p', claim: 'c-none', command: 'x' }] }, /unknown claim/],
    [{ claims, probes: [{ id: 'p', claim: 'c-look', command: 'x' }] }, /manual/],
    [
      {
        claims,
        probes: [
          { id: 'p', claim: 'c-sum', command: 'x', script: { language: 'node', source: 'x' } }
        ]
      },
      /exactly one/
    ],
    [
      { claims, probes: [{ id: 'p', claim: 'c-sum', command: 'x', path: '../out' }] },
      /workspace-relative/
    ],
    [
      { claims, probes: [{ id: 'p', claim: 'c-sum', command: 'x', files: ['C:\\x.js'] }] },
      /workspace-relative/
    ],
    [{ claims: [{ id: 'Bad Id', text: 'x', kind: 'behavior' }] }, /id slug/],
    [{ withdraw: [{ id: 'c-sum', reason: 'short' }] }, /Explain why/]
  ])
    assert.throws(() => proof.submit(input, 0), pattern)
  assert(!proof.hasClaims, 'A rejected submission changes nothing')
  assert.equal(
    probeSpecIssue({ id: 'p', claim: 'c', command: 'x', timeout_seconds: 0 }) !== undefined,
    true
  )

  const changed = proof.submit(
    {
      claims,
      probes: [
        { id: 'p-sum', claim: 'c-sum', command: 'node probe.js', files: ['probe.js'] },
        { id: 'p-tests', claim: 'c-tests', command: 'npm test' }
      ]
    },
    0
  )
  assert.deepEqual(
    changed.map((probe) => probe.id),
    ['p-sum', 'p-tests']
  )
  const sum = () => proof.probe('p-sum')
  assert.equal(proof.probeStatus(sum(), 0), 'unapproved')
  assert.match(proof.openIssue(0), /not approved/)
  proof.approve(['p-sum', 'p-tests'])
  assert.deepEqual(
    proof.pending(0).map((probe) => probe.id),
    ['p-sum', 'p-tests']
  )
  proof.observe('p-sum', {
    revision: 0,
    exitCode: 1,
    passed: false,
    deps: 'd1',
    fingerprint: red()
  })
  proof.observe('p-tests', {
    revision: 0,
    exitCode: 0,
    passed: true,
    deps: 'd0',
    fingerprint: red()
  })
  assert.equal(proof.probeStatus(sum(), 0), 'red')
  assert.match(proof.openIssue(0), /p-sum \(claim c-sum\) fails: assertionerror/)
  assert.equal(proof.probeStatus(sum(), 1), 'stale', 'A code change makes evidence stale')
  proof.observe('p-sum', { revision: 1, exitCode: 0, passed: true, deps: 'd1', fingerprint: red() })
  proof.observe('p-tests', {
    revision: 1,
    exitCode: 0,
    passed: true,
    deps: 'd0',
    fingerprint: red()
  })
  assert.deepEqual(proof.witness(sum()), { red: 0, green: 1 })
  assert.equal(proof.claimStatus(proof.claim('c-sum'), 1), 'witnessed')
  assert.equal(proof.claimStatus(proof.claim('c-tests'), 1), 'held')
  assert.equal(proof.claimStatus(proof.claim('c-look'), 1), 'manual')
  assert.equal(proof.openIssue(1), undefined)
  assert.match(
    proof.report(1),
    /c-sum: sum\(\[1,2,3\]\) returns 6 — witnessed \(p-sum red at r0 → green at r1\)/
  )
  assert.match(proof.report(1), /c-look: .* — manual check, not automated/)

  // A test edited between its failing and passing runs is not a witness.
  const edited = new ProofContract()
  edited.submit({ claims: [claims[0]], probes: [{ id: 'p', claim: 'c-sum', command: 't' }] }, 0)
  edited.approve(['p'])
  edited.observe('p', {
    revision: 0,
    exitCode: 1,
    passed: false,
    deps: 'before',
    fingerprint: red()
  })
  edited.observe('p', { revision: 2, exitCode: 0, passed: true, deps: 'after', fingerprint: red() })
  assert.equal(edited.witness(edited.probe('p')), undefined)
  assert.equal(edited.claimStatus(edited.claim('c-sum'), 2), 'unwitnessed')
  assert.match(edited.report(2), /test files changed after it failed/)
  assert.deepEqual(
    edited.unwitnessed(2).map((claim) => claim.id),
    ['c-sum']
  )

  // Redefining a probe resets its history; withdrawals need a reason and are reported.
  const redefined = proof.submit(
    { probes: [{ id: 'p-sum', claim: 'c-sum', command: 'node probe.js --strict' }] },
    1
  )
  assert.equal(redefined.length, 1)
  assert.equal(proof.probe('p-sum').history.length, 0)
  assert.equal(proof.probe('p-sum').approved, false)
  assert.equal(
    proof.submit({ probes: [{ id: 'p-tests', claim: 'c-tests', command: 'npm test' }] }, 1).length,
    0,
    'An identical probe is unchanged'
  )
  proof.submit({ withdraw: [{ id: 'c-look', reason: 'No browser is available to judge it' }] }, 1)
  assert.equal(proof.claimStatus(proof.claim('c-look'), 1), 'withdrawn')
  assert.match(proof.report(1), /Amendment r1: redefined probe p-sum/)
  assert.match(proof.report(1), /withdrew claim c-look — No browser/)

  // Persistence: a resumed task keeps history but no approval and no current evidence.
  const state = proof.snapshot()
  assert(validProofState(state))
  assert(!validProofState({ ...state, version: 2 }))
  assert(!validProofState({ ...state, probes: [{ ...state.probes[0], definition: 'forged' }] }))
  const resumed = new ProofContract(state)
  assert(resumed.snapshot().probes.every((probe) => !probe.approved))
  assert(resumed.snapshot().probes.every((probe) => probe.history.every((o) => o.historical)))
  assert.equal(resumed.probeStatus(resumed.probe('p-tests'), 1), 'unapproved')
  assert.deepEqual(
    resumed
      .submit({ probes: [{ id: 'p-tests', claim: 'c-tests', command: 'npm test' }] }, 1)
      .map((probe) => probe.id),
    ['p-tests'],
    'Resubmitting an unapproved probe asks again'
  )
  assert(resumed.probe('p-tests').history.length > 0, 'and keeps its history')
  resumed.approve(['p-tests'])
  assert.equal(
    resumed.probeStatus(resumed.probe('p-tests'), 1),
    'stale',
    'Historical evidence never counts as current'
  )

  // The earliest observation survives long retry histories.
  const long = new ProofContract()
  long.submit({ claims: [claims[0]], probes: [{ id: 'p', claim: 'c-sum', command: 't' }] }, 0)
  long.approve(['p'])
  long.observe('p', {
    revision: 0,
    exitCode: 1,
    passed: false,
    deps: 'd',
    fingerprint: red('base')
  })
  for (let revision = 1; revision < 12; revision++)
    long.observe('p', {
      revision,
      exitCode: 1,
      passed: false,
      deps: 'd',
      fingerprint: red('r' + revision)
    })
  long.observe('p', { revision: 12, exitCode: 0, passed: true, deps: 'd', fingerprint: red() })
  assert.equal(long.probe('p').history.length, 8)
  assert.equal(long.probe('p').history[0].fingerprint, 'base')
  assert.deepEqual(long.witness(long.probe('p')), { red: 11, green: 12 })
  console.log(
    'PASS contract: validation, approval, red/green witnesses, stale evidence, test-change detection, amendments, persistence'
  )
}

function governor() {
  const { ConvergenceGovernor, escalationMessage, CREDIT } = governorModule
  const g = new ConvergenceGovernor(
    { calls: 20, actions: 60, seconds: 900 },
    { calls: 26, actions: 240, seconds: 3600 }
  )
  assert.equal(g.observe('check:a', 'npm test', 0, false, red('x', 3)), 'new')
  assert.equal(
    g.observe('check:a', 'npm test', 0, false, red('x', 3)),
    'unchanged',
    'No change, no attempt'
  )
  assert.equal(
    g.observe('check:a', 'npm test', 1, false, red('y', 2)),
    'progress',
    'Fewer failures'
  )
  assert.equal(g.limits().calls, 20 + CREDIT.calls)
  assert.equal(g.observe('check:a', 'npm test', 2, false, red('y', 2)), 'repeat')
  assert.equal(g.nextEscalation(), undefined)
  assert.equal(g.observe('check:a', 'npm test', 3, false, red('y', 2)), 'repeat')
  const first = g.nextEscalation()
  assert.equal(first.level, 1)
  assert.match(escalationMessage(first, { read: [], changed: [] }), /root-cause hypothesis/)
  assert.equal(g.nextEscalation(), undefined, 'Each level escalates once')
  g.observe('check:a', 'npm test', 4, false, red('y', 2))
  g.observe('check:a', 'npm test', 5, false, red('y', 2))
  const second = g.nextEscalation()
  assert.equal(second.level, 2)
  assert.match(
    escalationMessage(
      { ...second, paths: ['src/a.ts', 'src/b.ts'] },
      { read: ['src/a.ts'], changed: ['src/c.ts'] }
    ),
    /not read in this task: src\/b\.ts.*touched src\/c\.ts/
  )
  assert.equal(g.stopReason(), undefined)
  g.observe('check:a', 'npm test', 6, false, red('y', 2))
  g.observe('check:a', 'npm test', 7, false, red('y', 2))
  assert.match(g.stopReason(), /after 6 fix attempts/)
  assert.equal(g.observe('check:a', 'npm test', 8, true), 'progress', 'Green is progress')
  assert.equal(g.stopReason(), undefined)
  assert.equal(g.observe('check:a', 'npm test', 9, false, red('z')), 'regression')
  for (let i = 0; i < 10; i++) g.credit()
  assert.equal(g.limits().calls, 26, 'Credits never pass the ceiling')
  assert.equal(g.limits().actions, 240)
  // Oscillating between two failures is a stall too.
  const o = new ConvergenceGovernor(
    { calls: 5, actions: 5, seconds: 5 },
    { calls: 5, actions: 5, seconds: 5 }
  )
  o.observe('k', 'k', 0, false, red('a'))
  o.observe('k', 'k', 1, false, red('b'))
  o.observe('k', 'k', 2, false, red('a'))
  o.observe('k', 'k', 3, false, red('b'))
  assert.equal(o.nextEscalation().level, 1)
  // Claiming completion on unchanged failing code.
  assert(o.unchangedFailure('k', 3))
  assert(!o.unchangedFailure('k', 4))
  o.claimWithoutChange('k')
  o.claimWithoutChange('k')
  assert.match(o.stopReason(), /claimed 2 times without a fix/)
  console.log(
    'PASS governor: progress credits, stalls, oscillation, escalation ladder, ceilings, unchanged claims'
  )
}

function grantRules() {
  const run = {}
  const other = {}
  assert(grants.grantKey('run_command', { command: 'npm test', purpose: 'check' }))
  assert.equal(
    grants.grantKey('run_command', { command: 'git push', purpose: 'change' }),
    undefined
  )
  assert.equal(grants.grantKey('run_command', { command: 'dir', purpose: 'inspect' }), undefined)
  assert(grants.grantKey('run_npm', { args: ['run', 'test'] }))
  assert.equal(
    grants.grantKey('run_npm', { args: ['run', 'dev'] }),
    undefined,
    'Dev servers always ask'
  )
  assert.equal(grants.grantKey('run_npm', { args: ['install', 'left-pad'] }), undefined)
  assert.equal(grants.grantKey('run_npm', { args: ['run', 'lint', '--fix'] }), undefined)
  assert.equal(grants.grantKey('run_npm', { action: 'stop', args: ['run', 'test'] }), undefined)
  assert.equal(grants.grantKey('delete_file', { path: 'x' }), undefined)
  assert(grants.addGrant(run, 'run_command', { command: 'npm test', purpose: 'check', path: './' }))
  assert(grants.hasGrant(run, 'run_command', { command: 'npm test ', purpose: 'check', path: '.' }))
  assert(!grants.hasGrant(run, 'run_command', { command: 'npm test -- --x', purpose: 'check' }))
  assert(
    !grants.hasGrant(other, 'run_command', { command: 'npm test', purpose: 'check' }),
    'Grants belong to one run'
  )
  assert(!grants.addGrant(run, 'run_command', { command: 'rm -r x', purpose: 'change' }))
  console.log('PASS grants: exact verification checks only, per run')
}

function falsifierIntake() {
  const text = [
    'I suspect empty input breaks it.',
    '```probes',
    JSON.stringify([
      {
        claim: 'sum of an empty list is 0',
        script: {
          language: 'node',
          source:
            "const { sum } = await import(workspace('sum.js')); process.exit(sum([]) === 0 ? 0 : 1)"
        }
      },
      { claim: 'negative numbers add', command: 'node probe-neg.js', files: ['probe-neg.js'] },
      { claim: 'missing body' },
      { claim: 'bad path', command: 'x', path: '../escape' },
      { claim: 'a', command: 'a' },
      { claim: 'b', command: 'b' },
      { claim: 'c', command: 'c' }
    ]),
    '```'
  ].join('\n')
  const parsed = falsifier.parseFalsifierProbes(text, 1)
  assert.equal(parsed.probes.length, 4, 'At most four probes; malformed ones are dropped')
  assert.equal(parsed.probes[0].id, 'f1-1-sum-of-an-empty-list')
  assert.equal(parsed.claims[0].kind, 'behavior')
  assert(parsed.probes.every((probe) => probe.id === probe.claim))
  assert.deepEqual(falsifier.parseFalsifierProbes('no block here', 1), { claims: [], probes: [] })
  assert.deepEqual(falsifier.parseFalsifierProbes('```probes\n{not json\n```', 1), {
    claims: [],
    probes: []
  })
  const taken = new Set(['f2-1-sum-of-an-empty-list'])
  const again = falsifier.parseFalsifierProbes(text.replace(/sum of/, 'sum of'), 2, (id) =>
    taken.has(id)
  )
  assert(!taken.has(again.probes[0].id), 'Ids never collide with existing claims')
  const assignment = falsifier.falsifierAssignment({
    goal: 'x'.repeat(5000),
    contract: '{}',
    changed: ['sum.js'],
    excerpts: ['y'.repeat(3000)]
  })
  assert(assignment.task.length <= 2000 && assignment.context.length <= 2000)
  console.log('PASS falsifier intake: bounded, validated, collision-free probes')
}

function probes() {
  const { ProofContract } = contractModule
  const proof = new ProofContract()
  proof.submit(
    {
      claims: [{ id: 'c', text: 'empty list sums to zero', kind: 'behavior' }],
      probes: [
        { id: 'p-script', claim: 'c', script: { language: 'node', source: 'process.exit(0)' } },
        {
          id: 'p-cmd',
          claim: 'c',
          command: "node 'test/sum.test.js'",
          path: 'pkg',
          files: ['pkg/extra.js']
        }
      ]
    },
    0
  )
  const workflowId = crypto.randomUUID()
  const script = proof.probe('p-script')
  const args = probeFiles.probeArguments(workflowId, script)
  assert.match(args.command, /^& node '.*p-script-[0-9a-f]{16}\.mjs'$/)
  assert.equal(args.purpose, 'check')
  probeFiles.writeProbeScript(workflowId, script)
  const written = fs.readFileSync(probeFiles.probeScriptPath(workflowId, script), 'utf8')
  assert.match(written, /const workspace = /)
  assert(written.endsWith('process.exit(0)'))
  assert.equal(probeFiles.probeArguments(workflowId, proof.probe('p-cmd')).path, 'pkg')
  assert.throws(() => probeFiles.probeScriptPath('../escape', script), /Invalid/)
  const workspace = path.join(scratch, 'workspace')
  fs.mkdirSync(path.join(workspace, 'pkg', 'test'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'pkg', 'test', 'sum.test.js'), 'one')
  const command = proof.probe('p-cmd')
  const before = probeFiles.probeDependencies(workspace, command)
  fs.writeFileSync(path.join(workspace, 'pkg', 'test', 'sum.test.js'), 'two')
  assert.notEqual(
    probeFiles.probeDependencies(workspace, command),
    before,
    'Editing the test changes deps'
  )
  const outside = { id: 'o', claim: 'c', command: 'node ../../secret.js' }
  assert.equal(
    probeFiles.probeDependencies(workspace, outside),
    probeFiles.probeDependencies(workspace, { id: 'o', claim: 'c', command: 'node' }),
    'Paths outside the workspace are never read'
  )
  console.log(
    'PASS probe files: app-owned scripts, exact arguments, dependency hashing inside the workspace'
  )
}

function ledgerOrigins() {
  const { ActionLedger } = load('src/main/workflow/action-ledger.ts')
  const outcomes = load('src/main/workflow/tool-outcome.ts', {
    './results': load('src/main/workflow/results.ts')
  })
  const ledger = new ActionLedger('origin-fixture')
  const check = { command: 'npm test', purpose: 'check' }
  const passed = outcomes.commandOutcome(JSON.stringify({ exitCode: 0, stopped: false }))
  ledger.begin('a', 'run_command', check, 'probe')
  assert.equal(ledger.complete('a', passed).origin, 'probe')
  assert.equal(ledger.checkRevision, 0, 'A probe does not invalidate project checks')
  ledger.begin('b', 'run_command', check)
  assert.equal(ledger.complete('b', passed).origin, undefined)
  assert.equal(ledger.checkRevision, 1)
  console.log('PASS ledger: probe evidence is tagged and separate from project checks')
}

function budgetsAndLimits() {
  const budgets = new budgetsModule.LoopBudgets()
  const failed = { status: 'failed', code: 'execution-error' }
  assert(budgets.setback(failed, 'open_app\0a'))
  assert(!budgets.setback(failed, 'open_app\0a'), 'An identical failed call ends recovery')
  for (const name of ['b', 'c', 'd', 'e', 'f']) assert(budgets.setback(failed, 'open_app\0' + name))
  assert(!budgets.setback(failed, 'open_app\0g'), 'Six distinct setbacks between changes')
  budgets.progress('mutation')
  assert(budgets.setback(failed, 'open_app\0h'), 'A verified change resets the allowance')
  assert(!budgets.setback({ status: 'denied' }, 'x'), 'Denials never recover')
  assert.equal(limits.actionLimit({}), 60)
  assert.equal(limits.actionLimit({ actionLimit: 10 }), 60, 'Never below the base')
  assert.equal(limits.actionLimit({ actionLimit: 9999 }), limits.ACTION_CEILING)
  assert.equal(limits.runSeconds({ deadlineSeconds: 1e9 }), limits.RUN_SECONDS_CEILING)
  assert(
    limits.isBookkeepingTool('run_probes') && limits.isBookkeepingTool('verification_contract')
  )
  const manager = load('src/main/security/run-manager.ts', { crypto })
  const run = manager.startRun('assistant', 'http://127.0.0.1:1234/v1', '')
  try {
    run.tools = 60
    assert.throws(() => manager.consumeToolBudget(run, 'read_file'), /60-action limit/)
    run.actionLimit = 75
    manager.consumeToolBudget(run, 'read_file')
    assert.equal(run.tools, 61, 'Earned actions extend the run')
    manager.consumeToolBudget(run, 'run_command', 'probe')
    assert.equal(run.tools, 61, 'Probes do not spend actions')
    assert.equal(run.probes, 1)
    run.probes = limits.PROBE_LIMIT
    assert.throws(
      () => manager.consumeToolBudget(run, 'run_command', 'probe'),
      /probe verification limit/
    )
  } finally {
    manager.finishRun(run)
  }
  console.log('PASS budgets: distinct setbacks, adaptive action limit, separate probe budget')
}

async function gate() {
  let approvals = 0
  let executions = 0
  let decision = 'once'
  const run = { id: 'grant-fixture', signal: new AbortController().signal, tools: 0 }
  const runner = load('src/main/llm/run-tool.ts', {
    '../tools': {
      executeTool: async () => {
        executions++
        return JSON.stringify({ exitCode: 0, stopped: false, output: 'ok' })
      }
    },
    '../permissions': {
      toolPermission: () => 'ask',
      requestApproval: async () => {
        approvals++
        return decision
      }
    },
    '../security/policy': { authorizeTool: () => {} },
    '../security/run-manager': {
      currentRun: () => run,
      assertRun: () => {},
      consumeToolBudget: (r, _name, budget) => {
        if (budget !== 'probe') r.tools++
      }
    },
    '../security/tool-contracts': load('src/main/security/tool-contracts.ts', {
      '../tools/schemas': load('src/main/tools/schemas.ts', {
        '../harness/schemas': load('src/main/harness/schemas.ts'),
        './windows': { POSITIONS: [] }
      })
    }),
    '../security/audit': { securityEvent: () => {} },
    '../security/local-action': {
      bindLocalAction: async () => ({ preview: 'preview', revalidate: async () => {}, scope: {} })
    },
    '../services/screen-glow': { hideScreenGlow: () => {} },
    '../settings': {
      getSettings: () => ({ coding: { mode: 'auto' } }),
      allowApprovedTool: () => {}
    },
    '../harness/store': {}
  })
  const previews = []
  const event = (e) => e.type === 'tool_preview' && previews.push(e.preview)
  const check = { command: 'npm test', purpose: 'check' }
  await runner.runTool('run_command', check, 'a1', event)
  await runner.runTool('run_command', check, 'a2', event)
  assert.equal(approvals, 2, 'Without reuse every run asks')
  await runner.runTool('run_command', check, 'a3', event, { reusable: true })
  assert.match(previews.at(-1), /re-run this exact check during this task/)
  await runner.runTool('run_command', check, 'a4', event, { reusable: true })
  await runner.runTool('run_command', check, 'a5', event)
  assert.equal(approvals, 3, 'An approved reusable check re-runs without asking')
  assert.equal(executions, 5)
  await runner.runTool('run_command', { command: 'npm test', purpose: 'change' }, 'a6', event, {
    reusable: true
  })
  await runner.runTool('run_command', { command: 'npm test', purpose: 'change' }, 'a7', event, {
    reusable: true
  })
  assert.equal(approvals, 5, 'Change commands always ask')
  const probe = {
    command: "& node 'C:\\probe.mjs'",
    path: '.',
    purpose: 'check',
    timeout_seconds: 120
  }
  assert.equal(
    await runner.approveChecks('c1', [{ name: 'run_command', args: probe }], 'card', event),
    true
  )
  assert.equal(approvals, 6)
  assert.equal(
    await runner.approveChecks('c2', [{ name: 'run_command', args: probe }], 'card', event),
    true
  )
  assert.equal(approvals, 6, 'Approved probes do not ask again')
  const before = run.tools
  await runner.runTool('run_command', probe, 'p1', event, { budget: 'probe' })
  assert.equal(approvals, 6)
  assert.equal(run.tools, before, 'Probe runs use the probe budget')
  decision = 'deny'
  const denied = { ...probe, command: "& node 'C:\\other.mjs'" }
  assert.equal(
    await runner.approveChecks('c3', [{ name: 'run_command', args: denied }], 'card', event),
    false
  )
  await assert.rejects(
    runner.approveChecks(
      'c4',
      [{ name: 'run_command', args: { command: 'x', purpose: 'change' } }],
      'card',
      event
    ),
    /Only verification checks/
  )
  console.log(
    'PASS tool gate: approve a check once per task, never change commands, batch probe approval'
  )
}

// The full loop through the real chat loop: contract-first push, baseline red, change,
// red→green witness, host project checks, automatic falsification, admitted probe, fix,
// final proof report.
async function loop() {
  const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
  const schemas = load('src/main/tools/schemas.ts', {
    '../harness/schemas': load('src/main/harness/schemas.ts'),
    './windows': { POSITIONS: [] }
  })
  const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schemas })
  const workspace = path.join(scratch, 'loop-project')
  fs.mkdirSync(workspace)
  const model = {
    contextWindow: 32000,
    maxTokens: 512,
    historyTurns: 0,
    maxSteps: 30,
    specialists: true,
    verification: 'proof'
  }
  let run, queue, captured, executions, approvals, consults, latest, state
  let approve = true
  const reset = (replies) => {
    run = { id: crypto.randomUUID(), mode: 'assistant', workspace, tools: 0, modelCalls: 0 }
    queue = replies
    captured = []
    executions = []
    approvals = []
    consults = []
    latest = undefined
    state = { implemented: false, edgeFixed: false }
  }
  const command = (args) => {
    if (args.command === 'node probe-sum.js')
      return state.implemented
        ? { exitCode: 0, output: 'ok' }
        : { exitCode: 1, output: 'AssertionError: expected 6, received undefined' }
    if (/\.mjs'$/.test(args.command))
      return state.edgeFixed
        ? { exitCode: 0, output: 'ok' }
        : { exitCode: 1, output: 'Error: sum([]) returned NaN' }
    if (args.command === 'npm test') return { exitCode: 0, output: 'pass' }
    throw new Error('Unexpected command ' + args.command)
  }
  const chat = load('src/main/llm/chat.ts', {
    ...require('./security/harness-fixture.cjs')(load),
    '../../shared/coding-resources': load('src/shared/coding-resources.ts'),
    crypto,
    '../../shared/reply-quality': load('src/shared/reply-quality.ts'),
    '../settings': { getSettings: () => ({ model }) },
    '../services/attachments': { attachmentContent: async () => [] },
    './prompt': { buildSystemPrompt: () => 'Fixture assistant' },
    './client': {
      getModel: async () => 'fixture',
      callLLM: async (_id, messages) => {
        captured.push(messages)
        assert(run.modelCalls < run.modelCallLimit, 'No request may exceed the model-call limit')
        run.modelCalls++
        assert(queue.length, 'Unexpected model call')
        return queue.shift()
      }
    },
    './run-tool': {
      runTool: async (name, args, _id, _event, options = {}) => {
        executions.push({ name, args, options })
        if (options.budget !== 'probe') run.tools++
        if (name === 'list_files') return '[file] package.json\n[file] sum.js'
        if (name === 'read_file')
          return envelope.untrustedData(
            'local-file',
            args.path,
            args.path === 'package.json'
              ? JSON.stringify({ scripts: { test: 'node test.js' } })
              : 'export const sum = () => 0'
          )
        if (name === 'write_file') {
          state.implemented = true
          return `Saved ${args.path} (${Buffer.byteLength(args.content)} bytes). Verified by reading back identical bytes.`
        }
        if (name === 'edit_file') {
          state.edgeFixed = true
          return `Edited ${args.path}. Verified by reading back identical bytes.`
        }
        if (name === 'run_npm')
          return JSON.stringify({ exitCode: 0, stopped: false, output: 'pass' })
        if (name === 'run_command') return JSON.stringify({ stopped: false, ...command(args) })
        throw new Error('Unexpected tool ' + name)
      },
      approveChecks: async (_id, checks) => {
        approvals.push(checks)
        return approve
      }
    },
    './specialists': {
      SPECIALIST_INSTRUCTIONS: '',
      specialistLimits: () => ({ consultations: 4, handoffChars: 3200 }),
      coordinatorTools: () => schemas.toolSchemas,
      consultSpecialist: async ({ args }) => {
        consults.push(args)
        run.modelCalls++
        const findings =
          'Empty input is unhandled.\n```probes\n' +
          JSON.stringify([
            {
              claim: 'sum of an empty list is 0',
              script: {
                language: 'node',
                source:
                  "const { sum } = await import(workspace('sum.js'))\nprocess.exit(sum([]) === 0 ? 0 : 1)"
              }
            }
          ]) +
          '\n```'
        return {
          calls: 1,
          text: envelope.untrustedData('specialist-findings', args.profile, findings),
          findings
        }
      }
    },
    './visuals': { wantsVisual: () => false },
    './visual-reply': {
      correctVisualReply: async (_m, _messages, reply) => reply,
      correctVisualToolCall: async (_m, _messages, reply) => reply
    },
    './visual-routing': { needsVisualTools: () => false },
    '../security/run-manager': {
      currentRun: () => run,
      assertRun: () => {},
      consumeToolBudget: (r) => {
        r.tools++
      }
    },
    '../security/tool-contracts': contracts,
    './untrusted-data': envelope,
    './context': load('src/main/llm/context.ts', { './untrusted-data': envelope }),
    './playbooks': load('src/main/llm/playbooks.ts'),
    '../memory/store': {},
    '../memory/records': {},
    '../tools': { activeToolSchemas: () => schemas.toolSchemas },
    './environment': load('src/main/llm/environment.ts'),
    './desktop-reply': { correctDesktopReply: async (_id, _messages, reply) => reply },
    '../workflow/controller': require('./security/workflow-load.cjs')(load)
  }).chat
  const tool = (name, args = {}) => ({
    tool_calls: [
      {
        id: crypto.randomUUID(),
        type: 'function',
        function: { name, arguments: JSON.stringify(args) }
      }
    ]
  })
  const event = (e) => {
    if (e.type === 'workflow') latest = e.state
  }
  const contract = tool('verification_contract', {
    claims: [
      { id: 'c-sum', text: 'sum([1,2,3]) returns 6', kind: 'behavior' },
      { id: 'c-tests', text: 'The existing test script passes', kind: 'guard' }
    ],
    probes: [
      { id: 'p-sum', claim: 'c-sum', command: 'node probe-sum.js', files: ['probe-sum.js'] },
      { id: 'p-tests', claim: 'c-tests', command: 'npm test' }
    ]
  })
  const write = () =>
    tool('write_file', {
      path: 'sum.js',
      content: 'export const sum = (xs) => xs.reduce((a, b) => a + b)'
    })

  reset([
    tool('list_files'),
    write(),
    contract,
    write(),
    tool('run_probes'),
    { content: 'Implemented sum.' },
    tool('edit_file', {
      path: 'sum.js',
      old_text: '(a, b) => a + b)',
      new_text: '(a, b) => a + b, 0)'
    }),
    { content: 'Implemented sum, including the empty list.' }
  ])
  const reply = await chat('Implement a sum function in this project', event, [])
  const flat = JSON.stringify(captured)
  assert.match(flat, /Proof: before the first change, submit verification_contract alone/)
  assert.equal(
    executions.filter((e) => e.name === 'write_file').length,
    1,
    'The contract-first push ran nothing'
  )
  assert.match(
    flat,
    /p-sum \(behavior c-sum\): red — fails before the change, as a behavior probe should/
  )
  assert.match(flat, /p-tests \(guard c-tests\): green/)
  assert.match(flat, /p-sum \(behavior c-sum\): green — witnessed: red at r0, green at r1/)
  assert.equal(consults.length, 1, 'One automatic falsification round')
  assert.equal(consults[0].profile, 'falsifier')
  assert.match(consults[0].task, /Implement a sum function/)
  assert.match(flat, /Falsification round 1: 1 of 1 probes broke the change/)
  assert.match(flat, /now behavior claims in your verification contract/)
  assert.equal(approvals.length, 2, 'One approval card for the contract, one for falsifier probes')
  assert.deepEqual(
    approvals[0].map((check) => check.args.command),
    ['node probe-sum.js', 'npm test']
  )
  const probeRuns = executions.filter((e) => e.options.budget === 'probe')
  assert(probeRuns.length >= 6, 'Probes ran at baseline, on demand, at the gates and after the fix')
  assert(probeRuns.every((e) => e.name === 'run_command' && e.args.purpose === 'check'))
  const hostChecks = executions.filter((e) => e.name === 'run_npm')
  assert(hostChecks.length >= 2 && hostChecks.every((e) => e.options.reusable === true))
  assert.match(reply, /^Implemented sum, including the empty list\./)
  assert.match(
    reply,
    /Proof:\n- c-sum: sum\(\[1,2,3\]\) returns 6 — witnessed \(p-sum red at r0 → green at r\d\)/
  )
  assert.match(reply, /- c-tests: The existing test script passes — holds/)
  assert.match(
    reply,
    /- \[falsifier\] f1-1-sum-of-an-empty-list: sum of an empty list is 0 — witnessed/
  )
  assert.match(
    reply,
    /Falsification: 1 round, 1 probe broke the change and became claims, 0 did not/
  )
  assert.match(reply, /Project checks:\n\.: npm run test — passed/)
  assert.equal(
    latest.outcome,
    'actions_checked',
    'Red probe evidence is not an unverified mutation'
  )
  assert(contractModule.validProofState(latest.proof))
  assert(latest.evidence.some((entry) => entry.origin === 'probe'))
  assert.match(
    latest.codingSession.verification,
    /npm run test — passed/,
    'Probe runs after the project checks do not invalidate them'
  )
  assert(
    run.modelCallLimit > model.maxSteps,
    'Verified progress earned more model calls than the configured base'
  )

  // Checks mode: no contract push and no automatic falsification; contracts stay voluntary.
  model.verification = 'checks'
  reset([tool('list_files'), write(), { content: 'Implemented sum.' }])
  assert.match(await chat('Implement a sum function in this project', event, []), /Project checks:/)
  assert.equal(consults.length, 0)
  assert(!JSON.stringify(captured).includes('Proof: before the first change'))
  assert.equal(latest.proof, undefined)

  // A declined contract keeps its claims but proves nothing; the gate asks for a withdrawal.
  model.verification = 'proof'
  approve = false
  reset([
    tool('list_files'),
    contract,
    write(),
    { content: 'Implemented sum.' },
    tool('verification_contract', {
      withdraw: [
        { id: 'p-sum', reason: 'The user declined running this probe' },
        { id: 'p-tests', reason: 'The user declined running this probe' }
      ]
    }),
    { content: 'Implemented sum; the probes were declined, so behavior is unverified.' }
  ])
  const declined = await chat('Implement a sum function in this project', event, [])
  const declinedFlat = JSON.stringify(captured)
  assert.match(declinedFlat, /The user declined running these probes/)
  assert.match(declinedFlat, /Proof gate: probe p-sum was not approved to run/)
  assert.match(declined, /c-sum: .* — no probe/)
  assert.match(declined, /Amendment r\d: withdrew probe p-sum — The user declined/)
  console.log(
    'PASS proof loop: contract-first, baseline red, witness, host checks, falsification, admitted probe, fix, report; checks mode; declined probes'
  )
}

async function main() {
  fingerprints()
  contracts()
  governor()
  grantRules()
  falsifierIntake()
  probes()
  ledgerOrigins()
  budgetsAndLimits()
  await gate()
  await loop()
  fs.rmSync(scratch, { recursive: true, force: true })
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
