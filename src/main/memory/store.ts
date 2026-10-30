import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readPrivate, writePrivate } from '../security/private-store'
import { MEMORY_LIMIT, validMemoryDraft, validMemoryRecord, workspaceKey } from './records'

const file = (): string => join(app.getPath('userData'), 'memories.json')
const journalFile = (): string => join(app.getPath('userData'), 'memory-journal.json')
const JOURNAL_LIMIT = 50
export function listMemories(): MemoryRecord[] {
  try {
    const data: unknown = JSON.parse(readPrivate(file()).toString('utf8'))
    if (
      !data ||
      typeof data !== 'object' ||
      !('version' in data) ||
      data.version !== 1 ||
      !('records' in data) ||
      !Array.isArray(data.records) ||
      data.records.length > MEMORY_LIMIT ||
      !data.records.every(validMemoryRecord) ||
      new Set(data.records.map((record) => record.id)).size !== data.records.length
    )
      throw new Error('Invalid memory store')
    return data.records
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('Saved memories could not be read. Existing data has been preserved.', {
      cause: error
    })
  }
}
function persist(records: MemoryRecord[]): MemoryRecord[] {
  writePrivate(file(), Buffer.from(JSON.stringify({ version: 1, records })))
  return records
}
export function saveMemory(
  draft: MemoryDraft,
  workspace: string,
  chatId: string,
  source: MemoryRecord['source'] = 'user'
): MemoryRecord[] {
  if (!validMemoryDraft(draft))
    throw new Error('Invalid memory. Use a title and up to 1,200 characters.')
  if (draft.scope === 'workspace' && !workspace) throw new Error('Choose a working folder first.')
  if (draft.scope === 'chat' && !chatId) throw new Error('Choose a conversation first.')
  const records = listMemories()
  const old = draft.id ? records.find((record) => record.id === draft.id) : undefined
  if (draft.id && !old) throw new Error('This memory no longer exists. Refresh the list.')
  const scopeKey =
    draft.scope === 'global' ? '' : draft.scope === 'workspace' ? workspaceKey(workspace) : chatId
  const duplicate = records.find(
    (entry) =>
      entry.id !== old?.id &&
      entry.scope === draft.scope &&
      entry.scopeKey === scopeKey &&
      entry.title.toLowerCase() === draft.title.trim().toLowerCase()
  )
  if (duplicate) {
    if (
      !old &&
      duplicate.content === draft.content.trim() &&
      duplicate.kind === draft.kind &&
      duplicate.pinned === draft.pinned
    )
      return records
    throw new Error(
      'A memory with this title already exists in this scope. Edit that entry to replace it.'
    )
  }
  if (old && (old.scope !== draft.scope || old.scopeKey !== scopeKey))
    throw new Error(
      'Edit this memory in its original chat or working folder. Create a new entry to change scope.'
    )
  if (!old && records.length >= MEMORY_LIMIT)
    throw new Error('Memory is full. Remove or combine an entry first.')
  // Strictly increasing, so updatedAt identifies a version even for edits within one millisecond.
  const now = Math.max(Date.now(), old ? old.updatedAt + 1 : 0)
  const record: MemoryRecord = {
    ...draft,
    id: old?.id ?? randomUUID(),
    title: draft.title.trim(),
    content: draft.content.trim(),
    scopeKey,
    // An entry you edit becomes yours; the assistant's edits keep their own label.
    source,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    ...(old?.uses ? { uses: old.uses, usedAt: old.usedAt } : {})
  }

  return persist([...records.filter((entry) => entry.id !== record.id), record])
}
export function deleteMemory(id: string): MemoryRecord[] {
  return persist(listMemories().filter((record) => record.id !== id))
}
export function pruneChatMemories(chatIds: Set<string>): void {
  const records = listMemories()
  const kept = records.filter((record) => record.scope !== 'chat' || chatIds.has(record.scopeKey))
  if (kept.length !== records.length) persist(kept)
}
export function clearChatMemories(chatId: string): void {
  const records = listMemories()
  const kept = records.filter((record) => record.scope !== 'chat' || record.scopeKey !== chatId)
  if (kept.length !== records.length) persist(kept)
}
/** Counts entries the assistant actually received, so useful memories outrank stale ones. */
export function markMemoriesUsed(ids: string[]): void {
  if (!ids.length) return
  const used = new Set(ids)
  const now = Date.now()
  const records = listMemories()
  if (!records.some((record) => used.has(record.id))) return
  persist(
    records.map((record) =>
      used.has(record.id) ? { ...record, uses: (record.uses ?? 0) + 1, usedAt: now } : record
    )
  )
}

