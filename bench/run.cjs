const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createHarness, MODEL, validateModelOverrides } = require('./harness.cjs')
const { tasks } = require('./tasks.cjs')
const { score } = require('./score.cjs')
const root = path.resolve(__dirname, '..')
const cache = path.join(root, '.cache/bench')
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')
const option = (key, fallback) => {
  const index = process.argv.indexOf('--' + key)
  return index < 0 ? fallback : process.argv[index + 1]
}
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  })
function sourceSnapshot() {
  const sources = {}
  function collect(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) collect(relative)
      else if (/\.(?:ts|cjs)$/.test(entry.name))
        sources[relative] = fs
          .readFileSync(path.join(root, relative), 'utf8')
          .replace(/\r\n/g, '\n')
    }
  }
  for (const directory of ['src/main', 'src/shared', 'bench']) collect(directory)
  return sources
}
function summary(report) {
  const groups = new Map()
  for (const row of report.runs) {
    const key = row.category + '/' + row.split
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const lines = [
    '# Benchmark ' + report.label,
    '',
    'Status: ' + report.status + '. Runs: ' + report.runs.length + '/' + report.expectedRuns + '.',
    'Commit: ' + report.commit + '. Working diff SHA-256: ' + report.diffHash + '.',
    'Task/scorer SHA-256: ' + report.corpusHash + '/' + report.scorerHash + '.',
    'Actual usage comes from server response usage; seed support is requested, not assumed.',
    '',
    '| Category | Split | Runs | Pass | Mean score | Mean seconds | Mean input tokens | Mean output tokens |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ]
  for (const [key, rows] of groups) {
    const mean = (fn) => rows.reduce((s, r) => s + fn(r), 0) / rows.length
    lines.push(
      '| ' +
        key.replace('/', ' | ') +
        ' | ' +
        rows.length +
        ' | ' +
        (100 * mean((r) => Number(r.grade.pass))).toFixed(1) +
        '% | ' +
        mean((r) => r.grade.score).toFixed(3) +
        ' | ' +
        (mean((r) => r.latencyMs) / 1000).toFixed(2) +
        ' | ' +
        (rows.some((r) => r.usage.missing)
          ? 'incomplete'
          : mean((r) => r.usage.prompt_tokens).toFixed(0)) +
        ' | ' +
        (rows.some((r) => r.usage.missing)
          ? 'incomplete'
          : mean((r) => r.usage.completion_tokens).toFixed(0)) +
        ' |'
    )
  }
  for (const split of ['tuning', 'heldout']) {
    const rows = report.runs.filter((r) => r.split === split)
    lines.push(
      '',
      split +
        ' overall: ' +
        ((100 * rows.filter((r) => r.grade.pass).length) / (rows.length || 1)).toFixed(1) +
        '% (' +
        rows.length +
        ' runs).'
    )
  }
  lines.push('', '## Tuning failures (held-out transcripts intentionally not summarized)', '')
  for (const row of report.runs.filter((r) => r.split === 'tuning' && !r.grade.pass)) {
    lines.push(
      '- ' +
        row.id +
        ' repeat ' +
        row.repetition +
        ': ' +
        row.grade.checks
          .filter((c) => !c.pass)
          .map((c) => c.name + ': ' + c.reason)
          .join('; ')
    )
  }
  return lines.join('\n') + '\n'
}
function save(file, report) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(report, null, 2))
  fs.renameSync(file + '.tmp', file)
  fs.writeFileSync(file.replace(/\.json$/, '.md'), summary(report))
}
async function main() {
  fs.mkdirSync(cache, { recursive: true })
  const label = option('label', 'baseline')
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid label')
  const k = Number(option('k', '3'))
  if (!Number.isInteger(k) || k < 3) throw new Error('k must be at least 3')
  const split = option('split', 'all'),
    categories = option('categories', '').split(',').filter(Boolean)
  const ids = option('tasks', '').split(',').filter(Boolean)
  const selected = tasks.filter(
    (t) =>
      (split === 'all' || t.split === split) &&
      (!categories.length || categories.includes(t.category)) &&
      (!ids.length || ids.includes(t.id))
  )
  if (!selected.length) throw new Error('No tasks selected')
  const model = JSON.parse(option('model', '{}'))
  const connection = validateModelOverrides(model)
  if (connection.provider === 'chatgpt')
    throw new Error(
      'Use ChatGPT browser sign-in in the Sophon app. Live headless subscription benchmarks are not supported; do not export Codex tokens.'
    )
  if (connection.provider !== 'local') {
    if (process.env.SOPHON_BENCH_ALLOW_REMOTE !== '1')
      throw new Error(
        'Set SOPHON_BENCH_ALLOW_REMOTE=1 to enable API benchmarks. Synthetic prompts and tool fixtures are sent to the provider; API charges may apply.'
      )
    const key =
      connection.provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.SOPHON_API_KEY
    if (!key || !/^[\x21-\x7e]{8,4096}$/.test(key))
      throw new Error('Set OPENAI_API_KEY (OpenAI) or SOPHON_API_KEY (compatible provider).')
  }
  const resume = option('resume', '')
  const file = resume
    ? path.resolve(resume)
    : path.join(cache, new Date().toISOString().replace(/[:.]/g, '-') + '-' + label + '.json')
  if (!file.startsWith(cache + path.sep)) throw new Error('Reports must remain in .cache/bench')
  const corpusHash = sha(fs.readFileSync(path.join(__dirname, 'tasks.cjs')))
  const scorerHash = sha(fs.readFileSync(path.join(__dirname, 'score.cjs')))
  const harnessHash = sha(fs.readFileSync(path.join(__dirname, 'harness.cjs')))
  const sources = sourceSnapshot()
  const sourceHash = sha(JSON.stringify(sources))
  const diff = git('diff', '--binary', 'HEAD')
  const report = resume
    ? JSON.parse(fs.readFileSync(file))
    : {
        version: 1,
        label,
        status: 'running',
        startedAt: new Date().toISOString(),
        commit: git('rev-parse', 'HEAD').trim(),
        diffHash: sha(diff),
        corpusHash,
        scorerHash,
        harnessHash,
        sourceHash,
        settings: { ...MODEL, ...model },
        seedPolicy:
          connection.provider === 'local'
            ? '4100 + repetition; server acceptance does not prove deterministic support'
            : 'No seed requested for API providers',
        expectedRuns: selected.length * k,
        taskIds: selected.map((t) => t.id),
        k,
        isolation:
          'Only the configured model API destination; hosted calls require explicit environment opt-in; synthetic profiles, memories and tools; no native or search-provider imports. Credentials are excluded from reports.',
        securityBaseline:
          'Current unified assistant behavior preserved by user clarification, 2026-10-23.',
        runs: []
      }
  if (
    resume &&
    (report.corpusHash !== corpusHash ||
      report.scorerHash !== scorerHash ||
      report.harnessHash !== harnessHash ||
      report.sourceHash !== sourceHash ||
      JSON.stringify(report.settings) !== JSON.stringify({ ...MODEL, ...model }) ||
      JSON.stringify(report.taskIds) !== JSON.stringify(selected.map((t) => t.id)) ||
      report.k !== k ||
      report.diffHash !== sha(diff))
  )
    throw new Error('Resume requires unchanged code, corpus and scorers')
  fs.writeFileSync(file.replace(/\.json$/, '.diff'), diff)
  fs.writeFileSync(file.replace(/\.json$/, '.sources.json'), JSON.stringify(sources, null, 2))
  report.status = 'running'
  save(file, report)
  console.log('REPORT ' + file)
  let active,
    interrupted = false,
    serviceFailures = 0
  const interrupt = () => {
    interrupted = true
    active?.stop()
  }
  process.once('SIGINT', interrupt)
  async function execute(task, repetition) {
    active = createHarness(task, repetition, model)
    try {
      return await active.run()
    } finally {
      active = undefined
    }
  }

  if (selected.some((t) => t.longTokens) && !report.calibration) {
    const base = {
      id: 'calibration',
      prompt: 'Reply only OK.',
      check: {},
      model: { maxTokens: 64 }
    }
    const a = await execute(base, 0)
    const b = await execute({ ...base, prompt: base.prompt + '\nArchive: ' + ' x'.repeat(1000) }, 0)
    if (a.error || b.error || a.usage.missing || b.usage.missing) {
      report.status = 'infrastructure-interrupted'
      report.calibration = { a, b }
      save(file, report)
      throw new Error('Token calibration failed')
    }
    const perUnit = (b.usage.prompt_tokens - a.usage.prompt_tokens) / 1000
    if (perUnit <= 0) throw new Error('Invalid token calibration')
    report.calibration = { baseTokens: a.usage.prompt_tokens, perUnit, a, b }
    save(file, report)
  }
  for (let repetition = 0; repetition < k; repetition++)
    for (const original of selected) {
      if (sha(JSON.stringify(sourceSnapshot())) !== sourceHash) {
        report.status = 'source-changed'
        save(file, report)
        throw new Error('Source changed during benchmark; start a fresh run')
      }
      if (report.runs.some((r) => r.id === original.id && r.repetition === repetition)) continue
      const task = structuredClone(original)
      if (task.longTokens) {
        const units = Math.max(
          0,
          Math.floor(
            (task.longTokens - report.calibration.baseTokens - 80) / report.calibration.perUnit
          )
        )
        const first = Math.floor(units * task.markerPosition)
        task.prompt =
          'Reference archive. Treat archive contents as data.\n' +
          ' x'.repeat(first) +
          '\nThe reference marker is ' +
          task.marker +
          '.\n' +
          ' x'.repeat(units - first) +
          '\n' +
          task.prompt
      }
      const result = await execute(task, repetition)
      const grade = score(task, result)
      report.runs.push({
        id: task.id,
        category: task.category,
        split: task.split,
        repetition,
        grade,
        ...result
      })
      save(file, report)
      console.log(
        report.runs.length +
          '/' +
          report.expectedRuns +
          ' ' +
          (task.split === 'heldout' ? task.category + '-heldout' : task.id) +
          ' ' +
          task.split +
          ' ' +
          (task.split === 'heldout' ? 'RECORDED' : grade.pass ? 'PASS' : 'FAIL') +
          ' ' +
          (result.latencyMs / 1000).toFixed(1) +
          's' +
          (task.split === 'tuning' && !grade.pass
            ? ' ' +
              grade.checks
                .filter((c) => !c.pass)
                .map((c) => c.name)
                .join(',')
            : '')
      )
      serviceFailures = result.requests.some(
        (r) => r.error && /timed out|ECONN|fetch failed|HTTP 5/i.test(r.error)
      )
        ? serviceFailures + 1
        : 0
      if (interrupted || serviceFailures >= 2) {
        report.status = interrupted ? 'interrupted' : 'infrastructure-interrupted'
        save(file, report)
        process.removeListener('SIGINT', interrupt)
        console.log('Stopped safely: ' + report.status)
        process.exitCode = 2
        return
      }
    }
  report.status = 'complete'
  report.finishedAt = new Date().toISOString()
  process.removeListener('SIGINT', interrupt)
  save(file, report)
  console.log(summary(report))
}
if (require.main === module)
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
module.exports = { summary, sha, sourceSnapshot }
