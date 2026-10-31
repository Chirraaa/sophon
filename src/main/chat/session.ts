import { randomUUID } from 'crypto'
import { validGithubContext } from '../../shared/github-context'
import { serverRecord } from '../plugins/store'
import { chat, generateChatTitle, saveTurn } from '../llm'
import { attachmentInfo, storeImage } from '../services/attachments'
import { TOOL_INFO } from '../tools/registry'
import { fallbackActionLabel } from '../../shared/action-label'
import { mergeContext } from '../../shared/context-usage'
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
import { getSettings, onSettingsChange } from '../settings'
import {
  startRun,
  finishRun,
  assertRun,
  withRun,
  stopRun,
  setRunLimit,
  type RunAgent,
  type RunContext
} from '../security/run-manager'
import { securityEvent } from '../security/audit'
import { takeChatClear } from './clear-request'
import { pruneChatMemories, clearChatMemories } from '../memory/store'
import { deleteEpisode, pruneEpisodes, recordEpisode, renameEpisode } from '../memory/episodes'
import { resultFailure } from '../workflow/results'
import { searchProviderLabel } from '../network/search-provider'
import { archiveAction, readActionDetails } from './action-details'
import {
  agentFinished,
  agentsEnabled,
  installAgents,
  nextIdentity,
  runAgentFor,
  senderOf
} from './agents'
let store: ConversationStore
// Chats and agent threads with a running task. Several can run at once (parallel agents).
const running = new Map<string, RunContext>()
// Where each queued follow-up was sent from, so a task started from it keeps that surface.
const followUpInteractions = new Map<string, InteractionContext>()
const MAX_FOLLOW_UPS = 8
const queuedFollowUps = (conversation: Conversation): ChatItem[] =>
  conversation.items.filter((item) => item.followUp === 'queued')
const listeners = new Set<(snapshot: SessionSnapshot) => void>()
const textListeners = new Set<(update: { chatId: string; itemId: string; text: string }) => void>()

const chatById = (id: string): Conversation | undefined =>
  store.chats.find((chat) => chat.id === id)
// Agent threads hang off their top-level chat.
const rootOf = (chat: Conversation): Conversation =>
  (chat.parentId ? chatById(chat.parentId) : undefined) ?? chat
const familyOf = (rootId: string): Conversation[] =>
  store.chats.filter((chat) => chat.parentId === rootId)
const familyBusy = (root: Conversation): boolean =>
  running.has(root.id) || familyOf(root.id).some((chat) => running.has(chat.id))
// 0 for a chat's own task, 1 for agents it starts, 2 for agents those start.
function agentDepth(chat: Conversation): number {
  if (!chat.parentId) return 0
  const spawner = chat.agent?.spawnedBy ? chatById(chat.agent.spawnedBy) : undefined
  return spawner?.parentId ? 2 : 1
}
const pinned = (): string[] => [store.activeId, ...running.keys()]
const runLimit = (): number => {
  const agents = getSettings().agents
  return agents?.enabled === false ? 1 : Math.max(1, agents?.maxConcurrent ?? 1)
}

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
  const chat = chatById(chatId)
  if (!chat) throw new Error('Conversation no longer exists.')
  const page = conversationPage(chat, before)
  releaseConversations(store, pinned())
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
    store.chats = store.chats.filter(
      (c) => c.parentId || c.updatedAt >= Date.now() - retention * 86400000
    )
  // Agent threads go with their chat.
  store.chats = store.chats.filter(
    (c) => !c.parentId || store.chats.some((root) => root.id === c.parentId && !root.parentId)
  )
  for (const chat of store.chats)
    if (chat.agent?.status === 'running') {
      chat.agent.status = 'stopped'
      chat.agent.summary ||= 'Interrupted when Sophon closed.'
      chat.agent.finishedAt ??= Date.now()
    }
  if (!store.chats.some((c) => !c.parentId)) store.chats.push(newConversation())
  if (!store.chats.some((c) => c.id === store.activeId))
    store.activeId = store.chats.find((c) => !c.parentId)!.id
  if (retention) persistConversations(store)
  pruneChatMemories(new Set(store.chats.map((chat) => chat.id)))
  updateEpisodes(() => pruneEpisodes(new Set(store.chats.map((chat) => chat.id))))
  cleanAttachments(store, old)
  setRunLimit(runLimit())
  onSettingsChange(() => setRunLimit(runLimit()))
  installAgents(bridge)
}
// Conversation memory follows the chat's lifetime. A failure here must not block deleting or
// clearing the chat itself; the next startup prunes digests of chats that no longer exist.
function updateEpisodes(action: () => void): void {
  try {
    action()
  } catch {
    /* Retried by the startup prune. */
  }
}

