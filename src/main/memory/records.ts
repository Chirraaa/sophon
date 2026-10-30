export const MEMORY_LIMIT = 200
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !value.includes('\0')
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000
export function validMemoryDraft(value: unknown): value is MemoryDraft {
  return (
    object(value) &&
    Object.keys(value).every((key) =>
      ['id', 'title', 'content', 'kind', 'scope', 'pinned'].includes(key)
    ) &&
    (value.id === undefined ||
      (typeof value.id === 'string' && /^[0-9a-f-]{36}$/.test(value.id))) &&
    text(value.title, 80) &&
    text(value.content, 1200) &&
    typeof value.kind === 'string' &&
    ['preference', 'fact', 'procedure', 'task'].includes(value.kind) &&
    typeof value.scope === 'string' &&
    ['global', 'workspace', 'chat'].includes(value.scope) &&
    typeof value.pinned === 'boolean'
  )
}
export function validMemoryRecord(value: unknown): value is MemoryRecord {
  if (!object(value)) return false
  const { scopeKey, source, createdAt, updatedAt, uses, usedAt, ...draft } = value
  return (
    validMemoryDraft(draft) &&
    typeof draft.id === 'string' &&
    typeof scopeKey === 'string' &&
    scopeKey.length <= 1000 &&
    (draft.scope === 'global' ? scopeKey === '' : scopeKey.length > 0) &&
    (source === 'user' || source === 'assistant') &&
    time(createdAt) &&
    time(updatedAt) &&
    updatedAt >= createdAt &&
    (uses === undefined || (Number.isInteger(uses) && (uses as number) >= 0)) &&
    (usedAt === undefined || time(usedAt))
  )
}
export const workspaceKey = (path: string): string =>
  path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
export function inMemoryScope(record: MemoryRecord, workspace: string, chatId: string): boolean {
  return (
    record.scope === 'global' ||
    (record.scope === 'workspace' && !!workspace && record.scopeKey === workspaceKey(workspace)) ||
    (record.scope === 'chat' && !!chatId && record.scopeKey === chatId)
  )
}
const STOP = new Set(
  'the a an and or to of for in on is it this that with my me please can you use how what was were did do does we our your about'.split(
    ' '
  )
)
// Light English stemming so "tests", "testing" and "tested" meet "test". Lexical on purpose:
// recall must work offline with any provider and without an embedding model.
function stem(term: string): string {
  if (term.length <= 4 || /[\d#+.]/.test(term)) return term
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'edly', 'ies', 'ed', 'es', 'ly', 's'])
    if (term.endsWith(suffix) && term.length - suffix.length >= 3)
      return suffix === 'ies' ? term.slice(0, -3) + 'y' : term.slice(0, -suffix.length)
  return term
}
export function terms(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}_+#.-]+/gu) ?? [])
      .filter((term) => term.length > 1 && !STOP.has(term))
      .map(stem)
  )
}
/** Query terms found in a title (weighted 3) or body (weighted 1). */
export function matchScore(query: Set<string>, title: string, body: string): number {
  const titleTerms = terms(title)
  const bodyTerms = terms(body)
  return [...query].reduce(
    (score, term) => score + (titleTerms.has(term) ? 3 : bodyTerms.has(term) ? 1 : 0),
    0
  )
}
const DAY = 86400000
// Fresh and frequently recalled entries win ties, but never qualify an unrelated entry by
// themselves: both together stay below one matching body word.
const freshness = (record: MemoryRecord, now: number): number =>
  0.5 * Math.exp(-Math.max(0, now - Math.max(record.updatedAt, record.usedAt ?? 0)) / (30 * DAY)) +
  0.4 * Math.min(1, Math.log2((record.uses ?? 0) + 1) / 5)
export function rankMemories(
  records: MemoryRecord[],
  query: string,
  workspace: string,
  chatId: string,
  now = Date.now()
): MemoryRecord[] {
  const queryTerms = terms(query)
  return records
    .filter((record) => inMemoryScope(record, workspace, chatId))
    .map((record) => {
      const base =
        (record.pinned ? 100 : 0) +
        matchScore(queryTerms, record.title, record.content) +
        (record.kind === 'preference' ? 2 : 0) +
        (record.kind === 'task' && record.scope === 'chat' ? 5 : 0)
      return { record, base, score: base + freshness(record, now) }
    })
    .filter(({ base }) => base > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.record.updatedAt - a.record.updatedAt ||
        a.record.id.localeCompare(b.record.id)
    )
    .map(({ record }) => record)
}
