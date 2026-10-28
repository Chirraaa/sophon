const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')
const option = (name, fallback) => {
  const index = process.argv.indexOf('--' + name)
  return index < 0 ? fallback : process.argv[index + 1]
}
function summarize(runs, repetitions) {
  assert(Number.isInteger(repetitions) && repetitions >= 3)
  const seen = new Set()
  for (const run of runs) {
    const key = `${run.variant}/${run.repetition}`
    assert(
      ['baseline', 'candidate'].includes(run.variant) &&
        Number.isInteger(run.repetition) &&
        run.repetition >= 0 &&
        run.repetition < repetitions
    )
    assert(!seen.has(key), 'Duplicate trial')
    seen.add(key)
  }
  const mean = (rows, field) =>
    rows.length && rows.every((row) => Number.isFinite(row[field]))
      ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length
      : null
  const variants = Object.fromEntries(
    ['baseline', 'candidate'].map((variant) => {
      const rows = runs.filter((run) => run.variant === variant)
      return [
        variant,
        {
          trials: rows.length,
          passed: rows.filter((row) => row.passed).length,
          meanMs: mean(rows, 'elapsedMs'),
          meanCalls: mean(rows, 'modelCalls'),
          meanInputTokens: mean(rows, 'inputTokens'),
          meanOutputTokens: mean(rows, 'outputTokens')
        }
      ]
    })
  )
  let wins = 0,
    regressions = 0
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const before = runs.find((row) => row.variant === 'baseline' && row.repetition === repetition)
    const after = runs.find((row) => row.variant === 'candidate' && row.repetition === repetition)
    if (before && after) {
      if (!before.passed && after.passed) wins++
      if (before.passed && !after.passed) regressions++
    }
  }
  return {
    complete: runs.length === repetitions * 2,
    variants,
    wins,
    regressions,
    interpretation:
      'Small paired coding regression, not statistical proof of general reliability or procedure usefulness. Missing usage stays null. Provider caching and stochastic inference can affect timing.'
  }
}
function main() {
  assert(
    process.argv.includes('--chatgpt'),
    'Pass --chatgpt to explicitly use the connected account'
  )
  const repetitions = Number(option('repetitions', '3'))
  assert(Number.isInteger(repetitions) && repetitions >= 3 && repetitions <= 10)
  const model = option('model', 'gpt-6-luna')
  const ref = option('baseline', 'tech/NCS-0007')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
  const baselineCommit = git('rev-parse', '--verify', `${ref}^{commit}`).trim()
  const directory = path.join(root, '.cache', 'bench', 'live-' + Date.now())
  fs.mkdirSync(directory, { recursive: true })
  const snapshots = Object.fromEntries(
    ['baseline', 'candidate'].map((variant) => {
      const target = path.join(directory, variant)
      fs.mkdirSync(target)
      return [variant, target]
    })
  )
  const archive = path.join(directory, 'baseline.tar')
  git('archive', '--format=tar', '--output=' + archive, baselineCommit)
  execFileSync('tar', ['-xf', archive, '-C', snapshots.baseline], { windowsHide: true })
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter(Boolean)
  const sources = {}
  for (const file of files) {
    if (!/^(?:src\/|scripts\/|bench\/|resources\/|package\.json$)/.test(file)) continue
    const source = path.join(root, file)
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue
    const destination = path.join(snapshots.candidate, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
    sources[file] = sha(fs.readFileSync(source))
  }
  // Same driver/oracle and fixture loader on both sides; application sources
  // alone vary. The baseline loader adapts only code that uses typed outcomes.
  const driver = [
    'scripts/smoke-coding-agent.cjs',
    'scripts/security/load.cjs',
    'scripts/security/connected-chatgpt.cjs'
  ]
  for (const file of driver)
    fs.copyFileSync(path.join(root, file), path.join(snapshots.baseline, file))
  const report = {
    version: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    model,
    provider: 'chatgpt',
    baselineCommit,
    candidateCommit: git('rev-parse', 'HEAD').trim(),
    sourceHash: sha(JSON.stringify(sources)),
    driverHash: sha(
      driver.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    ),
    repetitions,
    scenario: 'CommonJS implementation with an independent, read-only behavior oracle',
    boundaries:
      'Real Windows files, native handle validation, npm and model transport. Disposable project; approvals supplied by the fixture. No user files or installed apps are operated.',
    order:
      'Alternating baseline/candidate order across repetitions; no seed requested for the hosted provider',
    runs: []
  }
  const file = path.join(directory, 'comparison.json')
  const save = () => {
    report.summary = summarize(report.runs, repetitions)
    fs.writeFileSync(file, JSON.stringify(report, null, 2))
  }
  fs.writeFileSync(path.join(directory, 'candidate-sources.json'), JSON.stringify(sources, null, 2))
  save()
  console.log('COMPARISON ' + file)
  const electron = require('electron')
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const variant of repetition % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      console.log(`START ${variant} repetition ${repetition + 1}/${repetitions}`)
      const args = [
        path.join(snapshots[variant], 'scripts/smoke-coding-agent.cjs'),
        '--live',
        '--chatgpt',
        '--model',
        model
      ]
      if (option('profile')) args.push('--profile', option('profile'))
      const child = spawnSync(electron, args, {
        cwd: snapshots[variant],
        windowsHide: true,
        encoding: 'utf8',
        timeout: 360000,
        maxBuffer: 4 * 1024 * 1024
      })
      const log = String(child.stdout ?? '') + String(child.stderr ?? '')
      fs.writeFileSync(path.join(directory, `${variant}-${repetition}.log`), log)
      const resultPath = [...log.matchAll(/^Report: (.+)$/gm)].at(-1)?.[1].trim()
      if (
        !resultPath ||
        !path.resolve(resultPath).startsWith(path.join(snapshots[variant], '.cache') + path.sep) ||
        !fs.existsSync(resultPath)
      ) {
        report.status = 'infrastructure-interrupted'
        report.error = child.error?.message ?? log.slice(-2000)
        save()
        throw new Error('Live comparison stopped before a trial report was available; see ' + file)
      }
      const trial = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      assert.equal(trial.model, model)
      assert.equal(trial.provider, 'chatgpt')
      const usageComplete =
        trial.usage?.reportedCalls === trial.usage?.calls && trial.usage?.calls > 0
      report.runs.push({
        variant,
        repetition,
        passed: child.status === 0 && !trial.error,
        exitCode: child.status,
        elapsedMs: trial.elapsedMs,
        modelCalls: trial.modelCalls,
        inputTokens: usageComplete ? trial.usage.inputTokens : null,
        outputTokens: usageComplete ? trial.usage.outputTokens : null,
        resultPath: path.relative(directory, resultPath),
        error:
          trial.error ??
          (child.status === 0 ? null : log.trim().split(/\r?\n/).slice(-8).join('\n'))
      })
      save()
      console.log(
        `END ${variant} ${repetition + 1}: ${child.status === 0 ? 'PASS' : 'FAIL'}, ${trial.modelCalls} calls, ${trial.elapsedMs} ms`
      )
    }
  }
  report.status = 'complete'
  save()
  console.log(JSON.stringify(report.summary, null, 2))
}
if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
module.exports = { summarize }
