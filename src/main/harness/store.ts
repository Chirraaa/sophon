import { app } from 'electron'
import { join } from 'path'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  existsSync
} from 'fs'
import { createHash, randomUUID } from 'crypto'
import { pythonExpression } from './python'

export const CATEGORIES = ['skills', 'script-tools', 'subagents', 'loop-hooks'] as const
type Category = (typeof CATEGORIES)[number]
const root = (): string => join(app.getPath('userData'), 'harness')
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
const probes = new Map<string, string>()
const MAX_RUN_OUTCOMES = 64
type RunOutcome = { runId: string; version: number; success: boolean }

type LifecycleState = 'candidate' | 'trial' | 'active' | 'revised' | 'deprecated' | 'discarded'
interface Lifecycle {
  format?: 1
  content?: { hash: string; version: number }
  state: LifecycleState
  version: number
  successes: number
  failures: number
  uses: number
  candidate?: string
  archived?: string
  archivedState?: LifecycleState
  evidence: string[]
  runs: string[]
  outcomes?: RunOutcome[]
}
function lifecyclePath(category: string, name: string): string {
  location(category, name)
  const path = join(root(), 'lifecycle', `${category}-${name}.json`)
  safeFile(path)
  return path
}
export function harnessLifecycle(category: string, name: string): Lifecycle {
  const path = lifecyclePath(category, name)
  if (!existsSync(path))
    return migrateLifecycle(category, name, {
      state: existsSync(location(category, name)) ? 'active' : 'candidate',
      version: 0,
      successes: 0,
      failures: 0,
      uses: 0,
      evidence: [],
      runs: []
    })
  const value = JSON.parse(readFileSync(path, 'utf8')) as Lifecycle
  if (
    !['candidate', 'trial', 'active', 'revised', 'deprecated', 'discarded'].includes(value.state) ||
    ![value.version, value.successes, value.failures, value.uses].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    ) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 12 ||
    !value.evidence.every((s) => typeof s === 'string' && s.length <= 500) ||
    !Array.isArray(value.runs) ||
    value.runs.length > 12 ||
    !value.runs.every((s) => typeof s === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(s)) ||
    (value.outcomes !== undefined &&
      (!Array.isArray(value.outcomes) ||
        value.outcomes.length > MAX_RUN_OUTCOMES ||
        !value.outcomes.every(
          (outcome) =>
            outcome &&
            typeof outcome.runId === 'string' &&
            /^[a-zA-Z0-9-]{1,80}$/.test(outcome.runId) &&
            outcome.version === value.version &&
            typeof outcome.success === 'boolean'
        ) ||
        new Set(value.outcomes.map((outcome) => outcome.runId)).size !== value.outcomes.length ||
        value.uses !== value.outcomes.length ||
        value.successes !== value.outcomes.filter((outcome) => outcome.success).length ||
        value.failures !== value.outcomes.filter((outcome) => !outcome.success).length)) ||
    (value.candidate !== undefined && !/^[a-f0-9]{64}$/.test(value.candidate)) ||
    (value.archivedState !== undefined &&
      !['candidate', 'trial', 'active', 'revised', 'deprecated', 'discarded'].includes(
        value.archivedState
      )) ||
    (value.archived !== undefined && !/^[a-z0-9-]+\.md$/.test(value.archived))
  )
    throw new Error('Invalid procedural lifecycle metadata.')
  if (value.format === undefined) return migrateLifecycle(category, name, value)
  if (
    value.format !== 1 ||
    (value.content !== undefined &&
      (!/^[a-f0-9]{64}$/.test(value.content.hash) || value.content.version !== value.version)) ||
    (!value.content && !['candidate', 'discarded'].includes(value.state))
  )
    throw new Error('Inconsistent procedural manifest.')
  if (value.content) versionContent(category, name, value)
  if (value.outcomes === undefined) {
    // Old counters cannot prove that a counted success had no later failure.
    if (value.uses > 0) {
      if (['active', 'trial'].includes(value.state))
        value.state = value.failures > 0 ? 'candidate' : 'trial'
      if (value.archivedState === 'active') value.archivedState = 'trial'
      value.successes = value.failures = value.uses = 0
      value.runs = []
      value.evidence = []
    }
    value.outcomes = []
    saveLifecycle(category, name, value)
  }
  return value
}
function versionPath(category: string, name: string, value: Lifecycle): string {
  if (!value.content) throw new Error('Procedural manifest has no content version.')
  return join(root(), 'versions', `${category}-${name}-${value.version}-${value.content.hash}.md`)
}
function versionContent(category: string, name: string, value: Lifecycle): string {
  const path = versionPath(category, name, value)
  safeFile(path)
  if (!existsSync(path)) throw new Error('Missing procedural content version.')
  const content = readFileSync(path, 'utf8')
  if (digest(content) !== value.content?.hash)
    throw new Error('Inconsistent procedural content hash.')
  return content
}
function storeVersion(category: string, name: string, value: Lifecycle, content: string): void {
  value.format = 1
  value.content = { hash: digest(content), version: value.version }
  const path = versionPath(category, name, value)
  if (existsSync(path)) versionContent(category, name, value)
  else writeFileSync(path, content, { flag: 'wx' })
}
function migrateLifecycle(category: string, name: string, value: Lifecycle): Lifecycle {
  // Never recover a managed entry by falling back to unbound legacy Markdown.
  if (
    readdirSync(join(root(), 'versions')).some(
      (file) =>
        file.startsWith(`${category}-${name}-`) &&
        /^\d+-[a-f0-9]{64}\.md$/.test(file.slice(category.length + name.length + 2))
    )
  )
    throw new Error('Missing or inconsistent procedural manifest; recovery refused.')
  // Old metadata never bound its state to bytes. Existing updates must earn trial again.
  const path =
    value.state === 'deprecated' && value.archived
      ? join(root(), 'revisions', value.archived)
      : location(category, name)
  safeFile(path)
  if (existsSync(path)) {
    const content = readFileSync(path, 'utf8')
    const starter = SEEDS[`${category}/${name}.md`]
    const trustedStarter =
      value.version === 0 && starter !== undefined && content === seedContent(starter)
    if (!trustedStarter && ['active', 'trial'].includes(value.state)) {
      value.state = 'trial'
      value.successes = value.failures = value.uses = 0
      value.runs = []
      value.evidence = []
    }
    if (value.archivedState === 'active') value.archivedState = 'trial'
    storeVersion(category, name, value, content)
  } else if (!['candidate', 'discarded'].includes(value.state)) {
    throw new Error('Missing legacy procedural content; recovery refused.')
  }
  value.format = 1
  value.outcomes = []
  value.successes = value.failures = value.uses = 0
  value.runs = []
  saveLifecycle(category, name, value)
  return value
}
function saveLifecycle(category: string, name: string, value: Lifecycle): void {
  const path = lifecyclePath(category, name)
  const temp = join(root(), 'lifecycle', `${randomUUID()}.tmp`)
  writeFileSync(temp, JSON.stringify(value), { flag: 'wx' })
  renameSync(temp, path)
}