// The latest action of a running thread, for agent cards and the roster.
function activity(chat: Conversation): string | undefined {
  if (!running.has(chat.id)) return undefined
  const reply = chat.items.findLast((item) => item.pending && item.from === 'agent')
  const action = reply?.actions.at(-1)
  if (action?.status === 'waiting') return `Waiting for your approval: ${action.label}`
  if (action?.status === 'running') return action.label
  return reply?.text ? 'Writing its answer' : 'Thinking'
}
const waitingApproval = (chat: Conversation): boolean =>
  running.has(chat.id) &&
  chat.items.some((item) => item.pending && item.actions.some((a) => a.status === 'waiting'))
function agentInfo(chat: Conversation): AgentInfo {
  const live = running.has(chat.id)
  return {
    ...chat.agent!,
    chatId: chat.id,
    parentId: chat.parentId!,
    ...(live
      ? { status: 'running' as const, activity: activity(chat), waiting: waitingApproval(chat) }
      : {})
  }
}
// Approvals waiting in a chat's other threads, so they can be answered from where the user is.
function approvalsFor(active: Conversation, root: Conversation): AgentApproval[] {
  return [root, ...familyOf(root.id)]
    .filter((chat) => chat !== active && running.has(chat.id))
    .flatMap((chat) =>
      chat.items
        .filter((item) => item.pending)
        .flatMap((item) => item.actions.filter((action) => action.status === 'waiting'))
        .map((action) => ({ ...senderOf(chat), action: { ...action } }))
    )
}
export function snapshot(): SessionSnapshot {
  const active = chatById(store.activeId)!
  const root = rootOf(active)
  const runningIds = [...running.keys()]
  return {
    mode: active.mode,
    chatId: active.id,
    githubContext: validGithubContext(active.githubContext) ? active.githubContext : undefined,
    items: active.items.slice(-60),
    totalItems: conversationTotal(active),
    busy: active.parentId ? running.has(active.id) : familyBusy(root),
    runningChatId: running.has(active.id)
      ? active.id
      : (runningIds.find((id) => !chatById(id)?.parentId) ?? runningIds[0] ?? null),
    runningChatIds: runningIds,
    rootChatId: root.id,
    agent: active.agent ? agentInfo(active) : undefined,
    agents: familyOf(root.id)
      .filter((chat) => chat.agent)
      .slice(-30)
      .map(agentInfo),
    approvals: approvalsFor(active, root),
    chats: store.chats
      .filter((chat) => !chat.parentId)
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        categoryId: chat.categoryId,
        ...(familyBusy(chat) ? { running: true } : {})
      })),
    categories: (store.categories ?? []).map((category) => ({ ...category }))
  }
}
// Whether a message sent to the open chat can be taken now: it joins or is routed within the
// open chat's work, or there is room for another task.
export function acceptsMessages(): boolean {
  const active = chatById(store.activeId)
  if (!active) return false
  return running.has(active.id) || familyBusy(rootOf(active)) || running.size < runLimit()
}
export function onSession(listener: (snapshot: SessionSnapshot) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function emit(save = true): void {
  if (save) persistConversations(store)
  if (save) releaseConversations(store, pinned())
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
  if (!chatById(id)) return
  store.activeId = id
  emit()
}
export function setGithubContext(chatId: string, context: GithubContext | null): void {
  const conversation = chatById(chatId)
  if (!conversation) throw new Error('This chat no longer exists. Open a chat and try again.')
  if (familyBusy(rootOf(conversation)))
    throw new Error('Wait for the current task to finish before changing context.')
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
  const conversation = chatById(id)
  if (!conversation || typeof title !== 'string' || !title.trim()) return
  conversation.title = title.trim().slice(0, 80)
  if (conversation.agent) conversation.agent.title = conversation.title.slice(0, 60)
  else updateEpisodes(() => renameEpisode(id, conversation.title))
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
  const chat = chatById(id)
  if (!chat || chat.parentId) throw new Error('Chat no longer exists.')
  if (categoryId !== null && !store.categories?.some((category) => category.id === categoryId))
    throw new Error('Category no longer exists.')
  if (beforeId === id) return
  const before = beforeId ? chatById(beforeId) : undefined
  if (beforeId && (!before || (before.categoryId ?? null) !== categoryId))
    throw new Error('The destination chat has moved. Try again.')
  chat.categoryId = categoryId ?? undefined
  store.chats = store.chats.filter((item) => item !== chat)
  const index = before ? store.chats.indexOf(before) : store.chats.length
  store.chats.splice(index, 0, chat)
  emit()
}
export function deleteChat(id: string): void {
  const target = chatById(id)
  if (!target) return
  const root = rootOf(target)
  const removed = target.parentId ? [target] : [target, ...familyOf(target.id)]
  if (removed.some((chat) => running.has(chat.id)))
    throw new Error('Wait for this chat to finish before deleting it.')
  for (const chat of removed) clearChatMemories(chat.id)
  if (!target.parentId) updateEpisodes(() => deleteEpisode(id))
  const old = attachmentIds(store)
  store.chats = store.chats.filter((value) => !removed.includes(value))
  if (target.parentId)
    for (const item of root.items) if (item.agentRef === target.id) delete item.agentRef
  if (!store.chats.some((value) => !value.parentId)) store.chats.push(newConversation())
  if (!chatById(store.activeId))
    store.activeId = target.parentId ? root.id : store.chats.find((value) => !value.parentId)!.id
  emit()
  cleanAttachments(store, old)
}
export function clear(): void {
  const active = chatById(store.activeId)!
  const root = rootOf(active)
  if (active.parentId ? running.has(active.id) : familyBusy(root)) return
  const old = attachmentIds(store)
  clearChatMemories(active.id)
  if (!active.parentId) {
    updateEpisodes(() => deleteEpisode(active.id))
    // A cleared chat starts over without its agents.
    const agents = familyOf(active.id)
    for (const agent of agents) clearChatMemories(agent.id)
    store.chats = store.chats.filter((chat) => !agents.includes(chat))
  }
  clearConversation(active)
  emit()
  cleanAttachments(store, old)
}
// Stops a chat's task and all of its agents, or one agent thread. No id stops every task.
export function stopChat(chatId?: string): void {
  if (chatId === undefined) return stopRun()
  const chat = chatById(chatId)
  if (!chat) return
  const threads = chat.parentId ? [chat] : [chat, ...familyOf(chat.id)]
  for (const thread of threads) {
    const run = running.get(thread.id)
    if (run) stopRun(run.id)
  }
}
export async function rerun(
  chatId: string,
  itemId: string,
  text: string,
  interaction?: InteractionContext
): Promise<void> {
  if (running.has(chatId)) throw new Error('Stop the current response before rerunning.')
  try {
    const original = chatById(chatId)
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
    releaseConversations(store, pinned())
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
  interaction?: InteractionContext,
  route?: AgentRoute
): Promise<void> {
  const conversation = chatById(store.activeId)!
  if (!running.has(conversation.id)) return respond(conversation, text, attachmentIds, interaction)
  const choice = route ?? getSettings().agents?.route ?? 'auto'
  // An agent thread's own composer always talks to that agent.
  if (conversation.parentId || choice === 'steer' || !agentsEnabled())
    return queueFollowUp(conversation, text, attachmentIds, interaction)
  return dispatch(conversation, text, attachmentIds, interaction, choice)
}
const BUSY_ELSEWHERE =
  'Sophon is working in another chat. Open that chat to add to its request, or wait for it to finish.'
function validMessage(text: string, attachmentIds: string[]): boolean {
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 4)
    throw new Error('Attach up to four files.')
  if (text.length > 32000) throw new Error('Message is too long.')
  return !!text.trim() || attachmentIds.length > 0
}
// A message sent to the chat that is already working waits for the task's next step.
async function queueFollowUp(
  conversation: Conversation,
  text: string,
  attachmentIds: string[],
  interaction?: InteractionContext
): Promise<void> {
  const trimmed = text.trim()
  if (!validMessage(text, attachmentIds)) return
  const attachments = await Promise.all(attachmentIds.map(attachmentInfo))
  if (!store.chats.includes(conversation))
    throw new Error('This chat was deleted. Please choose another chat.')
  // The task finished while the attachments were read: this message starts the next one.
  if (!running.has(conversation.id)) return respond(conversation, text, attachmentIds, interaction)
  if (queuedFollowUps(conversation).length >= MAX_FOLLOW_UPS)
    throw new Error(
      `Up to ${MAX_FOLLOW_UPS} messages can wait for the current task. Remove one or wait for Sophon to read them.`
    )
  const item: ChatItem = {
    id: randomUUID(),
    from: 'you',
    text: trimmed,
    attachments,
    actions: [],
    pending: false,
    followUp: 'queued'
  }
  conversation.items.push(item)
  if (interaction) followUpInteractions.set(item.id, interaction)
  conversation.updatedAt = Date.now()
  emit()
}
const titleFrom = (text: string, attachments: ChatAttachment[]): string => {
  const words = (text.trim() || attachments[0]?.name || 'Follow-up').replace(/\s+/g, ' ')
  return words.length > 48 ? words.slice(0, 47).trimEnd() + '…' : words
}
function newAgentThread(root: Conversation, agent: AgentMeta): Conversation {
  const thread: Conversation = {
    ...newConversation(),
    title: agent.title,
    parentId: root.id,
    agent,
    githubContext: root.githubContext
  }
  store.chats.push(thread)
  root.updatedAt = Date.now()
  return thread
}
function startAgent(
  thread: Conversation,
  text: string,
  attachments: string[],
  interaction?: InteractionContext,
  sender?: AgentSender
): void {
  respond(thread, text, attachments, interaction, undefined, undefined, {
    agent: runAgentFor(thread, agentDepth(thread)),
    sender
  }).catch((error: Error) => {
    // The run never started (for example the run limit was reached meanwhile).
    if (thread.agent?.status === 'running' && !running.has(thread.id))
      finishAgent(thread, 'failed', `Could not start: ${error.message}`)
  })
}
// A message to a busy chat starts an agent of its own: a router that decides whether it
// belongs to a running agent (and relays it), or a worker when the user chose parallel.
async function dispatch(
  root: Conversation,
  text: string,
  attachmentIds: string[],
  interaction: InteractionContext | undefined,
  route: 'auto' | 'parallel'
): Promise<void> {
  const trimmed = text.trim()
  if (!validMessage(text, attachmentIds)) return
  const attachments = await Promise.all(attachmentIds.map(attachmentInfo))
  if (!store.chats.includes(root))
    throw new Error('This chat was deleted. Please choose another chat.')
  if (!running.has(root.id)) return respond(root, text, attachmentIds, interaction)
  // No room for another task right now: the running task reads it instead.
  if (running.size >= runLimit()) return queueFollowUp(root, text, attachmentIds, interaction)
  const { handle, color } = nextIdentity(familyOf(root.id))
  const thread = newAgentThread(root, {
    handle,
    color,
    kind: route === 'parallel' ? 'worker' : 'router',
    title: titleFrom(trimmed, attachments),
    task: trimmed || attachments.map((attachment) => attachment.name).join(', '),
    status: 'running',
    startedAt: Date.now()
  })
  root.items.push(
    {
      id: randomUUID(),
      from: 'you',
      text: trimmed,
      attachments,
      actions: [],
      pending: false,
      agentRef: thread.id
    },
    { id: randomUUID(), from: 'agent', text: '', actions: [], pending: true, agentRef: thread.id }
  )
  emit()
  startAgent(thread, text, attachmentIds, interaction)
}
// Records how an agent ended: on its thread, its card in the chat, the chat's history (so
// later turns know what happened) and for anyone waiting on it.
function finishAgent(thread: Conversation, status: AgentStatus, answer: string): void {
  const meta = thread.agent
  if (!meta) return
  meta.status = status
  meta.finishedAt = Date.now()
  meta.summary = answer.slice(0, 4000)
  const root = rootOf(thread)
  const card = root.items.findLast((item) => item.agentRef === thread.id && item.from === 'agent')
  if (card) {
    card.text = meta.summary || (status === 'done' ? 'Done.' : 'Stopped.')
    card.pending = false
  }
  if (status !== 'stopped' && getSettings().model.historyTurns > 0)
    saveTurn(root.history, [
      {
        role: 'user',
        content: `[While you worked, agent ${meta.handle} ("${meta.title}") handled this in parallel] ${meta.task}`
      },
      { role: 'assistant', content: meta.summary || 'No answer.' }
    ])
  root.updatedAt = Date.now()
  const observed = agentFinished(thread.id)
  // Whoever started it hears about the result at its next step, unless it was waiting.
  const spawner = meta.spawnedBy ? chatById(meta.spawnedBy) : undefined
  if (!observed && spawner && running.has(spawner.id))
    try {
      deliver(
        spawner,
        `Agent ${meta.handle} ("${meta.title}") ${status === 'done' ? 'finished' : status}. Its answer:\n${meta.summary}`,
        senderOf(thread)
      )
    } catch {
      // Its queue is full; check_agents still shows the result.
    }
  emit()
}
function deliver(target: Conversation, text: string, sender: AgentSender): ChatItem {
  if (queuedFollowUps(target).length >= MAX_FOLLOW_UPS)
    throw new Error(`Agent ${senderOf(target).handle} has too many unread messages; try later.`)
  const item: ChatItem = {
    id: randomUUID(),
    from: 'you',
    text,
    actions: [],
    pending: false,
    followUp: 'queued',
    sender
  }
  target.items.push(item)
  target.updatedAt = Date.now()
  emit()
  return item
}
const bridge = {
  chat: (id: string) => chatById(id),
  family: (rootId: string) => familyOf(rootId).filter((chat) => chat.agent),
  running: (chatId: string) => running.get(chatId),
  activity: (chatId: string) => {
    const chat = chatById(chatId)
    return chat ? activity(chat) : undefined
  },
  lastAnswer: (chatId: string) => {
    const chat = chatById(chatId)
    if (!chat) return ''
    if (chat.agent?.summary && !running.has(chat.id)) return chat.agent.summary
    return (
      chat.items.findLast((item) => item.from === 'agent' && !item.pending && !item.agentRef)
        ?.text ?? ''
    )
  },
  deliver: (chatId: string, text: string, sender: AgentSender) => {
    const target = chatById(chatId)
    if (!target || !running.has(chatId)) throw new Error('That agent is no longer running.')
    const item = deliver(target, text, sender)
    return { read: () => item.followUp !== 'queued' }
  },
  spawn: (
    spawnerChatId: string,
    agent: { title: string; task: string; context?: string },
    interaction: InteractionContext
  ) => {
    const spawner = chatById(spawnerChatId)
    if (!spawner) throw new Error('This chat no longer exists.')
    if (running.size >= runLimit())
      throw new Error(
        `${running.size} tasks are already running, the most allowed at once (Settings > Agents). Wait for one with check_agents, or do this part yourself.`
      )
    const root = rootOf(spawner)
    const { handle, color } = nextIdentity(familyOf(root.id))
    const thread = newAgentThread(root, {
      handle,
      color,
      kind: 'worker',
      title: agent.title,
      task: agent.task,
      status: 'running',
      spawnedBy: spawner.id,
      startedAt: Date.now()
    })
    root.items.push({
      id: randomUUID(),
      from: 'agent',
      text: '',
      actions: [],
      pending: true,
      agentRef: thread.id
    })
    emit()
    startAgent(
      thread,
      agent.context ? `${agent.task}\n\nContext:\n${agent.context}` : agent.task,
      [],
      interaction,
      senderOf(spawner)
    )
    return thread.id
  }
}
export function removeFollowUp(chatId: string, itemId: string): void {
  const conversation = chatById(chatId)
  const item = conversation?.items.find((value) => value.id === itemId)
  if (!conversation || !item?.followUp)
    throw new Error('Sophon already read this message, so it can no longer be removed.')
  const old = attachmentIds(store)
  conversation.items.splice(conversation.items.indexOf(item), 1)
  followUpInteractions.delete(item.id)
  emit()
  cleanAttachments(store, old)
}
async function respond(
  conversation: Conversation,
  text: string,
  promptAttachmentIds: string[],
  interaction?: InteractionContext,
  prompt?: ChatItem,
  // A follow-up left over from the previous task, already in the conversation.
  queued?: ChatItem,
  // Agent threads: who the run works as, and who handed it the task.
  options: { agent?: RunAgent; sender?: AgentSender } = {}
): Promise<void> {
  const trimmed = text.trim()
  if (!Array.isArray(promptAttachmentIds) || promptAttachmentIds.length > 4)
    throw new Error('Attach up to four files.')
  if (!trimmed && !promptAttachmentIds.length) return
  if (running.has(conversation.id))
    throw new Error('Wait for the current response before sending another message.')
  if (text.length > 32000) throw new Error('Message is too long.')
  const previousItems = conversation.items
  const previousCount = previousItems.length
  // A queued prompt already holds its attachment details, so it starts without
  // yielding and no other request can claim the run first.
  const attachments = queued
    ? (queued.attachments ?? [])
    : await Promise.all(promptAttachmentIds.map(attachmentInfo))
  if (running.has(conversation.id))
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
  let run: RunContext
  try {
    run = startRun(
      conversation.mode,
      settings.model.endpoint,
      settings.files.workspace,
      interaction,
      options.agent ?? runAgentFor(conversation, agentDepth(conversation))
    )
  } catch (error) {
    if (runLimit() === 1 && running.size) throw new Error(BUSY_ELSEWHERE, { cause: error })
    throw error
  }
  running.set(conversation.id, run)
  // Everything this task does, including tools and model calls, runs as this run.
  return withRun(run, () =>
    work(conversation, run, trimmed, promptAttachmentIds, attachments, {
      prompt,
      queued,
      history,
      removedAttachments,
      sender: options.sender
    })
  )
}
async function work(
  conversation: Conversation,
  run: RunContext,
  trimmed: string,
  promptAttachmentIds: string[],
  attachments: ChatAttachment[],
  {
    prompt,
    queued,
    history,
    removedAttachments,
    sender
  }: {
    prompt?: ChatItem
    queued?: ChatItem
    history?: ChatHistory
    removedAttachments?: Set<string>
    sender?: AgentSender
  }
): Promise<void> {
  securityEvent('run_started', run.id)
  const needsTitle = !prompt && !conversation.items.length && conversation.title === 'New chat'
  if (prompt) {
    const index = conversation.items.indexOf(prompt)
    conversation.items = conversation.items.slice(0, index + 1)
    prompt.text = trimmed
    prompt.attachments = attachments
    delete prompt.followUp
    conversation.history = history!
    delete conversation.workflow
  } else if (needsTitle)
    conversation.title = (trimmed || attachments[0]?.name || 'New chat').slice(0, 60)
  const initialTitle = conversation.title
  conversation.updatedAt = Date.now()
  const newReply = (): ChatItem => ({
    id: randomUUID(),
    from: 'agent',
    text: '',
    actions: [],
    attachments: [],
    pending: true
  })
  // The reply is split where follow-ups are read, so it can be replaced mid-run.
  let reply = newReply()
  const replies = [reply]
  const asked = [trimmed || attachments.map((attachment) => attachment.name).join(', ')]
  let sourceStart = 0
  const promptId = prompt?.id ?? queued?.id ?? randomUUID()
  if (queued) {
    delete queued.followUp
    followUpInteractions.delete(queued.id)
  } else if (!prompt)
    conversation.items.push({
      id: promptId,
      from: 'you',
      text: trimmed,
      attachments,
      actions: [],
      pending: false,
      ...(sender ? { sender } : {})
    })
  conversation.items.push(reply)
  run.followUps = {
    pending: () => queuedFollowUps(conversation).length > 0,
    take: () => {
      const added = queuedFollowUps(conversation)
      if (!added.length) return []
      for (const item of added) {
        delete item.followUp
        followUpInteractions.delete(item.id)
        if (!item.sender) asked.push(item.text)
      }
      const items = conversation.items
      if (
        !reply.text &&
        !reply.actions.length &&
        !reply.attachments?.length &&
        !reply.specialists?.length
      ) {
        // Nothing shown yet: the reply simply moves below the new messages.
        items.splice(items.indexOf(reply), 1)
        items.push(reply)
      } else {
        // Keep what was done so far as its own reply above the new messages.
        const next = newReply()
        if (reply.workflow) next.workflow = reply.workflow
        delete reply.workflow
        delete reply.modelProgress
        if (reply.quality === 'checking') delete reply.quality
        if (reply.compaction?.status === 'running') delete reply.compaction
        reply.pending = false
        sourceStart = run.sources.length
        reply = next
        replies.push(reply)
        items.push(reply)
      }
      emit()
      return added.map((item) => ({
        text: item.text,
        attachments: (item.attachments ?? []).map((attachment) => attachment.id),
        ...(item.sender ? { sender: item.sender } : {})
      }))
    }
  }
  run.onModelUsage = (usage) => {
    reply.usage = { ...usage }
    emit(false)
  }
  run.onTiming = (timing) => {
    reply.timing = { ...timing }
  }
  run.onModelContext = (context) => {
    reply.context = mergeContext(
      { droppedTurns: 0, memories: [], playbooks: [], ...reply.context },
      context
    ) as ContextReport
    emit(false)
  }
  const images: Promise<void>[] = []
  const captions = new Map<string, string>()
  let textTimer: ReturnType<typeof setTimeout> | undefined
  let progressTimer: ReturnType<typeof setTimeout> | undefined
  let compactionBefore: ContextCompactionNotice | undefined
  let failed = false
  const onEvent = (event: ChatEvent): void => {
    reply.sources = run.sources.slice(sourceStart).map((source) => ({ ...source }))
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
    if (event.type === 'compaction') {
      if (event.status === 'running') {
        compactionBefore = reply.compaction?.status === 'done' ? reply.compaction : undefined
        reply.compaction = { status: 'running', scope: event.scope }
      } else if (event.status === 'skipped') reply.compaction = compactionBefore
      else reply.compaction = { status: 'done', scope: event.scope, info: event.info }
      if (!reply.compaction) delete reply.compaction
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
      reply.context = mergeContext(reply.context, event.report)
      emit(false)
      return
    }
    if (event.type === 'tool_start') {
      const caption = (event.args as { caption?: unknown } | undefined)?.caption
      if (event.name === 'show_image' && typeof caption === 'string')
        captions.set(
          event.id,
          caption
            .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
            .trim()
            .slice(0, 80)
        )
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
          if (event.image) {
            const shown = action.name === 'show_image'
            const owner = reply
            images.push(
              storeImage(
                event.image,
                shown
                  ? `${captions.get(action.id) || 'Image'}.jpg`
                  : action.name === 'read_file'
                    ? 'Image preview.jpg'
                    : 'Screenshot.jpg'
              )
                .then((attachment) => {
                  owner.attachments!.push(shown ? { ...attachment, shown: true } : attachment)
                  emit()
                })
                .catch((error: Error) => {
                  action.detail += `\nPreview unavailable: ${error.message}`
                })
            )
          }
        }
      }
    }
    for (const action of reply.actions) archiveAction(action)
    emit()
  }
  try {
    emit()
    if (removedAttachments) cleanAttachments(store, removedAttachments)
    // Read the answer before assigning: the reply may have split while the task ran.
    const answer = await chat(
      trimmed || 'Describe the attached files.',
      onEvent,
      conversation.history,
      promptAttachmentIds,
      conversation.id,
      conversation.workflow,
      validGithubContext(conversation.githubContext) ? conversation.githubContext : undefined
    )
    reply.text = answer
    assertRun(run)
    await Promise.all(images)
    if (needsTitle) {
      const title = await generateChatTitle(trimmed || attachments[0]?.name || '', reply.text)
      if (title && conversation.title === initialTitle && !run.signal.aborted)
        conversation.title = title
    }
    const memory = getSettings().memory
    // Agent threads are summarised into their chat's history instead.
    if (memory?.enabled && memory.episodes && !run.signal.aborted && !conversation.parentId)
      try {
        recordEpisode({
          chatId: conversation.id,
          title: conversation.title,
          workspace: run.workspace ?? '',
          promptId,
          user: asked.filter(Boolean).join('\n\n'),
          reply: replies
            .map((segment) => segment.text)
            .filter(Boolean)
            .join('\n\n')
        })
      } catch {
        // Conversation memory is best effort; the reply itself succeeded.
      }
  } catch (error) {
    failed = true
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
    reply.sources = run.sources.slice(sourceStart).map((source) => ({ ...source }))
    securityEvent('run_stopped', run.id)
    // finishRun aborts the run's signal, so read whether the user stopped it first.
    const stopped = run.signal.aborted
    if (reply.timing)
      reply.timing = { ...reply.timing, wallMs: Math.round(performance.now() - run.startedAt) }
    finishRun(run)
    for (const action of reply.actions) {
      if (action.status === 'waiting' || action.status === 'running') {
        action.status = 'failed'
        action.detail = 'Task stopped or interrupted.'
      }
    }
    reply.pending = false
    if (reply.quality === 'checking') delete reply.quality
    if (reply.compaction?.status === 'running') delete reply.compaction
    for (const specialist of reply.specialists ?? [])
      if (specialist.status === 'running') {
        specialist.status = 'failed'
        specialist.summary = 'Request stopped or interrupted.'
      }
    if (running.get(conversation.id) === run) running.delete(conversation.id)
    conversation.updatedAt = Date.now()
    const clearing = takeChatClear(run.id) && !stopped
    const leftover = queuedFollowUps(conversation)
    // Messages from other agents that arrived too late are not read by a new task.
    for (const item of leftover) if (item.sender) item.followUp = 'unsent'
    const unread = leftover.filter((item) => !item.sender)
    if (stopped) for (const item of unread) item.followUp = 'unsent'
    // Messages the task ended before reading start the next task; the rest of them
    // are read at its first step. Started before emit releases the conversation.
    else if (unread.length && !clearing && store.chats.includes(conversation))
      startFollowUp(conversation, unread[0], run.interaction)
    if (conversation.agent && store.chats.includes(conversation))
      finishAgent(
        conversation,
        stopped ? 'stopped' : failed ? 'failed' : 'done',
        replies
          .map((segment) => segment.text)
          .filter(Boolean)
          .at(-1) ?? ''
      )
    emit()
    if (clearing) {
      const previous = store.activeId
      store.activeId = conversation.id
      clear()
      if (chatById(previous)) store.activeId = previous
      emit(false)
    }
  }
}
function startFollowUp(
  conversation: Conversation,
  item: ChatItem,
  interaction: InteractionContext
): void {
  respond(
    conversation,
    item.text,
    (item.attachments ?? []).map((attachment) => attachment.id),
    followUpInteractions.get(item.id) ?? interaction,
    undefined,
    item,
    conversation.agent ? { agent: runAgentFor(conversation, agentDepth(conversation)) } : undefined
  ).catch(() => {
    for (const queued of queuedFollowUps(conversation)) queued.followUp = 'unsent'
    emit()
  })
}
