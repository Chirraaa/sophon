import { probeSpecIssue, type ContractSubmission, type ProbeSpec } from './contract'

// Executable adversarial review. The falsifier is a fresh context of the same model whose
// only job is to break the coordinator's claims. Its opinions are discarded: only probes
// count, and only after the host has run them. A probe that fails on the current code is
// admitted as a new behavior claim; one that passes is kept as a guard. Agreement between
// two runs of one model is not evidence, but a failing execution is.

export const FALSIFIER_INSTRUCTION =
  'You are adversarial. Assume the change is wrong and try to prove it with executable probes. Read the changed files and their callers with list_files/read_file (read-only). Target what the coordinator is least likely to have tested: empty and boundary inputs, invalid types, ordering, duplicates, large inputs, error paths, mutation of arguments, async timing, and the exact wording of the original request. Return 1-4 probes in one fenced block tagged probes containing a JSON array. Each item: {"claim": "the property that must hold, one sentence", "script": {"language": "node" | "python", "source": "..."}} or {"claim": "...", "command": "one PowerShell command"}; optional "path" (workspace folder the probe runs in, default ".") and "files" (workspace test files it depends on). A probe exits 0 when the property holds and nonzero when it is violated, printing what it observed. Node scripts are ES modules run from the probe folder; load workspace code with await import(workspace("relative/path.js")). Python scripts can import modules relative to the probe folder. Only probes count; prose findings are discarded. Never edit files.'

const LIMIT = 4

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
      .replace(/-+$/, '') || 'probe'
  )
}

export function falsifierAssignment(input: {
  goal: string
  contract: string
  changed: string[]
  excerpts: string[]
}): { task: string; context: string } {
  const task = (
    'Break this change. Original request: ' +
    input.goal.slice(0, 900) +
    '\nChanged paths: ' +
    (input.changed.slice(0, 20).join(', ') || 'none recorded') +
    '\nWrite probes that fail if the change is wrong or incomplete.'
  ).slice(0, 2000)
  let context = 'Coordinator contract (claims it believes hold): ' + input.contract
  for (const excerpt of input.excerpts) {
    if (context.length + excerpt.length + 1 > 2000) break
    context += '\n' + excerpt
  }
  return { task, context: context.slice(0, 2000) }
}

// Turns the falsifier's probes block into a contract submission with falsifier-owned ids.
// Malformed entries are dropped rather than repaired; nothing here is trusted to run until
// the host has validated and the user has approved it.
export function parseFalsifierProbes(
  text: string,
  round: number,
  taken: (id: string) => boolean = () => false
): ContractSubmission & { probes: ProbeSpec[] } {
  const block =
    text.match(/```probes\s*\n([\s\S]*?)```/)?.[1] ??
    text.match(/```json\s*\n(\s*\[[\s\S]*?\])\s*```/)?.[1]
  if (!block) return { claims: [], probes: [] }
  let items: unknown
  try {
    items = JSON.parse(block)
  } catch {
    return { claims: [], probes: [] }
  }
  if (!Array.isArray(items)) return { claims: [], probes: [] }
  const claims: NonNullable<ContractSubmission['claims']> = []
  const probes: ProbeSpec[] = []
  for (const item of items) {
    if (probes.length >= LIMIT) break
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.claim !== 'string' || !entry.claim.trim()) continue
    let id = `f${round}-${probes.length + 1}-${slug(entry.claim)}`.slice(0, 32).replace(/-+$/, '')
    while (taken(id)) id = id.slice(0, 28) + '-' + Math.floor(Math.random() * 900 + 100)
    const spec: ProbeSpec = {
      id,
      claim: id,
      ...(typeof entry.command === 'string' ? { command: entry.command } : {}),
      ...(entry.script && typeof entry.script === 'object'
        ? {
            script: {
              language: (entry.script as Record<string, unknown>).language as 'node' | 'python',
              source: String((entry.script as Record<string, unknown>).source ?? '')
            }
          }
        : {}),
      ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
      ...(Array.isArray(entry.files)
        ? { files: entry.files.filter((file): file is string => typeof file === 'string') }
        : {})
    }
    if (probeSpecIssue(spec)) continue
    claims.push({ id, text: entry.claim.trim().slice(0, 300), kind: 'behavior' })
    probes.push(spec)
  }
  return { claims, probes }
}