export function recordHarnessUse(
  category: string,
  name: string,
  runId: string,
  success: boolean,
  evidence: string,
  version?: number
): void {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId)) throw new Error('Invalid procedural evidence ID.')
  const entry = harnessLifecycle(category, name)
  if (version !== undefined && version !== entry.version) return
  const outcomes = entry.outcomes ?? []
  const previous = outcomes.find((outcome) => outcome.runId === runId)
  if (previous && (!previous.success || success)) return
  if (!previous) {
    if (!['trial', 'active', 'revised'].includes(entry.state)) return
    // Bound the manifest without evicting IDs: eviction would let a repeated run count twice.
    // Fail closed at capacity instead of silently dropping failures or counting IDs twice.
    if (outcomes.length >= MAX_RUN_OUTCOMES) {
      entry.state = 'revised'
      entry.evidence = [
        ...entry.evidence,
        'Run tracking limit reached. Compose a fresh trial version before further use.'
      ].slice(-12)
      saveLifecycle(category, name, entry)
      return
    }
    outcomes.push({ runId, version: entry.version, success })
    entry.uses++
    if (success) entry.successes++
    else entry.failures++
  } else {
    previous.success = false
    entry.successes--
    entry.failures++
  }
  entry.outcomes = outcomes
  entry.runs = [...entry.runs.filter((id) => id !== runId), runId].slice(-12)
  entry.evidence = [
    ...entry.evidence.filter(
      (item) => !item.startsWith(`pass ${runId}:`) && !item.startsWith(`fail ${runId}:`)
    ),
    `${success ? 'pass' : 'fail'} ${runId}: ${evidence.slice(0, 380)}`
  ].slice(-12)
  // Apply corrections even after quarantine or archival; an in-flight call can finish later.
  let state = entry.state === 'deprecated' ? entry.archivedState : entry.state
  if (success) {
    if (state === 'trial' && entry.successes >= 3 && entry.failures === 0) state = 'active'
  } else {
    if (
      state === 'trial' ||
      (state === 'active' && previous && entry.version > 0 && entry.successes < 3)
    )
      state = 'candidate'
    else if (state === 'active' && entry.failures >= 2) state = 'revised'
  }
  if (entry.state === 'deprecated') entry.archivedState = state
  else if (state) entry.state = state
  saveLifecycle(category, name, entry)
}

