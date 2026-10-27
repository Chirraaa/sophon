export const MEMORY_LIMIT = 200
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !value.includes('\0')
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
  const { scopeKey, source, createdAt, updatedAt, ...draft } = value
  return (
    validMemoryDraft(draft) &&
    typeof draft.id === 'string' &&
    typeof scopeKey === 'string' &&
    scopeKey.length <= 1000 &&
    (draft.scope === 'global' ? scopeKey === '' : scopeKey.length > 0) &&
    source === 'user' &&
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt) &&
    typeof updatedAt === 'number' &&
    Number.isFinite(updatedAt) &&
    createdAt >= 0 &&
    createdAt <= 8640000000000000 &&
    updatedAt >= createdAt &&
    updatedAt <= 8640000000000000
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
  'the a an and or to of for in on is it this that with my me please can you use how what'.split(
    ' '
  )
)
function terms(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}_+#.-]+/gu) ?? []).filter(
      (term) => term.length > 1 && !STOP.has(term)
    )
  )
}
export function rankMemories(
  records: MemoryRecord[],
  query: string,
  workspace: string,
  chatId: string
): MemoryRecord[] {
  const queryTerms = terms(query)
  return records
    .filter((record) => inMemoryScope(record, workspace, chatId))
    .map((record) => {
      const title = terms(record.title)
      const body = terms(record.content)
      const matches = [...queryTerms].reduce(
        (score, term) => score + (title.has(term) ? 3 : body.has(term) ? 1 : 0),
        0
      )
      return {
        record,
        score:
          (record.pinned ? 100 : 0) +
          matches +
          (record.kind === 'preference' ? 2 : 0) +
          (record.kind === 'task' && record.scope === 'chat' ? 5 : 0)
      }
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.record.updatedAt - a.record.updatedAt ||
        a.record.id.localeCompare(b.record.id)
    )
    .map(({ record }) => record)
}
