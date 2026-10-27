import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readPrivate, writePrivate } from '../security/private-store'
import { MEMORY_LIMIT, validMemoryDraft, validMemoryRecord, workspaceKey } from './records'

const file = (): string => join(app.getPath('userData'), 'memories.json')
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
export function saveMemory(draft: MemoryDraft, workspace: string, chatId: string): MemoryRecord[] {
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
  const now = Math.max(Date.now(), old?.createdAt ?? 0)
  const record: MemoryRecord = {
    ...draft,
    id: old?.id ?? randomUUID(),
    title: draft.title.trim(),
    content: draft.content.trim(),
    scopeKey,
    source: 'user',
    createdAt: old?.createdAt ?? now,
    updatedAt: now
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
