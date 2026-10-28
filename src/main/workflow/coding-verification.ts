import { ActionLedger, type ActionRecord, type VerificationReport } from './action-ledger'

type Action = {
  tool: 'list_files' | 'read_file' | 'run_npm' | 'run_command'
  args: Record<string, unknown>
}
type Check = { name: string; passed: boolean; failures: number }
type Project = { checks: Check[]; reason?: string }
export type VerificationStep = Action | { done: true } | { blocked: string }
const SCRIPT_NAMES = [
  'typecheck',
  'type-check',
  'lint',
  'check',
  'test',
  'test:run',
  'build',
  'test:e2e',
  'smoke'
]
const pathName = (value: unknown): string =>
  String(value ?? '.')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '') || '.'
const parent = (value: string): string =>
  value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '.'
const file = (folder: string): string =>
  folder === '.' ? 'package.json' : `${folder}/package.json`
// Non-npm build systems. Their presence makes a check command mandatory even
// when the request did not read as coding work.
const BUILD_SYSTEM =
  /(?:^|[\s\]/\\])(?:CMakeLists\.txt|[Mm]akefile|meson\.build|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|Cargo\.toml|go\.mod|pyproject\.toml|setup\.py|tox\.ini|composer\.json|Gemfile|mix\.exs|deno\.jsonc?|[^\s/\\]+\.(?:sln|csproj|fsproj|vcxproj))\s*$/m

