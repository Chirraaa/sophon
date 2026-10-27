import { ACTION_LIMIT, RUN_SECONDS } from '../../shared/loop-limits'
import { untrustedData } from '../llm/untrusted-data'
import { codingQualityGuide, codingToolFeedback } from '../../shared/coding-quality'

export const CODING_SESSION_INSTRUCTIONS = `CODING WORKFLOW:
Understand the current request in conversation context, inspect the relevant project, make the requested change, check it and repair diagnosed failures. Match effort to the request: reading a repository, answering a question, cloning it or running an existing command needs no saved plan, reviewer or lesson. Do not invent edits when the user only asks for inspection. Short follow-ups and answers refine the existing request; preserve its constraints.
Inspect relevant files and project instructions before editing. Use coding_checkpoint for substantial multi-step work when it helps continuation, not as a prerequisite for tools. If you save tasks, keep their status current. Review your own changes and actual checks; consult a specialist only when its evidence-based analysis would help. Ask questions only for consequential ambiguity, never to repeat authorization. Read relevant skill guidance when useful; do not spend a routine task configuring the harness.
PATCH POLICY: Use edit_file for existing files, with short unique old_text/new_text excerpts or an edits array for several focused changes to the same file. Never regenerate unchanged code. write_file is for new files only during coding work; whole-file overwrites are rejected. If edit_file is unavailable, report the missing permission instead of substituting a rewrite. Use read_file with start_line and line_count for targeted reads when the relevant range is known. Read package.json fully for verification discovery. Do not paste full changed files in the final reply unless the user requests them; summarize files and checks.
Use run_command for Git and installed project toolchains such as Java, Maven, Gradle, C/C++, Make and CMake. Commands use PowerShell syntax and existing workspace-relative directories. Set purpose accurately: inspect, change or check. Run separate dependent commands and inspect each exit code. Check installed tools with Get-Command when uncertain. run_npm supports managed dev servers. Approval cards handle command approval; do not ask twice in prose. Never use a command to evade blocked tools, protected paths or the selected GitHub account/repository scope.
On a patch mismatch re-read the file and correct the excerpt. On command failure inspect diagnostics and state before a focused repair, bounded by the task budget. Stop on denial or uncertain effects. Never weaken checks. After source changes run relevant builds/tests with purpose check; npm projects also have host-discovered checks. Verification must follow the last edit. If checks are unavailable report that limitation honestly, without manufacturing a package.json or test merely to satisfy the harness. Planning and learning are optional. If you save a plan, keep task statuses current and save a coding_checkpoint after the latest edits before finishing.`

const SOURCE =
  /\.(?:[cm]?[jt]sx?|css|scss|html?|json|xml|py|rs|go|java|c|cc|cxx|cpp|h|hpp|hxx|gradle|kts|properties|cmake|mk|toml|ya?ml|sql)$|(?:^|[\\/])(?:Makefile|CMakeLists\.txt)$/i
export function codingMutation(name: string, args: Record<string, unknown>): boolean {
  return (
    (name === 'run_npm' && args.action !== 'stop' && !isRoutineNpm(args.args)) ||
    (name === 'run_command' && args.purpose === 'change') ||
    (['write_file', 'edit_file', 'delete_file'].includes(name) &&
      SOURCE.test(String(args.path ?? '')))
  )
}

export function isRoutineNpm(args: unknown): boolean {
  if (!Array.isArray(args)) return false
  const script = args[0] === 'run' ? args[1] : args[0]
  return (
    /^(?:dev|start|serve|preview|test(?::[\w-]+)?|lint|typecheck|type-check|check|build|smoke(?::[\w-]+)?)$/.test(
      String(script ?? '')
    ) && !args.some((arg) => /^(?:--fix|--write|--updateSnapshot|-u)$/.test(String(arg)))
  )
}
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
  active: boolean
  constructor(active: boolean, previous?: CodingSessionState) {
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
    return structuredClone(this.state)
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
  record(
    name: string,
    args: Record<string, unknown>,
    text: string,
    status: EvidenceStatus,
    verification = false
  ): void {
    if (!this.active) return
    const feedback = codingToolFeedback(name, args, text)
    if (name === 'run_npm') this.teachingFeedback = feedback
    this.log(`${name} ${String(args.path ?? '')}: ${status}; ${text.slice(0, 300)}`)
    if (['failed', 'denied', 'uncertain'].includes(status)) return
    if (['list_files', 'read_file'].includes(name)) {
      this.state.inspections = [
        ...new Set([
          ...this.state.inspections,
          `${name}: ${String(args.path ?? '.').slice(0, 180)}`
        ])
      ].slice(-64)
    }
    if (
      (codingMutation(name, args) ||
        ['write_file', 'edit_file', 'create_directory', 'delete_file', 'delete_directory'].includes(
          name
        )) &&
      !verification
    ) {
      const change = JSON.stringify({
        tool: name,
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
      this.state.revision++
      this.state.verification = ''
      this.state.lesson = ''
      this.state.tasks.forEach((t) => {
        if (t.status === 'verified') t.status = 'implemented'
      })
    }
  }
  pendingIssue(response = ''): string | undefined {
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
  verified(summary: string): void {
    this.state.verification = summary.slice(0, 4000)
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
      '\nCAPABILITY MANIFEST: ' +
      JSON.stringify({
        tools,
        profiles: specialists
          ? ['main', 'reviewer', 'researcher', 'tutor', 'visual_explainer']
          : ['main'],
        execution:
          'Sequential coordinator; specialists are read-only, researcher can use enabled web tools.',
        limits: `${ACTION_LIMIT} actions (discovery/resources/checkpoints excluded); ${RUN_SECONDS / 60} minutes; configured model-call/context budgets; 3 failures per check.`,
        skills:
          'Discover procedural guidance with harness_manage list/read, imported skills with plugins_list/plugin_read. Read bodies before assigning their exact skill ID. No automatic installation.'
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
