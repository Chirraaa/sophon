import { randomUUID } from 'crypto'
import { validGithubContext } from '../../shared/github-context'
import { serverRecord } from '../plugins/store'
import { chat, generateChatTitle } from '../llm'
import { attachmentInfo, storeImage } from '../services/attachments'
import { TOOL_INFO } from '../tools/registry'
import { fallbackActionLabel } from '../../shared/action-label'
import {
  loadConversations,
  newConversation,
  persistConversations,
  releaseConversations,
  conversationPage,
  conversationTotal,
  expandConversation,
  clearConversation,
  attachmentIds,
  cleanAttachments,
  type ConversationStore,
  type Conversation
} from './store'
import type { ChatEvent, ChatHistory } from '../llm/types'
import { getSettings } from '../settings'
import { startRun, finishRun, assertRun } from '../security/run-manager'
import { securityEvent } from '../security/audit'
import { pruneChatMemories, clearChatMemories } from '../memory/store'
import { resultFailure } from '../workflow/results'
import { searchProviderLabel } from '../network/search-provider'
import { archiveAction, readActionDetails } from './action-details'
let store: ConversationStore
let runningChatId: string | null = null
const listeners = new Set<(snapshot: SessionSnapshot) => void>()
const textListeners = new Set<(update: { chatId: string; itemId: string; text: string }) => void>()
export function onSessionText(
  listener: (update: { chatId: string; itemId: string; text: string }) => void
): () => void {
  textListeners.add(listener)
  return () => {
    textListeners.delete(listener)
  }
}
export function chatPage(
  chatId: string,
  before: number
): { items: ChatItem[]; start: number; total: number } {
  const chat = store.chats.find((chat) => chat.id === chatId)
  if (!chat) throw new Error('Conversation no longer exists.')
  const page = conversationPage(chat, before)
  releaseConversations(store, [store.activeId, runningChatId ?? ''])
  return page
}
export function actionDetails(id: string): { preview?: string; detail?: string } {
  return readActionDetails(id)
}
export function loadSession(): void {
  store = loadConversations()
  const old = attachmentIds(store)

  const retention = getSettings().privacy.chatRetentionDays
  if (retention)
    store.chats = store.chats.filter((c) => c.updatedAt >= Date.now() - retention * 86400000)
  if (!store.chats.length) store.chats.push(newConversation())
  if (!store.chats.some((c) => c.id === store.activeId)) store.activeId = store.chats[0].id
  if (retention) persistConversations(store)
  pruneChatMemories(new Set(store.chats.map((chat) => chat.id)))
  cleanAttachments(store, old)
}
export function snapshot(): SessionSnapshot {
  const active = store.chats.find((value) => value.id === store.activeId)!
  return {
    mode: active.mode,
    chatId: active.id,
    githubContext: validGithubContext(active.githubContext) ? active.githubContext : undefined,
    items: active.items.slice(-60),
    totalItems: conversationTotal(active),
    busy: runningChatId !== null,
    runningChatId,
    chats: store.chats.map(({ id, title, updatedAt, categoryId }) => ({
      id,
      title,
      updatedAt,
      categoryId
    })),
    categories: (store.categories ?? []).map((category) => ({ ...category }))
  }
}
export function onSession(listener: (snapshot: SessionSnapshot) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function emit(save = true): void {
  if (save) persistConversations(store)
  if (save) releaseConversations(store, [store.activeId, runningChatId ?? ''])
  const state = snapshot()
  listeners.forEach((listener) => listener(state))
}
export function createChat(): void {
  const conversation = newConversation()
  store.chats.unshift(conversation)
  store.activeId = conversation.id
  emit()
}
export function selectChat(id: string): void {
  if (!store.chats.some((value) => value.id === id)) return
  store.activeId = id
  emit()
}
export function setGithubContext(chatId: string, context: GithubContext | null): void {
  if (runningChatId) throw new Error('Wait for the current task to finish before changing context.')
  const conversation = store.chats.find((chat) => chat.id === chatId)
  if (!conversation) throw new Error('This chat no longer exists. Open a chat and try again.')
  if (context !== null) {
    if (!validGithubContext(context))
      throw new Error('Choose an account, owned repository and branch.')
    const server = serverRecord(context.serverId)
    if (server.config.type !== 'http' || server.config.url !== 'https://api.githubcopilot.com/mcp/')
      throw new Error('Choose an official GitHub account connection.')
    if (!server.githubLogin || server.githubLogin.toLowerCase() !== context.account.toLowerCase())
      throw new Error('This account identity changed. Reload your GitHub account and try again.')
  }
  conversation.githubContext = context === null ? undefined : { ...context }
  emit()
}
export function renameChat(id: string, title: string): void {
  const conversation = store.chats.find((value) => value.id === id)
  if (!conversation || typeof title !== 'string' || !title.trim()) return
  conversation.title = title.trim().slice(0, 80)
  emit()
}
function categoryName(name: string, exceptId?: string): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
    throw new Error('Use a category name between 1 and 60 characters.')
  const trimmed = name.trim()
  if (
    (store.categories ?? []).some(
      (category) =>
        category.id !== exceptId && category.name.toLowerCase() === trimmed.toLowerCase()
    )
  )
    throw new Error('A category with this name already exists.')
  return trimmed
}
export function createChatCategory(name: string): void {
  const trimmed = categoryName(name)
  store.categories ??= []
  if (store.categories.length >= 50) throw new Error('Create up to 50 categories.')
  store.categories.push({ id: randomUUID(), name: trimmed })
  emit()
}
export function renameChatCategory(id: string, name: string): void {
  const category = store.categories?.find((category) => category.id === id)
  if (!category) throw new Error('Category no longer exists.')
  category.name = categoryName(name, id)
  emit()
}
export function deleteChatCategory(id: string): void {
  store.categories = (store.categories ?? []).filter((category) => category.id !== id)
  for (const chat of store.chats) if (chat.categoryId === id) delete chat.categoryId
  emit()
}
export function moveChat(
  id: string,
  categoryId: string | null,
  beforeId: string | null = null
): void {
  const chat = store.chats.find((chat) => chat.id === id)
  if (!chat) throw new Error('Chat no longer exists.')
  if (categoryId !== null && !store.categories?.some((category) => category.id === categoryId))
    throw new Error('Category no longer exists.')
  if (beforeId === id) return
  const before = beforeId ? store.chats.find((chat) => chat.id === beforeId) : undefined
  if (beforeId && (!before || (before.categoryId ?? null) !== categoryId))
    throw new Error('The destination chat has moved. Try again.')
  chat.categoryId = categoryId ?? undefined
  store.chats = store.chats.filter((item) => item !== chat)
  const index = before ? store.chats.indexOf(before) : store.chats.length
  store.chats.splice(index, 0, chat)
  emit()
}
export function deleteChat(id: string): void {
  if (runningChatId === id) throw new Error('Wait for this chat to finish before deleting it.')
  clearChatMemories(id)
  const old = attachmentIds(store)
  store.chats = store.chats.filter((value) => value.id !== id)
  if (!store.chats.length) store.chats.push(newConversation())
  if (!store.chats.some((value) => value.id === store.activeId)) store.activeId = store.chats[0].id
  emit()
  cleanAttachments(store, old)
}
export function clear(): void {
  if (runningChatId === store.activeId) return
  const active = store.chats.find((value) => value.id === store.activeId)!
  const old = attachmentIds(store)
  clearChatMemories(active.id)
  clearConversation(active)
  emit()
  cleanAttachments(store, old)
}
export async function rerun(
  chatId: string,
  itemId: string,
  text: string,
  interaction?: InteractionContext
): Promise<void> {
  if (runningChatId) throw new Error('Stop the current response before rerunning.')
  try {
    const original = store.chats.find((value) => value.id === chatId)
    if (original) expandConversation(original)
    const index =
      original?.items.findIndex((item) => item.id === itemId && item.from === 'you') ?? -1
    if (!original || index < 0) throw new Error('This prompt no longer exists.')
    const prompt = original.items[index]
    if (text.length > 32000 || (!text.trim() && !prompt.attachments?.length))
      throw new Error('Enter a prompt of up to 32,000 characters.')
    await respond(
      original,
      text,
      (prompt.attachments ?? []).map((attachment) => attachment.id),
      interaction,
      prompt
    )
  } finally {
    persistConversations(store)
    releaseConversations(store, [store.activeId, runningChatId ?? ''])
  }
}
function precedingHistory(items: ChatItem[], index: number): ChatHistory {
  const history: ChatHistory = []

  const limit = Math.max(1, getSettings().model.historyTurns)
  for (let cursor = index - 2; cursor >= 0 && history.length < limit; cursor--) {
    const user = items[cursor]
    const answer = items[cursor + 1]
    if (user.from !== 'you' || answer?.from !== 'agent' || answer.pending) continue
    history.unshift([
      {
        role: 'user',
        content: user.text + (user.attachments?.length ? '\n[Historical attachments omitted.]' : '')
      },
      { role: 'assistant', content: answer.text }
    ])
    cursor--
  }
  return history
}
export async function send(
  text: string,
  attachmentIds: string[] = [],
  interaction?: InteractionContext
): Promise<void> {
  const conversation = store.chats.find((value) => value.id === store.activeId)!
  await respond(conversation, text, attachmentIds, interaction)
}
async function respond(
  conversation: Conversation,
  text: string,
  promptAttachmentIds: string[],
  interaction?: InteractionContext,
  prompt?: ChatItem
): Promise<void> {
  const trimmed = text.trim()
  if (!Array.isArray(promptAttachmentIds) || promptAttachmentIds.length > 4)
    throw new Error('Attach up to four files.')
  if (!trimmed && !promptAttachmentIds.length) return
  if (runningChatId)
    throw new Error('Wait for the current response before sending another message.')
  if (text.length > 32000) throw new Error('Message is too long.')
  const previousItems = conversation.items
  const previousCount = previousItems.length
  const attachments = await Promise.all(promptAttachmentIds.map(attachmentInfo))
  if (runningChatId)
    throw new Error('Wait for the current response before sending another message.')
  if (!store.chats.includes(conversation))
    throw new Error('This chat was deleted. Please choose another chat.')
  if (
    prompt &&
    (conversation.items !== previousItems || conversation.items.length !== previousCount)
  )
    throw new Error('This conversation changed. Please rerun the prompt again.')
  const index = prompt ? conversation.items.indexOf(prompt) : -1
  const history = prompt ? precedingHistory(conversation.items, index) : undefined
  const removedAttachments = prompt ? attachmentIds(store) : undefined
  const settings = getSettings()
  const run = startRun(
    conversation.mode,
    settings.model.endpoint,
    settings.files.workspace,
    interaction
  )
  runningChatId = conversation.id
  securityEvent('run_started', run.id)
  const needsTitle = !prompt && !conversation.items.length && conversation.title === 'New chat'
  if (prompt) {
    conversation.items = conversation.items.slice(0, index + 1)
    prompt.text = trimmed
    prompt.attachments = attachments
    conversation.history = history!
    delete conversation.workflow
  } else if (needsTitle)
    conversation.title = (trimmed || attachments[0]?.name || 'New chat').slice(0, 60)
  const initialTitle = conversation.title
  conversation.updatedAt = Date.now()
  const reply: ChatItem = {
    id: randomUUID(),
    from: 'agent',
    text: '',
    actions: [],
    attachments: [],
    pending: true
  }
  if (!prompt)
    conversation.items.push({
      id: randomUUID(),
      from: 'you',
      text: trimmed,
      attachments,
      actions: [],
      pending: false
    })
  conversation.items.push(reply)
  run.onModelUsage = (usage) => {
    reply.usage = { ...usage }
    emit(false)
  }
  run.onModelContext = (context) => {
    reply.context = {
      droppedTurns: 0,
      memories: [],
      playbooks: [],
      ...reply.context,
      ...context
    }
    emit(false)
  }
  const images: Promise<void>[] = []
  let textTimer: ReturnType<typeof setTimeout> | undefined
  let progressTimer: ReturnType<typeof setTimeout> | undefined
  const onEvent = (event: ChatEvent): void => {
    reply.sources = run.sources.map((source) => ({ ...source }))
    if (event.type === 'model_progress') {
      const first = !reply.modelProgress
      reply.modelProgress = event.progress
      if (!event.progress || first) {
        clearTimeout(progressTimer)
        progressTimer = undefined
        emit(false)
      } else {
        progressTimer ??= setTimeout(() => {
          progressTimer = undefined
          emit(false)
        }, 250)
      }
      return
    }
    if (event.type === 'tool_output') {
      const action = reply.actions.find((value) => value.id === event.id)
      if (action) action.detail = event.output
      emit(false)
      return
    }
    if (event.type === 'text') {
      reply.text = event.text

      textTimer ??= setTimeout(() => {
        textTimer = undefined
        for (const listener of textListeners)
          listener({ chatId: conversation.id, itemId: reply.id, text: reply.text })
      }, 32)
      return
    }
    if (event.type === 'quality') {
      reply.quality = event.status
      emit(false)
      return
    }
    if (event.type === 'specialist') {
      reply.specialists ??= []
      const index = reply.specialists.findIndex((item) => item.id === event.run.id)
      if (index < 0) reply.specialists.push(event.run)
      else reply.specialists[index] = event.run
      emit()
      return
    }
    if (event.type === 'workflow') {
      conversation.workflow = event.state
      reply.workflow = event.state
      emit()
      return
    }
    if (event.type === 'context') {
      reply.context = event.report
      emit(false)
      return
    }
    if (event.type === 'tool_start') {
      reply.actions.push({
        id: event.id,
        name: event.name,
        label:
          TOOL_INFO.find((tool) => tool.name === event.name)?.label ??
          fallbackActionLabel(event.name),
        status: 'running',
        preview: JSON.stringify(
          {
            taskId: run.id,
            mode: run.mode,
            model: run.endpoint,
            workspace: [
              'list_files',
              'read_file',
              'write_file',
              'edit_file',
              'create_directory',
              'delete_file',
              'delete_directory'
            ].includes(event.name)
              ? run.workspace
              : undefined,
            provider: event.name === 'web_search' ? searchProviderLabel() : undefined,
            arguments: event.args
          },
          null,
          2
        )
      })
    } else {
      const action = reply.actions.find((value) => value.id === event.id)
      if (action) {
        if (event.type === 'tool_preview') action.preview = event.preview
        else if (event.type === 'tool_wait') {
          action.status = 'waiting'
          action.canAlwaysAllow = event.canAlwaysAllow
        } else if (event.type === 'tool_resume') action.status = 'running'
        else {
          action.status = (
            event.outcome
              ? ['denied', 'failed', 'uncertain'].includes(event.outcome)
              : resultFailure(event.result)
          )
            ? 'failed'
            : 'done'
          action.detail = event.result
          if (event.image)
            images.push(
              storeImage(
                event.image,
                action.name === 'read_file' ? 'Image preview.jpg' : 'Screenshot.jpg'
              )
                .then((attachment) => {
                  reply.attachments!.push(attachment)
                  emit()
                })
                .catch((error: Error) => {
                  action.detail += `\nPreview unavailable: ${error.message}`
                })
            )
        }
      }
    }
    for (const action of reply.actions) archiveAction(action)
    emit()
  }
  try {
    emit()
    if (removedAttachments) cleanAttachments(store, removedAttachments)
    reply.text = await chat(
      trimmed || 'Describe the attached files.',
      onEvent,
      conversation.history,
      promptAttachmentIds,
      conversation.id,
      conversation.workflow,
      validGithubContext(conversation.githubContext) ? conversation.githubContext : undefined
    )
    assertRun(run)
    await Promise.all(images)
    if (needsTitle) {
      const title = await generateChatTitle(trimmed || attachments[0]?.name || '', reply.text)
      if (title && conversation.title === initialTitle && !run.signal.aborted)
        conversation.title = title
    }
  } catch (error) {
    delete reply.quality
    const detail = run.signal.aborted
      ? 'Stopped. No further actions will run.'
      : `Error: ${(error as Error).message}`
    reply.text = reply.text ? reply.text + '\n\n' + detail : detail
  } finally {
    clearTimeout(textTimer)
    clearTimeout(progressTimer)
    delete reply.modelProgress

    await Promise.all(images)
    reply.sources = run.sources.map((source) => ({ ...source }))
    securityEvent('run_stopped', run.id)
    finishRun(run)
    for (const action of reply.actions) {
      if (action.status === 'waiting' || action.status === 'running') {
        action.status = 'failed'
        action.detail = 'Task stopped or interrupted.'
      }
    }
    reply.pending = false
    if (reply.quality === 'checking') delete reply.quality
    for (const specialist of reply.specialists ?? [])
      if (specialist.status === 'running') {
        specialist.status = 'failed'
        specialist.summary = 'Request stopped or interrupted.'
      }
    runningChatId = null
    conversation.updatedAt = Date.now()
    emit()
  }
}
