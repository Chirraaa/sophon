const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/harness-'))
const worker = load('src/main/harness/python.ts', {
  child_process: require('node:child_process'),
  '../security/worker-job': load('src/main/security/worker-job.ts', { koffi: require('koffi') })
})
const store = load('src/main/harness/store.ts', {
  electron: { app: { getPath: () => directory } },
  path,
  fs,
  crypto,
  './python': worker
})
const questions = load('src/shared/questions.ts')
const schema = load('src/main/tools/schemas.ts', {
  './windows': { POSITIONS: [] },
  '../harness/schemas': load('src/main/harness/schemas.ts')
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schema })
const run = (expression, csv) => worker.pythonExpression(expression, csv).then(JSON.parse)
async function main() {
  assert.equal((await run('sum([17, 29, 103]) * 7')).result, 1043)
  assert.equal((await run('str(Decimal("0.1") + Decimal("0.2"))')).result, '0.3')
  assert.equal((await run('str(Fraction(1, 3) + Fraction(1, 6))')).result, '1/2')
  const csv = 'name,amount,region\nalpha,2.5,EU\n"beta, inc",7.5,US\ngamma,3.5,EU\n'
  assert.equal(
    (await run('sum(float(r["amount"]) for r in rows if r["region"] == "EU")', csv)).result,
    6
  )
  assert.equal((await run('rows[1:2]', csv)).result[0].name, 'beta, inc')
  for (const expression of [
    '__import__("os")',
    '(1).__class__',
    'open("secret")',
    '2**100000',
    '"x"*100000000',
    '[x for x in range(100000)]'
  ])
    await assert.rejects(worker.pythonExpression(expression))
  await assert.rejects(worker.pythonExpression('len(rows)', 'a,a\n1,2'))
  await assert.rejects(worker.pythonExpression('len(rows)', 'a,b\n1,2,3'))
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(worker.pythonExpression('1+1', '', cancelled.signal), /cancelled/)
  console.log(
    'PASS real Python: arithmetic, exact decimals/fractions, CSV filters/quoted fields/slices, malformed CSV, forbidden operations and cancellation'
  )
  const workspace = path.join(directory, 'workspace')
  fs.mkdirSync(workspace)
  fs.writeFileSync(path.join(workspace, 'sales.csv'), csv)
  const settings = { files: { workspace }, memory: { enabled: true } }
  const policy = load('src/main/security/workspace-policy.ts', {
    electron: {
      app: {
        getPath: (name) => path.join(directory, name),
        getAppPath: () => path.join(directory, 'app')
      }
    },
    'fs/promises': require('node:fs/promises'),
    path
  })
  const files = load('src/main/tools/files.ts', {
    'fs/promises': require('node:fs/promises'),
    path,
    '../settings': { getSettings: () => settings },
    '../security/workspace-policy': policy,
    '../security/workspace-handles': load('src/main/security/workspace-handles.ts', {
      koffi: require('koffi'),
      path,
      crypto
    }),
    '../security/run-manager': { currentRun: () => undefined },
    '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto }),
    '../services/isolated-parser': {}
  })
  const runState = { signal: new AbortController().signal }
  const binding = load('src/main/security/local-action.ts', {
    '../tools/windows': {},
    '../tools/win32': {},
    '../permissions': {},
    '../tools/automation/controls': {},
    '../tools/files': files,
    'fs/promises': require('node:fs/promises'),
    './run-manager': { assertRun: () => runState.signal.throwIfAborted() },
    path,
    './workspace-policy': policy,
    '../network/search-provider': {},
    '../tools/screen': {},
    '../tools/openApp': {}
  })
  const bound = await binding.bindLocalAction('python_calculate', { path: 'sales.csv' }, runState)
  await bound.revalidate()
  assert.equal(await files.readWorkspaceCsv('sales.csv', bound.scope.file), csv)
  await assert.rejects(files.readWorkspaceCsv('../outside.csv'), /unsafe/)
  await assert.rejects(
    binding.bindLocalAction('python_calculate', { path: 'notes.txt' }, runState),
    /CSV/
  )
  fs.writeFileSync(path.join(workspace, 'sales.csv'), 'name,amount\nchanged,999\n')
  await assert.rejects(bound.revalidate(), /changed/)
  await assert.rejects(files.readWorkspaceCsv('sales.csv', bound.scope.file), /changed/)
  console.log(
    'PASS native workspace CSV reads: approved identity, locked bytes, traversal/format rejection and changed-file rejection'
  )

  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Project guidance\nUse focused patches.\n')
  fs.mkdirSync(path.join(workspace, 'skills', 'example'), { recursive: true })
  fs.writeFileSync(
    path.join(workspace, 'skills', 'example', 'SKILL.md'),
    '# Example skill\nRead before editing.\n'
  )
  assert.match(await files.listFiles({}), /\[file\] AGENTS\.md/)
  for (const document of ['AGENTS.md', 'skills/example/SKILL.md']) {
    const approved = await binding.bindLocalAction('read_file', { path: document }, runState)
    await approved.revalidate()
    const read = JSON.parse(await files.readWorkspaceFile({ path: document }, approved.scope.file))
    assert.equal(read.trust, 'untrusted-data')
    assert.match(read.content, /patches|editing/)
    await assert.rejects(files.workspacePath(document, true), /sensitive/)
    await assert.rejects(files.prepareWorkspaceDeletion({ path: document }, false), /sensitive/)
  }
  await assert.rejects(
    files.prepareWorkspaceDeletion({ path: 'skills', recursive: true }, true),
    /sensitive/
  )
  await assert.rejects(files.workspacePath('.agents/example.md', false, false, true), /sensitive/)
  await assert.rejects(files.workspacePath('../AGENTS.md', false, false, true), /sensitive/)
  fs.linkSync(path.join(workspace, 'AGENTS.md'), path.join(workspace, 'linked-guidance.md'))
  await assert.rejects(files.readWorkspaceFile({ path: 'AGENTS.md' }), /linked/)
  fs.unlinkSync(path.join(workspace, 'linked-guidance.md'))
  console.log(
    'PASS project guidance is visible and readable as untrusted data; edits, deletion, traversal and hard links remain blocked'
  )

  store.initializeHarness()
  assert.equal(store.inspectHarness().documents.length, 9)
  assert.match(store.readHarness('subagents', 'visual-explainer'), /Visual explainer/)
  assert.match(
    store.harnessContext('Help me with a quantum mechanics lesson', 'before_task'),
    /learning.md/
  )
  let recalled = []
  const unrelated = store.harnessContext('zzzzzzzz', 'before_task', (names) => {
    recalled = names
  })
  assert.deepEqual(recalled, [])
  assert.match(unrelated, /Available guidance .*skills\/learning/)
  assert(!unrelated.includes('Automatically loaded guidance:'))
  const automatic = store.harnessContext(
    'Help me with a quantum mechanics lesson',
    'before_task',
    (names) => {
      recalled = names
    }
  )
  assert(recalled.includes('skills/learning.md'))
  assert.match(automatic, /Automatically loaded guidance: skills\/learning.md/)
  const recipe =
    '# Amount sum\n\nSource: fixture CSV with expected result 13.5.\nApplies to: CSV with numeric amount column.\nLimits: Missing values fail; result uses float arithmetic.\n\n```python\nsum(float(r["amount"]) for r in rows)\n```\n'
  const args = { category: 'script-tools', name: 'sum-amount' }
  await store.manageHarness({ ...args, action: 'propose', content: recipe })
  await assert.rejects(store.manageHarness({ ...args, action: 'compose' }), /passing probe/)
  await assert.rejects(
    store.manageHarness({ ...args, action: 'probe', csv, expected: '99' }),
    /differs/
  )
  await store.manageHarness({ ...args, action: 'probe', csv, expected: '13.5' })
  await store.manageHarness({ ...args, action: 'propose', content: recipe + '\nUpdated limits.\n' })
  await assert.rejects(store.manageHarness({ ...args, action: 'compose' }), /passing probe/)
  await store.manageHarness({ ...args, action: 'probe', csv, expected: '13.5' })
  await store.manageHarness({ ...args, action: 'compose' })
  assert.match(store.readHarness('script-tools', 'sum-amount'), /Updated limits/)
  await store.manageHarness({ ...args, action: 'propose', content: recipe })
  await store.manageHarness({ ...args, action: 'probe', csv, expected: '13.5' })
  await store.manageHarness({ ...args, action: 'compose' })
  assert.equal(fs.readdirSync(path.join(directory, 'harness/revisions')).length, 1)
  await assert.rejects(
    store.manageHarness({ ...args, action: 'read', name: '../escape' }),
    /lowercase slug/
  )
  await assert.rejects(
    store.manageHarness({ ...args, action: 'propose', content: '# Missing evidence' }),
    /Source:/
  )
  const restarted = load('src/main/harness/store.ts', {
    electron: { app: { getPath: () => directory } },
    path,
    fs,
    crypto,
    './python': worker
  })
  assert.equal(restarted.readHarness('script-tools', 'sum-amount'), recipe)
  await store.manageHarness({ ...args, action: 'archive' })
  assert(!store.inspectHarness().documents.includes('script-tools/sum-amount.md'))
  console.log(
    'PASS Markdown recall, propose/probe/compose, failed and stale probes, revisions, path containment, evidence labels and restart persistence'
  )

  const q = [{ title: 'What kind of help?', options: ['Explain concepts', 'Practice problems'] }]
  assert.deepEqual(questions.parseQuestions(JSON.stringify(q)), q)
  for (const value of [
    [],
    [q[0], q[0], q[0], q[0]],
    [{ title: 'Question?', options: ['Same', 'Same'] }]
  ])
    assert.throws(() => questions.parseQuestions(JSON.stringify(value)))
  contracts.validateToolArguments('ask_questions', { questions: q })
  for (const invalid of [
    { questions: [] },
    { questions: [{ title: 'Which?', options: ['Same', 'Same'] }] },
    { questions: [{ title: 'Which?', options: ['A', 'B'], unexpected: true }] },
    { questions: [{ title: 'Which?', options: ['A', 2] }] },
    { questions: [{ title: 'x'.repeat(201), options: ['A', 'B'] }] },
    { content: JSON.stringify(q) }
  ])
    assert.throws(() => contracts.validateToolArguments('ask_questions', invalid))
  contracts.validateToolArguments('python_calculate', {
    expression: 'sum(float(r["amount"]) for r in rows)',
    path: 'sales.csv'
  })
  console.log('PASS structured clarification bounds and calculation contracts')
  if (process.argv.includes('--live')) await live()
}