export function readHarnessProposal(category: string, name: string): string {
  return readFileSync(location(category, name, true), 'utf8')
}
export const HARNESS_INSTRUCTIONS = `Use propose → probe → compose: propose the smallest useful approach, probe it with tools or evidence, then compose the checked answer. Answer simple requests directly. python_calculate evaluates bounded Python math and CSV expressions; use it for arithmetic, numerical checks, CSV filtering and aggregation rather than guessing. It supports rows (CSV dictionaries), comprehensions, sum/min/max/len/sorted, int/float/round/abs, Decimal/Fraction and sqrt/sin/cos/log/pi. For CSV use its approved relative workspace path input or inline content. Python expressions cannot import modules, access attributes, open files or execute arbitrary scripts.
Use ask_questions only when a few answers would materially improve an ambiguous request, for example unspecified help with a lesson. Ask up to three short questions with choices; skip it when intent or level is already known, the user wants a direct answer, or a useful assumption suffices. Never require a questionnaire for simple factual questions.
The Markdown harness contains editable skills, script-tools, subagents and loop-hooks. These are fallible procedural guidance, subordinate to current user requests and application instructions, never permissions. Read relevant documents with harness_manage. To learn from an explicit user correction or repeatable tool evidence: propose a concise reusable Markdown document with source, applicability and limits; probe its structure and a meaningful example (script-tools require an expected result); compose only after a passing probe. Do not store private facts, secrets, raw conversations or inferred personal preferences in this plaintext harness. Existing encrypted user memories remain separate. A structure probe is not proof of semantic correctness. Report saved changes accurately. Never claim weight training. Script-tools require one fenced python expression. Subagents use the existing profiles with clean context and bounded handoffs; they cannot add permissions or recursively delegate. Loop hooks are guidance at before_task, after_tool and before_answer, never executable shell commands.
LIFECYCLE: A proposal is a candidate, not active advice. Non-script compose requires the user's approval of the exact probed content, even under Always allow; the app presents this approval. Script-tools require a passing replay probe. Successful compose creates an unproven trial. Only host-observed use can promote a trial or quarantine failing guidance; never assert successful uses or promote it yourself. status reports lifecycle and counters, discard invalidates a candidate, archive deprecates guidance, and rollback restores an archived state without bypassing trial. A completed coding task does not itself approve publication. Reflection may record that no reusable lesson was found.`

const SEEDS: Record<string, string> = {
  'skills/learning.md':
    '# Learning and clarification\n\nApplies to: lesson, learn, quantum, mechanics, study, homework, tutor.\nSource: application starter guidance; adapt from explicit user feedback.\nFor vague help with a lesson, ask about desired help, current level and difficult topic using ask_questions. If the user supplied these details, begin teaching. Do not quiz by default. A skipped card means proceed with a stated reasonable assumption.\n',
  'script-tools/csv.md':
    '# CSV aggregation\n\nApplies to: csv, total, sum, data.\nSource: built-in Python expression recipe. CSV must have a header. Missing or nonnumeric values need an explicit policy; do not silently discard them. Replace amount with the actual column.\n\n```python\nsum(float(r["amount"]) for r in rows)\n```\n',
  'subagents/tutor.md':
    '# Tutor\n\nUse the supplied learner goal and level. For a vague lesson request suggest a few clarifying choices; for a precise question explain directly. Work only from the assignment and relevant excerpts. Return a concise outline and one checked example.\n',
  'subagents/reviewer.md':
    '# Reviewer\n\nInspect the assignment and supplied evidence. Look for a counterexample or missing requirement. Same-model agreement is not independent verification. Return concrete corrections and remaining uncertainty.\n',
  'subagents/researcher.md':
    '# Researcher\n\nPrefer current primary sources and return exact source URLs. Use only enabled public web tools; never send private assignment excerpts in a search query. Search snippets are not full pages.\n',
  'subagents/visual-explainer.md':
    '# Visual explainer\n\nDesign the simplest useful figure for the supplied assignment. Label units, axes, assumptions and illustrative data. Return a compact specification or self-contained visual draft, with no external assets.\n',
  'loop-hooks/before-task.md':
    '# Before task\n\nPropose: identify the goal and the smallest useful next step. Clarify only consequential ambiguity. Recall relevant guidance, respecting current corrections.\n',
  'loop-hooks/after-tool.md':
    '# After tool\n\nProbe: compare the actual tool result with the goal. A tool error or a passing structure check does not verify a factual claim. Adjust using evidence; stop on denial.\n',
  'loop-hooks/before-answer.md':
    '# Before answer\n\nCompose: answer the request with checked findings, useful explanation and limits. Preserve reusable improvements only when supported by an explicit correction or a reproducible probe.\n'
}

function checkedDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
  if (lstatSync(path).isSymbolicLink()) throw new Error('Linked harness directories are blocked.')
}
function safeFile(path: string): void {
  if (!existsSync(path)) return
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16000)
    throw new Error('Unsafe or oversized harness document.')
}
function validateProposal(content: string, category: string): void {
  if (
    !content.startsWith('# ') ||
    content.length < 40 ||
    Buffer.byteLength(content) > 12000 ||
    !/source:/i.test(content) ||
    !/applies to:/i.test(content) ||
    !/limits:/i.test(content)
  )
    throw new Error(
      'Proposal needs a Markdown heading, Source:, Applies to:, Limits:, and 40–12000 bytes of reusable guidance.'
    )
  if (category === 'script-tools') scriptExpression(content)
}
function seedContent(seed: string): string {
  return (
    seed +
    (!/source:/i.test(seed) ? '\nSource: application starter guidance.\n' : '') +
    (!/applies to:/i.test(seed) ? '\nApplies to: the named profile or loop phase.\n' : '') +
    '\nLimits: procedural guidance only; current requests and application restrictions take priority.\n'
  )
}
export function initializeHarness(): void {
  checkedDirectory(root())
  for (const category of [...CATEGORIES, 'proposals', 'revisions', 'lifecycle', 'versions'])
    checkedDirectory(join(root(), category))
  const marker = join(root(), '.initialized')
  if (existsSync(marker)) return
  for (const [name, seed] of Object.entries(SEEDS)) {
    const text = seedContent(seed)
    const path = join(root(), name)
    if (!existsSync(path)) writeFileSync(path, text, { flag: 'wx' })
  }
  writeFileSync(marker, '1', { flag: 'wx' })
}
function documentNames(category: string): string[] {
  const names = new Set(
    readdirSync(join(root(), category))
      .filter((name) => /^[a-z][a-z0-9-]{0,47}\.md$/.test(name))
      .map((name) => name.slice(0, -3))
  )
  for (const file of readdirSync(join(root(), 'versions'))) {
    const match = file.match(
      new RegExp(`^${category}-([a-z][a-z0-9-]{0,47})-\\d+-[a-f0-9]{64}\\.md$`)
    )
    if (match) names.add(match[1])
  }
  for (const file of readdirSync(join(root(), 'lifecycle'))) {
    if (!file.startsWith(`${category}-`) || !file.endsWith('.json')) continue
    const name = file.slice(category.length + 1, -5)
    if (/^[a-z][a-z0-9-]{0,47}$/.test(name)) names.add(name)
  }
  return [...names]
    .filter((name) => {
      const entry = harnessLifecycle(category, name)
      return entry.content && entry.state !== 'deprecated'
    })
    .map((name) => `${name}.md`)
}
export function inspectHarness(): { directory: string; documents: string[] } {
  initializeHarness()
  return {
    directory: root(),
    documents: CATEGORIES.flatMap((category) =>
      documentNames(category).map((name) => `${category}/${name}`)
    )
  }
}
function location(category: unknown, name: unknown, proposal = false): string {
  if (
    !CATEGORIES.includes(category as Category) ||
    typeof name !== 'string' ||
    !/^[a-z][a-z0-9-]{0,47}$/.test(name)
  )
    throw new Error('Use a harness category and a lowercase slug of at most 48 characters.')
  initializeHarness()
  const path = join(
    root(),
    proposal ? 'proposals' : String(category),
    proposal ? `${category}-${name}.md` : `${name}.md`
  )
  safeFile(path)
  return path
}
export function readHarness(category: string, name: string, requireUsable = false): string {
  const entry = harnessLifecycle(category, name)
  if (requireUsable && !['trial', 'active'].includes(entry.state))
    throw new Error(
      'This procedural entry is quarantined or inactive. Inspect and revise it before use.'
    )
  if (entry.state === 'deprecated') throw new Error('This procedural entry is archived.')
  return versionContent(category, name, entry)
}
export function scriptExpression(text: string): string {
  const matches = [...text.matchAll(/```python\s*\n([\s\S]*?)\n```/g)]
  if (matches.length !== 1 || matches[0][1].length > 2000)
    throw new Error('Use exactly one fenced python expression, at most 2000 characters.')
  return matches[0][1].trim()
}
export function harnessContext(
  query: string,
  phase: string,
  onRecall?: (names: string[], versions: Record<string, number>) => void
): string {
  initializeHarness()
  const docs: string[] = []
  if (!['before_task', 'after_tool', 'before_answer'].includes(phase))
    throw new Error('Unknown loop hook.')
  const hook = join(root(), 'loop-hooks', `${phase.replaceAll('_', '-')}.md`)
  safeFile(hook)
  if (
    ['trial', 'active'].includes(harnessLifecycle('loop-hooks', phase.replaceAll('_', '-')).state)
  )
    docs.push(readHarness('loop-hooks', phase.replaceAll('_', '-'), true).slice(0, 1200))
  if (phase === 'before_task') {
    const stop = new Set(
      'the and for that this with from have can could would you your please use using help me'.split(
        ' '
      )
    )
    const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(
      (word) => !stop.has(word)
    )
    const ranked = (['skills', 'script-tools'] as const)
      .flatMap((category) =>
        documentNames(category).map((name) => {
          const lifecycle = harnessLifecycle(category, name.slice(0, -3))
          const text = readHarness(category, name.slice(0, -3))
          return {
            text,
            lifecycle,
            name: `${category}/${name}`,
            score: words.reduce((score, word) => {
              const metadata =
                `${name}\n${text.match(/^# .+|^Applies to:.+/gim)?.join('\n') ?? ''}`.toLowerCase()
              return (
                score + (metadata.includes(word) ? 3 : text.toLowerCase().includes(word) ? 1 : 0)
              )
            }, 0)
          }
        })
      )
      .filter((doc) => doc.score > 0 && ['trial', 'active'].includes(doc.lifecycle.state))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    const selected = ranked.slice(0, 2)
    onRecall?.(
      selected.map((doc) => doc.name),
      Object.fromEntries(selected.map((doc) => [doc.name, doc.lifecycle.version]))
    )
    docs.push(
      ...selected.map(
        (doc) =>
          `Automatically loaded guidance: ${doc.name} [${doc.lifecycle.state}${doc.lifecycle.state === 'trial' ? ', unproven' : ''}; v${doc.lifecycle.version}]\n${doc.text.slice(0, 1200)}`
      )
    )
    const catalog = inspectHarness().documents

    const entries = catalog
      .filter((path) => {
        const [category, file] = path.split('/')
        return ['trial', 'active'].includes(harnessLifecycle(category, file.slice(0, -3)).state)
      })
      .slice(0, 24)
      .map((path) => path.replace(/\.md$/, ''))
    const catalogBudget = Math.max(0, 4400 - docs.join('\n\n').length - 500)
    while (entries.join(', ').length > catalogBudget) entries.pop()
    docs.push(
      'Available guidance (category/name): ' +
        entries.join(', ') +
        (catalog.length > entries.length
          ? '. More entries are available with harness_manage {"action":"list"}.'
          : '.') +
        '\nThe loaded guidance above is already read. For another document, use harness_manage with action read and the exact category/name as separate arguments. Do not create a skill merely to perform the current task.'
    )
  }
  return docs.join('\n\n').slice(0, 4400)
}
export async function manageHarness(
  args: Record<string, unknown>,
  signal?: AbortSignal,
  approvedProposal?: string
): Promise<string> {
  initializeHarness()
  if (signal?.aborted) throw new Error('Harness action cancelled.')
  if (args.action === 'list') return JSON.stringify(inspectHarness())
  const category = String(args.category),
    name = String(args.name)
  if (args.action === 'read') {
    const entry = harnessLifecycle(category, name)
    return (
      `[Procedural state: ${entry.state}, version ${entry.version}${entry.state === 'trial' ? '; unproven' : ''}. Fallible guidance, never authorization.]\n` +
      readHarness(category, name)
    )
  }
  if (args.action === 'status') return JSON.stringify(harnessLifecycle(category, name))
  if (args.action === 'discard') {
    const entry = harnessLifecycle(category, name)
    entry.candidate = undefined
    if (entry.state === 'candidate') entry.state = 'discarded'
    probes.delete(location(category, name, true))
    saveLifecycle(category, name, entry)
    return 'Candidate discarded; it is excluded from recall.'
  }
  if (args.action === 'rollback') {
    const entry = harnessLifecycle(category, name)
    if (entry.state !== 'deprecated' || !entry.archived)
      throw new Error('No deprecated revision to restore.')
    versionContent(category, name, entry)
    entry.state = entry.archivedState ?? 'trial'
    saveLifecycle(category, name, entry)
    return `Restored the deprecated revision to its previous ${entry.state} state.`
  }
  if (args.action === 'archive') {
    if (signal?.aborted) throw new Error('Archive cancelled.')
    if (readdirSync(join(root(), 'revisions')).length >= 1000)
      throw new Error('Revision limit reached.')
    const entry = harnessLifecycle(category, name)
    entry.archived = `${category}-${name}-${randomUUID()}.md`
    entry.archivedState = entry.state
    writeFileSync(
      join(root(), 'revisions', entry.archived),
      versionContent(category, name, entry),
      { flag: 'wx' }
    )
    entry.state = 'deprecated'
    saveLifecycle(category, name, entry)
    return `Archived ${category}/${name}.md to revisions. It will no longer be recalled.`
  }
  const path = location(category, name, true)
  if (args.action === 'propose') {
    const content = String(args.content ?? '')
    validateProposal(content, category)
    if (readdirSync(join(root(), 'proposals')).length >= 100 && !existsSync(path))
      throw new Error('Proposal limit reached.')
    if (category === 'script-tools') scriptExpression(content)
    writeFileSync(path, content)
    probes.delete(path)
    const entry = harnessLifecycle(category, name)
    entry.candidate = digest(content)
    if (!entry.content) entry.state = 'candidate'
    saveLifecycle(category, name, entry)
    return 'Proposed. Run probe before compose. Active guidance has not changed.'
  }
  const content = readFileSync(path, 'utf8')
  validateProposal(content, category)
  if (args.action === 'probe') {
    probes.delete(path)
    if (category === 'script-tools') {
      if (typeof args.expected !== 'string')
        throw new Error('A script probe requires expected as JSON for its result.')
      const result = JSON.parse(
        await pythonExpression(scriptExpression(content), String(args.csv ?? ''), signal)
      )
      if (JSON.stringify(result.result) !== JSON.stringify(JSON.parse(args.expected)))
        throw new Error('Probe failed: actual result differs from expected.')
    }
    if (signal?.aborted) throw new Error('Probe cancelled.')
    probes.set(path, digest(content))
    return category === 'script-tools'
      ? 'Probe passed: Python example matched expected result.'
      : 'Structure probe passed only. Check applicability and evidence before compose; factual correctness is not established.'
  }
  if (args.action !== 'compose') throw new Error('Unknown harness action.')
  if (probes.get(path) !== digest(content))
    throw new Error('Run a passing probe for this exact proposal in this app session first.')
  if (category !== 'script-tools' && approvedProposal !== content)
    throw new Error(
      'This structure-only proposal needs user approval of the exact content before trial use.'
    )
  const entry = harnessLifecycle(category, name)
  if (entry.candidate !== digest(content))
    throw new Error('This candidate was discarded or changed. Propose it again.')
  if (signal?.aborted) throw new Error('Compose cancelled.')
  if (!entry.content && documentNames(category).length >= 100)
    throw new Error('Category document limit reached.')
  if (readdirSync(join(root(), 'revisions')).length >= 1000)
    throw new Error(
      'Revision limit reached. Review archived revisions before saving further changes.'
    )
  if (entry.content)
    writeFileSync(
      join(root(), 'revisions', `${category}-${name}-${randomUUID()}.md`),
      versionContent(category, name, entry),
      { flag: 'wx' }
    )
  entry.state = 'trial'
  entry.version++
  entry.successes = 0
  entry.failures = 0
  entry.uses = 0
  entry.evidence = []
  entry.runs = []
  entry.outcomes = []
  entry.candidate = undefined
  storeVersion(category, name, entry, content)
  saveLifecycle(category, name, entry)
  probes.delete(path)
  return `Composed ${category}/${name}.md as trial v${entry.version}, flagged unproven. Three successful independent runs without regressions promote it to active. Previous version retained in revisions. This updates procedural recall, not model weights.`
}
