import { codingMutation } from './coding-mutation'
import { ActionLedger, type ActionRecord, type VerificationReport } from './action-ledger'
export { codingMutation, isRoutineNpm } from './coding-mutation'
import {
  ACTION_CEILING,
  ACTION_LIMIT,
  RUN_SECONDS,
  RUN_SECONDS_CEILING
} from '../../shared/loop-limits'
import { untrustedData } from '../llm/untrusted-data'
import { codingQualityGuide, codingToolFeedback } from '../../shared/coding-quality'

export const CODING_SESSION_INSTRUCTIONS = `CODING WORKFLOW (follow in order; scale effort to the request):
1. Scope: short follow-ups refine the existing request and keep its constraints. Inspection-only requests get no edits. Reading code, cloning or running an existing script needs no plan, reviewer or lesson.
2. Inspect: list_files, then read the files you will touch plus AGENTS.md or similar project guidance and package.json (read it fully). Use read_file start_line/line_count for known ranges; never reconstruct a file from a truncated read. For version-sensitive APIs, check the installed version and official docs when web tools are loaded.
3. Edit: edit_file with short unique old_text/new_text excerpts, or an edits array (up to 12) for one file. Never regenerate unchanged code. write_file creates new files only; overwrites are rejected. Use create_directory for missing folders. If edit_file is unavailable, report the missing permission.
4. Check: after the last edit run the relevant build/tests (run_npm, or run_command with purpose check). The host also runs discovered npm checks and owns verified status. A nonzero exit is a diagnostic to repair, not a denial: fix the cause and never weaken or remove checks. Repairs continue while they change the failure; repeating the same failure escalates and then ends the task unverified. If no check exists, say so; do not invent one to satisfy the harness.
5. Finish: report changed files, the checks actually run and remaining limits. Do not paste whole files unless asked.
On a patch mismatch, re-read and copy the exact excerpt. Stop on denial or uncertain effects. run_command uses PowerShell syntax in the workspace with purpose inspect, change or check; run dependent commands separately and read each exit code. Approval cards handle approval; never ask twice in prose or evade blocked tools, protected paths or the selected GitHub account scope. coding_checkpoint is optional for substantial multi-step work; if you save tasks keep their status current and checkpoint after the latest edits.`

// Added when the contract tools are offered (they follow the run_command permission).
export const PROOF_INSTRUCTIONS = `PROOF LOOP (verification_contract, run_probes): turn "done" into claims the host can check.
1. Before the first edit, submit verification_contract alone: behavior claims (what the change must make true), guard claims (what must stay true, such as existing tests or the typecheck) and manual claims (not automatable; reported as unverified), each behavior/guard claim with a probe: one check command or a short node/python script that exits 0 when the claim holds. The user approves new probes once. Behavior probes should fail on the current code.
2. Change the code. After each fix call run_probes: it costs no approval and no actions, and returns green/red with normalized diagnostics.
3. A behavior claim is witnessed when its probe failed earlier and passes now, with the probe and its declared test files unchanged. A probe that always passed only guards.
4. At completion the host re-runs stale probes and project checks and returns any failure to you. A falsifier subagent may then attack the change with its own probes; those that fail become claims to satisfy, or to withdraw with a reason if they contradict the request.
5. Budgets grow while a failure shrinks or turns green. Repeating the same failure earns nothing, escalates, and then ends the task unverified. Never weaken a probe or test to pass; withdraw it with a reason instead, and the final proof shows the amendment.`

export function wantsCodingSession(text: string, workspace: string): boolean {
  if (
    /^(?:please\s+)?(?:run|start|stop|restart|launch|close)\b/i.test(text.trim()) &&
    !/\b(implement|create|fix|debug|refactor|modify|update|add|remove|write|develop|repair)\b/i.test(
      text
    )
  )
    return false
  return (
    !!workspace &&
    /\b(implement|build|create|fix|debug|refactor|modify|update|add|remove|write|develop|repair|corriger)\b/i.test(
      text
    ) &&
    /\b(code|coding|project|repository|repo|app|website|component|function|test|bug|typescript|javascript|react|npm|feature|harness)\b|\.[cm]?[jt]sx?\b/i.test(
      text
    )
  )
}

const bounded = (v: unknown, limit: number): v is string =>
  typeof v === 'string' && v.length <= limit && !v.includes('\0')