export class CodingVerification {
  constructor(readonly ledger = new ActionLedger('standalone')) {}
  private observedRevision = -1
  private observedCheckRevision = -1
  private listings = new Map<string, boolean>()
  private projects = new Map<string, Project>()
  private pendingNpmChecks = new Map<string, Check>()
  private manifestReads = new Set<string>()
  private required = new Set<string>()
  private failure?: string
  private setupRepairs = new Map<string, number>()
  private commands = new Map<
    string,
    { path: string; args: Record<string, unknown>; passed: boolean; failures: number }
  >()
  private missingCommand?: string
  private buildSystem = false
  get active(): boolean {
    return this.ledger.paths().length > 0
  }
  resume(paths: string[]): void {
    this.ledger.restore(paths)
    this.observedRevision = -1
  }
  paths(): string[] {
    return this.ledger.paths()
  }
  private synchronize(): void {
    if (this.observedRevision === this.ledger.revision) {
      if (this.observedCheckRevision !== this.ledger.checkRevision) {
        // An interrupted action may be committed without returning to record().
        for (const project of this.projects.values())
          for (const check of project.checks) check.passed = false
        for (const command of this.commands.values()) command.passed = false
        this.pendingNpmChecks.clear()
      }
      this.observedCheckRevision = this.ledger.checkRevision
      return
    }
    this.observedRevision = this.ledger.revision
    this.observedCheckRevision = this.ledger.checkRevision
    this.listings.clear()
    this.manifestReads.clear()
    this.pendingNpmChecks.clear()
    for (const project of this.projects.values())
      for (const check of project.checks) check.passed = false
    for (const command of this.commands.values()) command.passed = false
  }
  record(record: ActionRecord): void {
    this.observedCheckRevision = this.ledger.checkRevision
    this.synchronize()
    const {
      tool,
      args,
      outcome: { text, status, command }
    } = record
    if (record.outcome.execution === 'not-started') return
    const successful = !['denied', 'failed', 'uncertain'].includes(status)
    const path = pathName(args.path)
    if (tool === 'run_command') {
      if (args.purpose === 'check') {
        const key = path + '\0' + String(args.command)
        const previous = this.commands.get(key)
        this.commands.set(key, {
          path,
          args: structuredClone(args),
          passed: successful && command?.exitCode === 0 && !command.stopped && !command.running,
          failures:
            (previous?.failures ?? 0) +
            (successful && command?.exitCode === 0 && !command.stopped && !command.running ? 0 : 1)
        })
      }
    }
    if (successful && tool === 'list_files') {
      this.listings.set(path, text.split(/\r?\n/).includes('[file] package.json'))
      if (BUILD_SYSTEM.test(text)) this.buildSystem = true
    }
    if (successful && tool === 'read_file' && /(?:^|\/)package\.json$/i.test(path)) {
      try {
        const envelope = JSON.parse(text)
        if (envelope.trust !== 'untrusted-data' || envelope.kind !== 'local-file') return
        const manifest = JSON.parse(envelope.content)
        const folder = parent(path)
        const scripts = manifest.scripts ?? {}
        const old = this.projects.get(folder)
        const names = SCRIPT_NAMES.filter(
          (name) =>
            Object.hasOwn(scripts, name) &&
            typeof scripts[name] === 'string' &&
            scripts[name].trim()
        )
        const removed = old?.checks.find((check) => !names.includes(check.name))
        const next = !!(manifest.dependencies?.next || manifest.devDependencies?.next)
        this.projects.set(folder, {
          checks: [...new Set([...names, ...(old?.checks.map((check) => check.name) ?? [])])].map(
            (name) =>
              old?.checks.find((check) => check.name === name) ??
              this.pendingNpmChecks.get(folder + '\0' + name) ?? {
                name,
                passed: false,
                failures: 0
              }
          ),
          reason: removed
            ? `Required check ${removed.name} was removed from ${file(folder)}.`
            : next && !names.includes('build')
              ? `Next.js project ${folder} has no build script.`
              : names.length
                ? undefined
                : `No supported verification scripts in ${file(folder)}. Add a meaningful build or test script before claiming completion.`
        })
        this.manifestReads.add(folder)
        this.listings.set(folder, true)
      } catch {
        this.failure = `Could not parse the complete ${path}; project verification is unavailable.`
      }
    }
    if (tool === 'run_npm') {
      if (args.action === 'stop') return
      const argv = args.args as string[]
      const script =
        argv?.length === 2 && argv[0] === 'run'
          ? argv[1]
          : argv?.length === 1 && argv[0] === 'test'
            ? 'test'
            : undefined

      if (script && SCRIPT_NAMES.includes(script)) {
        const key = path + '\0' + script
        const check = this.projects.get(path)?.checks.find((item) => item.name === script) ??
          this.pendingNpmChecks.get(key) ?? { name: script, passed: false, failures: 0 }
        check.passed =
          successful && command?.exitCode === 0 && command.stopped === false && !command.running
        if (!check.passed) check.failures++
        this.pendingNpmChecks.set(key, check)
      }
    }
  }
  next(): VerificationStep {
    this.synchronize()
    this.missingCommand = undefined
    if (!this.active) return { done: true }
    if (this.failure) return { blocked: this.failure }
    const limit = this.limitIssue()
    if (limit) return { blocked: limit }
    const required = new Set<string>()
    for (const changed of this.ledger.paths().map(pathName)) {
      let folder = parent(changed)
      while (true) {
        if (!this.listings.has(folder)) return { tool: 'list_files', args: { path: folder } }
        if (this.listings.get(folder)) {
          required.add(folder)
          break
        }
        if (folder === '.') {
          const checks = [...this.commands.values()].filter(
            (check) => check.path === '.' || changed.startsWith(check.path + '/')
          )
          if (!checks.length) {
            // Plain documents in a folder without a build system (copying
            // notes, writing a CSV) have nothing to check.
            if (!this.ledger.codingIntent && !this.buildSystem) break
            this.missingCommand = changed
            return {
              blocked: `No build/test command has been recorded for ${changed}. Inspect the project's build instructions and run its relevant checks with run_command purpose check.`
            }
          }
          const pending = checks.find((check) => !check.passed)
          if (pending) return { tool: 'run_command', args: pending.args }
          break
        }
        folder = parent(folder)
      }
    }
    this.required = required
    for (const folder of required) {
      if (!this.manifestReads.has(folder))
        return { tool: 'read_file', args: { path: file(folder) } }
      const project = this.projects.get(folder)!
      if (project.reason) return { blocked: project.reason }
      for (const check of project.checks) {
        if (check.passed) continue
        if (check.failures >= 3)
          return {
            blocked: `npm run ${check.name} in ${folder} failed three times. Repair limit reached; code remains unverified.`
          }
        return { tool: 'run_npm', args: { path: folder, args: ['run', check.name] } }
      }
    }

    for (const check of this.commands.values())
      if (!check.passed) return { tool: 'run_command', args: check.args }
    return { done: true }
  }
  summary(): string {
    this.synchronize()
    return [
      ...[...this.projects]
        .filter(([folder]) => this.required.has(folder))
        .flatMap(([folder, project]) =>
          project.checks.map(
            (check) =>
              `${folder}: npm run ${check.name} — ${check.passed ? 'passed' : 'not passed'}`
          )
        ),
      ...[...this.commands.values()].map(
        (check) =>
          `${check.path}: ${check.args.command} — ${check.passed ? 'passed' : 'not passed'}`
      )
    ].join('\n')
  }
  report(): VerificationReport {
    return Object.freeze({
      runId: this.ledger.runId,
      revision: this.ledger.revision,
      checkRevision: this.ledger.checkRevision,
      status: !this.active ? 'not-required' : 'done' in this.next() ? 'passed' : 'pending',
      summary: this.summary()
    })
  }
  requestSetupRepair(): string | undefined {
    if (this.missingCommand) {
      const key = 'command:' + this.missingCommand
      const attempts = this.setupRepairs.get(key) ?? 0
      if (attempts >= 2) return undefined
      this.setupRepairs.set(key, attempts + 1)
      return `Inspect the build instructions for ${this.missingCommand} and use run_command with purpose check for the actual toolchain (for example CMake/CTest, Make, javac, Maven or Gradle). Use the project's existing commands and installed tools; do not invent an npm manifest. If a tool or check is unavailable, explain the concrete limitation. Code is not yet verified.`
    }
    for (const folder of this.required) {
      const reason = this.projects.get(folder)?.reason
      if (!reason) continue
      const attempts = this.setupRepairs.get(folder) ?? 0
      if (attempts >= 2) return undefined
      this.setupRepairs.set(folder, attempts + 1)
      return `${reason} Inspect ${file(folder)} and repair the verification setup with a focused edit. When a coding plan is active, first select the repair task as active with coding_checkpoint, then mark it implemented after the edit. For Next.js, configure a real build script using the installed framework. Preserve existing checks; never substitute a no-op or remove a required check. The host will reread the manifest and execute checks after the repair. Setup repair ${attempts + 1} of 2; completion is not yet verified.`
    }
    return undefined
  }
  finalRepair(): boolean {
    return [...this.projects.values()].some((project) =>
      project.checks.some((check) => !check.passed && check.failures === 2)
    )
  }
  limitIssue(): string | undefined {
    for (const check of this.commands.values())
      if (!check.passed && check.failures >= 3)
        return `${check.args.command} in ${check.path} failed three times. Inspect diagnostics; code remains unverified.`
    for (const [folder, project] of this.projects) {
      const check = project.checks.find((item) => item.failures >= 3)
      if (check)
        return `npm run ${check.name} in ${folder} failed three times. Repair limit reached; code remains unverified.`
    }
    return undefined
  }
}
