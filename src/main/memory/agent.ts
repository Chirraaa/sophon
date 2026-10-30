import { untrustedData } from '../llm/untrusted-data'
import { forgetMemory, listMemories, markMemoriesUsed, rememberMemory } from './store'
import { inMemoryScope, matchScore, rankMemories, terms, validMemoryDraft } from './records'
import { searchEpisodes } from './episodes'
import { MEMORY_TOOLS, memorySchemas } from './schemas'

type MemorySettings = { enabled?: boolean; learn?: boolean; episodes?: boolean } | undefined

/** Memory tools the model may use under the current settings. */
export function memoryTools(settings: MemorySettings): typeof memorySchemas {
  if (!settings?.enabled) return []
  return memorySchemas.filter((tool) => tool.function.name === 'recall' || settings.learn === true)
}
export const isMemoryTool = (name: string): boolean => MEMORY_TOOLS.includes(name)
/** Records which saved entries a request received; failures never block the reply. */
export function noteRecalled(ids: string[]): void {
  try {
    markMemoriesUsed(ids)
  } catch {
    /* Usage counts only tune ranking. */
  }
}

const SECRET =
  /\b(?:password|passcode|passwd|api[ _-]?key|secret[ _-]?key|private[ _-]?key|access[ _-]?token|bearer)\b\s*[:=]|\b(?:sk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}|\b(?:\d[ -]?){13,19}\b/i
const brief = (record: MemoryRecord): Record<string, unknown> => ({
  id: record.id,
  title: record.title,
  content: record.content,
  kind: record.kind,
  scope: record.scope,
  source: record.source
})

/**
 * Runs remember/forget/recall for the assistant. These are bookkeeping on the user's own
 * encrypted memory, so they skip approval prompts; Settings > Memory turns them off, and every
 * change is shown in chat with Undo.
 */
export function runMemoryTool(
  name: string,
  args: Record<string, unknown>,
  context: { chatId: string; workspace: string; settings: MemorySettings }
): string {
  const { chatId, workspace, settings } = context
  try {
    if (!memoryTools(settings).some((tool) => tool.function.name === name))
      throw new Error('this memory action is turned off in Settings > Memory.')
    if (name === 'recall') {
      const query = String(args.query ?? '').trim()
      if (!query) throw new Error('supply a query.')
      const source = String(args.source ?? 'both')
      const memories =
        source === 'conversations'
          ? []
          : rankMemories(listMemories(), query, workspace, chatId)
              .filter((record) => matchScore(terms(query), record.title, record.content) > 0)
              .slice(0, 8)
      const conversations =
        source === 'memories' || settings?.episodes !== true
          ? []
          : searchEpisodes(query, chatId).map((episode) => ({
              title: episode.title,
              date: new Date(episode.updatedAt).toISOString().slice(0, 10),
              workspace: episode.workspace || undefined,
              exchanges: episode.exchanges.map((exchange) => ({
                date: new Date(exchange.at).toISOString().slice(0, 10),
                user: exchange.user,
                assistant: exchange.reply
              }))
            }))
      markMemoriesUsed(memories.map((record) => record.id))
      return untrustedData(
        'memory-recall',
        query,
        JSON.stringify({
          memories: memories.map(brief),
          conversations,
          note:
            memories.length || conversations.length
              ? 'Earlier assistant replies may be wrong or outdated; prefer the current request and newer entries.'
              : settings?.episodes === true || source === 'memories'
                ? 'Nothing matched. Try other key words, or say you do not remember.'
                : 'Nothing matched. Conversation recall is off in Settings > Memory.'
        })
      )
    }
    if (name === 'forget') {
      const target = listMemories().find((record) => record.id === args.id)
      if (target && !inMemoryScope(target, workspace, chatId))
        throw new Error('that memory belongs to another chat or working folder.')
      const { record, change } = forgetMemory(String(args.id))
      return JSON.stringify({
        kind: 'memory-change',
        operation: 'forget',
        change,
        memory: {
          title: record.title,
          content: record.content,
          kind: record.kind,
          scope: record.scope
        }
      })
    }
    const draft = {
      ...(typeof args.id === 'string' ? { id: args.id } : {}),
      title: String(args.title ?? '').trim(),
      content: String(args.content ?? '').trim(),
      kind: args.kind,
      scope: args.scope ?? 'global',
      pinned: false
    }
    if (!validMemoryDraft(draft))
      throw new Error('use a title up to 80 characters and content up to 1,200.')
    if (SECRET.test(`${draft.title} ${draft.content}`))
      throw new Error('it looks like a password, key or card number. Secrets are never saved.')
    if (draft.scope === 'workspace' && !workspace)
      throw new Error('no working folder is selected. Use scope global or chat.')
    const { record, previous, change } = rememberMemory(draft, workspace, chatId)
    return JSON.stringify({
      kind: 'memory-change',
      operation: !previous ? 'remember' : change ? 'update' : 'unchanged',
      change,
      memory: brief(record)
    })
  } catch (error) {
    return `Could not ${name === 'recall' ? 'search memory' : name === 'forget' ? 'forget' : 'save the memory'}: ${(error as Error).message}`
  }
}