const strings = (v: unknown, count: number, length: number): v is string[] =>
  Array.isArray(v) && v.length <= count && v.every((s) => bounded(s, length))
export function validCodingSession(v: unknown): v is CodingSessionState {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const s = v as CodingSessionState
  if (!(
    s.version === 1 &&
    bounded(s.plan, 2000) &&
    bounded(s.docs, 2000) &&
    bounded(s.decisions, 2000) &&
    bounded(s.lesson, 1000) &&
    bounded(s.verification, 4000) &&
    strings(s.inspections, 64, 200) &&
    strings(s.trace, 48, 500) &&
    strings(s.changes, 16, 1000) &&
    [s.revision, s.checkpointRevision, s.compactions].every(
      (n) => Number.isSafeInteger(n) && n >= -1 && n <= 1000000
    ) &&
    Array.isArray(s.tasks) &&
    s.tasks.length <= 12
  ))
    return false
  const ids = new Set<string>()
  for (const task of s.tasks) {
    if (
      !task ||
      !bounded(task.id, 32) ||
      !/^[a-z][a-z0-9-]*$/.test(task.id) ||
      ids.has(task.id) ||
      !bounded(task.title, 200) ||
      !task.title.trim() ||
      !bounded(task.skill, 100) ||
      !['main', 'reviewer', 'researcher', 'tutor', 'visual_explainer'].includes(task.profile) ||
      !strings(task.tools, 10, 80) ||
      !strings(task.dependsOn, 12, 32) ||
      !task.dependsOn.every((id) => ids.has(id)) ||
      !['pending', 'active', 'implemented', 'verified'].includes(task.status)
    )
      return false
    ids.add(task.id)
  }
  return s.tasks.filter((t) => t.status === 'active').length <= 1
}