// Changes the assistant makes are journaled with the prior entry so the chat can offer Undo,
// including after a restart. Only the most recent changes are kept.
interface MemoryChange {
  id: string
  memoryId: string
  before: MemoryRecord | null
  after: number | null
  at: number
}
function readJournal(): MemoryChange[] {
  try {
    const data: unknown = JSON.parse(readPrivate(journalFile()).toString('utf8'))
    if (
      !data ||
      typeof data !== 'object' ||
      !('changes' in data) ||
      !Array.isArray(data.changes) ||
      !data.changes.every(
        (change: MemoryChange) =>
          change &&
          typeof change.id === 'string' &&
          typeof change.memoryId === 'string' &&
          (change.before === null || validMemoryRecord(change.before)) &&
          (change.after === null || typeof change.after === 'number')
      )
    )
      return []
    return data.changes
  } catch {
    return []
  }
}
function writeJournal(changes: MemoryChange[]): void {
  writePrivate(
    journalFile(),
    Buffer.from(JSON.stringify({ version: 1, changes: changes.slice(-JOURNAL_LIMIT) }))
  )
}
function journal(memoryId: string, before: MemoryRecord | null, after: number | null): string {
  const id = randomUUID()
  try {
    writeJournal([...readJournal(), { id, memoryId, before, after, at: Date.now() }])
  } catch {
    // The change itself succeeded; it just cannot be undone from chat.
    return ''
  }
  return id
}
/** Saves or replaces an entry for the assistant and returns the journaled change. */
export function rememberMemory(
  draft: MemoryDraft,
  workspace: string,
  chatId: string
): { record: MemoryRecord; previous: MemoryRecord | null; change: string } {
  const records = listMemories()
  const scopeKey =
    draft.scope === 'global' ? '' : draft.scope === 'workspace' ? workspaceKey(workspace) : chatId
  // A matching title in the same scope is a correction of that entry, not a conflict.
  const previous =
    (draft.id
      ? records.find((record) => record.id === draft.id)
      : records.find(
          (record) =>
            record.scope === draft.scope &&
            record.scopeKey === scopeKey &&
            record.title.toLowerCase() === draft.title.trim().toLowerCase()
        )) ?? null
  if (draft.id && !previous) throw new Error('No memory has this id. Recall memories first.')
  if (
    previous &&
    previous.title === draft.title.trim() &&
    previous.content === draft.content.trim() &&
    previous.kind === draft.kind
  )
    return { record: previous, previous, change: '' }
  const saved = saveMemory(
    {
      ...draft,
      id: previous?.id,
      scope: previous?.scope ?? draft.scope,
      pinned: previous?.pinned ?? false
    },
    workspace,
    previous?.scope === 'chat' ? previous.scopeKey : chatId,
    'assistant'
  )
  const record = previous
    ? saved.find((entry) => entry.id === previous.id)!
    : saved.find(
        (entry) =>
          entry.scope === draft.scope &&
          entry.scopeKey === scopeKey &&
          entry.title === draft.title.trim()
      )!
  return { record, previous, change: journal(record.id, previous, record.updatedAt) }
}
export function forgetMemory(id: string): { record: MemoryRecord; change: string } {
  const record = listMemories().find((entry) => entry.id === id)
  if (!record) throw new Error('No memory has this id. Recall memories first.')
  deleteMemory(id)
  return { record, change: journal(id, record, null) }
}
/** Reverts one journaled change if the entry has not been changed since. */
export function undoMemoryChange(changeId: string): MemoryRecord[] {
  const changes = readJournal()
  const change = changes.find((entry) => entry.id === changeId)
  if (!change)
    throw new Error('This change was already undone or is too old. Edit it in Settings > Memory.')
  const records = listMemories()
  const current = records.find((record) => record.id === change.memoryId)
  if ((current?.updatedAt ?? null) !== change.after)
    throw new Error('This memory changed afterwards. Edit it in Settings > Memory instead.')
  const others = records.filter((record) => record.id !== change.memoryId)
  if (change.before && others.length >= MEMORY_LIMIT)
    throw new Error('Memory is full. Remove an entry before restoring this one.')
  const result = persist(change.before ? [...others, change.before] : others)
  writeJournal(changes.filter((entry) => entry.id !== changeId))
  return result
}