async function live() {
  const base = 'http://127.0.0.1:1234/v1'
  const models = await fetch(base + '/models', { signal: AbortSignal.timeout(5000) }).then((r) =>
    r.json()
  )
  const model = models.data?.[0]?.id
  assert(model, 'No local model loaded')
  const tools = schema.toolSchemas.filter((t) =>
    ['ask_questions', 'python_calculate', 'harness_manage'].includes(t.function.name)
  )
  const prompt = load('src/main/llm/prompt.ts', {
    '../settings': {
      getSettings: () => ({
        behavior: { systemPrompt: '', style: 'normal', neverDo: '' },
        rules: { blockedApps: [], protectedWindows: [] }
      })
    },
    './visuals': { VISUAL_CAPABILITIES: '', VISUAL_PROMPT: '' },
    './visual-routing': { INLINE_VISUAL_TASK: '' }
  }).buildSystemPrompt()
  const send = async (query) => {
    const response = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              prompt +
              '\n' +
              store.HARNESS_INSTRUCTIONS +
              '\n' +
              store.harnessContext(query, 'before_task')
          },
          { role: 'user', content: query }
        ],
        tools,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        presence_penalty: 1.5,
        reasoning_effort: 'none',
        max_tokens: 2048,
        chat_template_kwargs: { enable_thinking: false }
      })
    })
    const data = await response.json()
    assert(response.ok, JSON.stringify(data))
    assert.equal(
      data.choices[0].message.reasoning_content?.length ?? 0,
      0,
      'Server ignored the request to disable thinking'
    )
    return data.choices[0].message
  }
  const lesson = await send('Help me with this lesson about quantum mechanics.')
  assert.equal(lesson.tool_calls?.[0]?.function.name, 'ask_questions', JSON.stringify(lesson))
  const decoded = contracts.parseToolCalls(lesson.tool_calls)
  questions.parseQuestions(JSON.stringify(decoded[0].args.questions))
  const direct = await send(
    'What is a photon? Explain in two sentences for a beginner; answer directly.'
  )
  assert(
    !direct.tool_calls?.some((call) => call.function.name === 'ask_questions'),
    JSON.stringify(direct)
  )
  assert(direct.content?.trim())
  const calculation = await send('Calculate 1739 * 2847 exactly using Python.')
  assert.equal(
    calculation.tool_calls?.[0]?.function.name,
    'python_calculate',
    JSON.stringify(calculation)
  )
  const call = contracts.parseToolCalls(calculation.tool_calls)[0]
  assert.equal((await run(call.args.expression)).result, 4950933)
  fs.writeFileSync(
    path.join(directory, 'live-results.json'),
    JSON.stringify({ model, lesson, direct, calculation }, null, 2)
  )
  console.log(
    `PASS loaded ${model}: vague lesson asks native questions, precise lesson answers directly, arithmetic invokes Python. Evidence: ${directory}`
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