export class CodingSession {
  private state: CodingSessionState
  private teachingFeedback = ''
  private acceptedVerification?: VerificationReport
  active: boolean
  constructor(
    active: boolean,
    previous?: CodingSessionState,
    readonly ledger = new ActionLedger('standalone', previous?.revision)
  ) {
    this.active = active || !!previous
    this.state =
      previous && validCodingSession(previous)
        ? {
            version: previous.version,
            plan: previous.plan,
            tasks: structuredClone(previous.tasks),
            docs: previous.docs,
            decisions: previous.decisions,
            lesson: previous.lesson,
            inspections: structuredClone(previous.inspections),
            trace: structuredClone(previous.trace),
            changes: structuredClone(previous.changes),
            revision: previous.revision,
            checkpointRevision: previous.checkpointRevision,
            compactions: previous.compactions,
            verification: previous.verification
          }
        : {
            version: 1,
            plan: '',
            tasks: [],
            docs: '',
            decisions: '',
            lesson: '',
            inspections: [],
            trace: [],
            changes: [],
            revision: 0,
            checkpointRevision: -1,
            compactions: 0,
            verification: ''
          }
    if (previous) {
      this.state.verification = ''
      this.state.tasks.forEach((t) => {
        if (t.status === 'verified') t.status = 'implemented'
      })
      this.log('Resumed: old checks require fresh evidence; approvals are not restored.')
    }
  }
  snapshot(): CodingSessionState {
    this.synchronize()
    return structuredClone(this.state)
  }
  private synchronize(): void {
    if (
      this.state.revision === this.ledger.revision &&
      (!this.acceptedVerification || this.ledger.accepts(this.acceptedVerification))
    )
      return
    this.acceptedVerification = undefined
    this.state.revision = this.ledger.revision
    this.state.verification = ''
    this.state.lesson = ''
    for (const task of this.state.tasks) if (task.status === 'verified') task.status = 'implemented'
  }
  get needsInspection(): boolean {
    return this.active && !this.state.inspections.length
  }
  private log(text: string): void {
    this.state.trace.push(text.slice(0, 500))
    this.state.trace = this.state.trace.slice(-48)
  }
  guard(name: string, args: Record<string, unknown>): string | undefined {
    if (
      !codingMutation(name, args) &&
      !(
        this.active &&
        ['write_file', 'edit_file', 'create_directory', 'delete_file', 'delete_directory'].includes(
          name
        )
      )
    )
      return
    this.active = true
    if (name === 'write_file' && args.overwrite === true)
      return 'Existing project files must be patched with edit_file, not overwritten with write_file. Use small unique replacements; if edit_file is unavailable, explain the missing permission.'
    return undefined
  }
  checkpoint(args: Record<string, unknown>, tools: string[], profiles: boolean): void {
    this.synchronize()
    const next = this.snapshot()
    for (const key of ['plan', 'docs', 'decisions', 'lesson'] as const)
      if (args[key] !== undefined) next[key] = String(args[key])
    if (args.tasks !== undefined) {
      const tasks = structuredClone(args.tasks) as CodingTaskState[]
      if (!Array.isArray(tasks) || tasks.some((t) => t.status === 'verified'))
        throw new Error('Only actual project checks can mark tasks verified.')
      next.tasks = tasks
    }
    if (!validCodingSession(next))
      throw new Error(
        'Provide a bounded plan, docs and valid ordered tasks with at most one active task.'
      )
    if (!this.state.inspections.length)
      throw new Error('Inspect the selected project with list_files or read_file before planning.')
    if (!next.plan.trim())
      throw new Error('plan must describe the requested change and its acceptance checks.')
    if (!next.docs.trim())
      next.docs =
        'No stack/version or external documentation evidence recorded. Verify version-sensitive APIs before relying on them; no documentation lookup is claimed.'
    if (!next.tasks.length)
      throw new Error(
        'tasks must contain at least one task mapped to available tools and profile main.'
      )
    for (const task of next.tasks) {
      if (task.tools.some((tool) => !tools.includes(tool)))
        throw new Error(
          `Task ${task.id} names an unavailable tool. Record the gap and map available tools.`
        )
      if (task.profile !== 'main' && !profiles)
        throw new Error(
          'Specialists are unavailable; assign this task to main and record the limitation.'
        )
      if (
        ['active', 'implemented', 'verified'].includes(task.status) &&
        task.dependsOn.some(
          (id) => !['implemented', 'verified'].includes(next.tasks.find((t) => t.id === id)!.status)
        )
      )
        throw new Error(`Task ${task.id} has unfinished dependencies.`)
    }
    for (const old of this.state.tasks)
      if (!next.tasks.some((task) => task.id === old.id))
        throw new Error(
          'Preserve existing task IDs and history; explain changed scope in decisions.'
        )
    for (const task of next.tasks) {
      const old = this.state.tasks.find((t) => t.id === task.id)
      if (
        old?.status === 'verified' &&
        task.status === 'implemented' &&
        JSON.stringify({ ...old, status: '' }) === JSON.stringify({ ...task, status: '' })
      )
        task.status = 'verified'
    }
    next.checkpointRevision = next.revision
    this.state = next
    this.log('Checkpoint: ' + next.tasks.map((t) => `${t.id}=${t.status}`).join(', '))
  }
  record(record: ActionRecord): void {
    this.synchronize()
    if (!this.active) return
    const {
      tool: name,
      args,
      outcome: { text, status }
    } = record
    const feedback = codingToolFeedback(name, args, text)
    if (name === 'run_npm') this.teachingFeedback = feedback
    this.log(`${name} ${String(args.path ?? '')}: ${status}; ${text.slice(0, 300)}`)
    if (
      ['observed', 'reported', 'verified'].includes(status) &&
      ['list_files', 'read_file'].includes(name)
    ) {
      this.state.inspections = [
        ...new Set([
          ...this.state.inspections,
          `${name}: ${String(args.path ?? '.').slice(0, 180)}`
        ])
      ].slice(-64)
    }
    if (record.mutation !== 'none') {
      const change = JSON.stringify({
        tool: name,
        effect: record.mutation,
        path: args.path,
        before: String(
          args.old_text ??
            (args.edits as { old_text: string }[])?.map((edit) => edit.old_text).join('\n') ??
            ''
        ).slice(0, 250),
        after: String(
          args.new_text ??
            (args.edits as { new_text: string }[])?.map((edit) => edit.new_text).join('\n') ??
            args.content ??
            ''
        ).slice(0, 450),
        note: 'Bounded change excerpt; re-read the file for complete content.'
      })
      this.state.changes = [...this.state.changes, change.slice(0, 1000)].slice(-16)
    }
  }
  pendingIssue(response = ''): string | undefined {
    this.synchronize()
    if (!this.state.plan) {
      if (
        this.active &&
        this.state.revision === 0 &&
        /^(?:(?:everything|all|it)\s+(?:is\s+)?)?(?:done|completed|implemented|fixed|finished)(?:[.!]|\s+successfully[.!]?)?$/i.test(
          response.trim()
        )
      )
        return 'No implementation evidence has been recorded. Inspect the project and perform the requested change, or explain the concrete blocker.'
      return undefined
    }
    const pending = this.state.tasks.find((t) => ['active', 'pending'].includes(t.status))
    if (pending)
      return `Task ${pending.id} is ${pending.status}. Complete it and save a checkpoint, or explain why work is blocked.`
    if (this.state.checkpointRevision !== this.state.revision)
      return 'Save a coding_checkpoint after the latest edits before finishing.'
    return undefined
  }
  verified(report: VerificationReport): void {
    this.synchronize()
    if (!this.ledger.accepts(report))
      throw new Error('Verification does not cover the current mutation revision.')
    this.state.verification = report.summary.slice(0, 4000)
    this.acceptedVerification = report
    this.state.tasks.forEach((t) => {
      if (t.status === 'implemented') t.status = 'verified'
    })
    this.log('Project checks passed for revision ' + this.state.revision)
  }
  get needsReflection(): boolean {
    return !this.state.lesson.trim()
  }
  finishReflection(): void {
    if (!this.state.lesson.trim()) this.state.lesson = 'No reusable lesson recorded.'
    this.log('Task finished; procedural learning is optional.')
  }
  get canCompact(): boolean {
    return this.active && (!!this.state.plan || this.state.trace.length > 0)
  }
  compact(): void {
    this.state.checkpointRevision = this.state.revision
    this.state.compactions++
    this.log(
      'Context reloaded from consistent checkpoint. Re-read files needed for the active task.'
    )
  }
  feedback(): string {
    return this.teachingFeedback
  }
  context(tools: string[], specialists: boolean, goal = ''): string {
    if (!this.active) return ''
    return (
      '\n' +
      CODING_SESSION_INSTRUCTIONS +
      '\n' +
      codingQualityGuide(goal, this.state) +
      (tools.includes('verification_contract') ? '\n' + PROOF_INSTRUCTIONS : '') +
      '\nCAPABILITY MANIFEST: ' +
      JSON.stringify({
        tools,
        profiles: specialists
          ? ['main', 'reviewer', 'researcher', 'tutor', 'visual_explainer']
          : ['main'],
        limits: `${ACTION_LIMIT} actions and ${RUN_SECONDS / 60} minutes, extended while verification shows progress up to ${ACTION_CEILING} actions and ${RUN_SECONDS_CEILING / 60} minutes; probes have their own budget.`,
        skills: 'Assign a task skill only after reading it (harness_manage or plugin_read).'
      })
    )
  }
  data(): string {
    return untrustedData(
      'coding-checkpoint',
      'host-owned coding session',
      JSON.stringify({
        ...this.state,
        changes: this.state.changes.slice(-2),
        inspections: this.state.inspections.slice(-12),
        trace: this.state.trace.slice(-6)
      })
    )
  }
  documents(): Record<string, string> {
    const s = this.state
    return {
      'PLAN.md': '# Plan\n\n' + s.plan,
      'TASKS.md':
        '# Tasks\n\n' +
        s.tasks
          .map(
            (t) =>
              `- [${t.status === 'verified' ? 'x' : ' '}] ${t.id}: ${t.title} (${t.status})\n  Dependencies: ${t.dependsOn.join(', ') || 'none'}; tools: ${t.tools.join(', ')}; skill: ${t.skill}; profile: ${t.profile}`
          )
          .join('\n'),
      'DOCS.md': '# Stack and documentation\n\n' + s.docs,
      'DECISIONS.md': '# Decisions\n\n' + s.decisions,
      'STATE.md':
        '# Checkpoint\n\n' +
        JSON.stringify(
          {
            revision: s.revision,
            checkpointRevision: s.checkpointRevision,
            tasks: s.tasks.map(({ id, status }) => ({ id, status })),
            next: s.tasks.find((t) => ['pending', 'active'].includes(t.status))?.id ?? 'respond',
            verification: s.verification,
            lessonCandidate: s.lesson,
            compactions: s.compactions
          },
          null,
          2
        ),
      'TRACE.md': '# Bounded run trace\n\n' + s.trace.join('\n\n')
    }
  }
}
