import { app } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { existsSync, readdirSync, unlinkSync } from 'fs'
import { archiveAction, actionDetailsFilename } from './action-details'
import type { ChatHistory } from '../llm/types'
import { purgeAttachments } from '../services/attachments'
import { readPrivate, writePrivate } from '../security/private-store'
import { validWorkflow, interruptedWorkflow } from '../workflow/controller'
export type Conversation = ChatInfo & {
  mode: TaskMode
  items: ChatItem[]
  history: ChatHistory
  workflow?: WorkflowState
}
export type ConversationStore = {
  activeId: string
  chats: Conversation[]
  categories?: ChatCategory[]
}
export function newConversation(): Conversation {
  return {
    id: randomUUID(),
    mode: 'assistant',
    title: 'New chat',
    updatedAt: Date.now(),
    items: [],
    history: []
  }
}
function restoreWorkflow(holder: { workflow?: WorkflowState }): void {
  const value = holder.workflow
  if (value && typeof value === 'object' && !Array.isArray(value)) value.mode = 'assistant'
  if (!validWorkflow(value)) delete holder.workflow
  else if (value.outcome === 'running') holder.workflow = interruptedWorkflow(value)
}
function loadLegacyConversations(): ConversationStore {
  try {
    const saved = JSON.parse(
      readPrivate(join(app.getPath('userData'), 'chats.json')).toString('utf8')
    ) as ConversationStore
    if (!Array.isArray(saved.chats)) throw new Error('Invalid chat store')
    saved.chats = saved.chats.filter(
      (chat) =>
        typeof chat.id === 'string' &&
        typeof chat.title === 'string' &&
        Array.isArray(chat.items) &&
        Array.isArray(chat.history)
    )
    for (const chat of saved.chats) {
      chat.mode = 'assistant'
      restoreWorkflow(chat)
      for (const item of chat.items) {
        restoreWorkflow(item)
        if (item.pending) {
          for (const specialist of item.specialists ?? [])
            if (specialist.status === 'running') {
              specialist.status = 'failed'
              specialist.summary = 'Interrupted when Sophon closed.'
            }
          item.pending = false
          item.text ||= 'This request was interrupted when Sophon closed.'
          item.actions = item.actions.map((action) =>
            action.status === 'running' || action.status === 'waiting'
              ? { ...action, status: 'failed', detail: 'Interrupted when Sophon closed.' }
              : action
          )
        }
      }
    }
    if (!saved.chats.length) throw new Error('Empty store')
    if (!saved.chats.some((chat) => chat.id === saved.activeId)) saved.activeId = saved.chats[0].id
    return saved
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Conversation storage could not be read. Existing data has been preserved.', {
        cause: error
      })
    const chat = newConversation()
    return { activeId: chat.id, chats: [chat] }
  }
}
type Page = { id: string; count: number; attachments: string[]; details: string[] }
type Body = Pick<Conversation, 'items' | 'history' | 'workflow'> & { pages?: Page[] }
type Entry = ChatInfo & {
  attachments: string[]
  details: string[]
  pages?: Page[]
  bodyId?: string
}
const bodies = new Map<Conversation, Body>()
const entries = new Map<Conversation, Entry>()
const root = (): string => join(app.getPath('userData'), 'conversations')
function bodyPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid conversation ID.')
  return join(root(), `${id}.json`)
}
function pagePath(id: string): string {
  bodyPath(id)
  return join(root(), 'pages', `${id}.json`)
}
export function conversationTotal(chat: Conversation): number {
  const count = chat.items.length
  return count + (bodies.get(chat)?.pages ?? []).reduce((sum, page) => sum + page.count, 0)
}
export function conversationPage(
  chat: Conversation,
  before: number
): { items: ChatItem[]; start: number; total: number } {
  const total = conversationTotal(chat)
  const end = Math.min(total, before)
  const start = Math.max(0, end - 60)
  const items: ChatItem[] = []
  let offset = 0
  for (const page of bodies.get(chat)?.pages ?? []) {
    if (offset < end && offset + page.count > start) {
      const saved = JSON.parse(readPrivate(pagePath(page.id)).toString('utf8')) as ChatItem[]
      for (const item of saved) restoreWorkflow(item)
      items.push(...saved.slice(Math.max(0, start - offset), end - offset))
    }
    offset += page.count
  }
  if (end > offset) items.push(...chat.items.slice(Math.max(0, start - offset), end - offset))
  return { items, start, total }
}

export function expandConversation(chat: Conversation): void {
  void chat.items
  const body = bodies.get(chat)
  if (!body?.pages?.length) return
  const previous = body.pages.flatMap(
    (page) => JSON.parse(readPrivate(pagePath(page.id)).toString('utf8')) as ChatItem[]
  )
  body.items = [...previous, ...body.items]
  body.pages = []
}
export function clearConversation(chat: Conversation): void {
  chat.items = []
  chat.history = []
  chat.workflow = undefined
  const body = bodies.get(chat)
  if (body) body.pages = []
}
function remember(chat: Conversation): void {
  if (entries.has(chat)) return
  bodies.set(chat, { items: chat.items, history: chat.history, workflow: chat.workflow })
  entries.set(chat, {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    attachments: [],
    details: []
  })
  attach(chat)
}
function attach(chat: Conversation): void {
  const get = (): Body => {
    let body = bodies.get(chat)
    if (!body) {
      body = JSON.parse(
        readPrivate(bodyPath(entries.get(chat)?.bodyId ?? chat.id)).toString('utf8')
      ) as Body
      if (!Array.isArray(body.items) || !Array.isArray(body.history))
        throw new Error('Invalid conversation body.')
      restoreWorkflow(body)
      for (const item of body.items) {
        restoreWorkflow(item)
        if (item.pending) {
          item.pending = false
          item.text ||= 'This request was interrupted when Sophon closed.'
          for (const action of item.actions)
            if (['running', 'waiting'].includes(action.status)) {
              action.status = 'failed'
              action.detail = 'Task stopped or interrupted.'
            }
          for (const specialist of item.specialists ?? [])
            if (specialist.status === 'running') {
              specialist.status = 'failed'
              specialist.summary = 'Request stopped or interrupted.'
            }
        }
      }
      bodies.set(chat, body)
    }
    return body
  }
  for (const key of ['items', 'history', 'workflow'] as const)
    Object.defineProperty(chat, key, {
      configurable: true,
      enumerable: true,
      get: () => get()[key],
      set: (value) => {
        get()[key] = value
      }
    })
}
export function loadConversations(): ConversationStore {
  bodies.clear()
  entries.clear()
  const index = join(root(), 'index.json')
  if (!existsSync(index)) {
    if (
      !existsSync(join(app.getPath('userData'), 'chats.json')) &&
      existsSync(root()) &&
      readdirSync(root()).some((name) => /^[0-9a-f-]{36}\.json$/.test(name))
    )
      throw new Error(
        'Conversation index is missing. Existing conversation files have been preserved.'
      )
    const store = loadLegacyConversations()
    persistConversations(store)

    const legacy = join(app.getPath('userData'), 'chats.json')
    if (existsSync(legacy)) unlinkSync(legacy)
    releaseConversations(store, [store.activeId])
    return store
  }
  const saved = JSON.parse(readPrivate(index).toString('utf8')) as {
    activeId: string
    chats: Entry[]
    categories?: ChatCategory[]
  }
  if (!Array.isArray(saved.chats)) throw new Error('Invalid conversation index.')
  if (saved.categories !== undefined && !Array.isArray(saved.categories))
    throw new Error('Invalid conversation categories.')
  const categories = (saved.categories ?? []).filter(
    (category) =>
      category &&
      typeof category.id === 'string' &&
      /^[0-9a-f-]{36}$/.test(category.id) &&
      typeof category.name === 'string' &&
      category.name.trim().length > 0 &&
      category.name.length <= 60
  )
  const chats = saved.chats.map((entry) => {
    bodyPath(entry.id)
    if (
      typeof entry.title !== 'string' ||
      !Array.isArray(entry.attachments) ||
      !Array.isArray(entry.details)
    )
      throw new Error('Invalid conversation index entry.')
    const chat = {
      id: entry.id,
      title: entry.title,
      githubContext: entry.githubContext,
      updatedAt: entry.updatedAt,
      categoryId: categories.some((category) => category.id === entry.categoryId)
        ? entry.categoryId
        : undefined,
      mode: 'assistant'
    } as Conversation
    entries.set(chat, entry)
    attach(chat)
    return chat
  })
  if (!chats.length) chats.push(newConversation())
  const legacy = join(app.getPath('userData'), 'chats.json')
  if (existsSync(legacy)) unlinkSync(legacy)
  return {
    chats,
    categories,
    activeId: chats.some((chat) => chat.id === saved.activeId) ? saved.activeId : chats[0].id
  }
}
export function persistConversations(store: ConversationStore): void {
  const retired: string[] = []
  for (const chat of store.chats) {
    remember(chat)
    const entry = entries.get(chat)!
    entry.title = chat.title
    entry.updatedAt = chat.updatedAt
    entry.categoryId = chat.categoryId
    entry.githubContext = chat.githubContext
    const body = bodies.get(chat)
    if (!body) continue

    if (!Object.hasOwn(chat, 'workflow')) {
      delete body.workflow
      attach(chat)
    }
    for (const item of body.items) for (const action of item.actions) archiveAction(action)
    body.pages ??= []
    while (body.items.length > 120) {
      const archived = body.items.slice(0, 60)
      if (archived.some((item) => item.pending)) break
      const page: Page = {
        id: randomUUID(),
        count: archived.length,
        attachments: archived.flatMap((item) => (item.attachments ?? []).map((a) => a.id)),
        details: archived.flatMap((item) =>
          item.actions.filter((a) => a.detailsStored).map((a) => a.id)
        )
      }
      writePrivate(pagePath(page.id), Buffer.from(JSON.stringify(archived)))
      body.pages.push(page)
      body.items = body.items.slice(60)
    }
    entry.pages = body.pages
    entry.attachments = [
      ...body.pages.flatMap((page) => page.attachments),
      ...body.items.flatMap((item) => (item.attachments ?? []).map((a) => a.id))
    ]
    entry.details = [
      ...body.pages.flatMap((page) => page.details),
      ...body.items.flatMap((item) => item.actions.filter((a) => a.detailsStored).map((a) => a.id))
    ]

    const bodyId = randomUUID()
    writePrivate(bodyPath(bodyId), Buffer.from(JSON.stringify(body)))
    retired.push(entry.bodyId ?? chat.id)
    entry.bodyId = bodyId
  }
  writePrivate(
    join(root(), 'index.json'),
    Buffer.from(
      JSON.stringify({
        activeId: store.activeId,
        categories: store.categories ?? [],
        chats: store.chats.map((chat) => entries.get(chat))
      })
    )
  )
  for (const id of retired) if (existsSync(bodyPath(id))) unlinkSync(bodyPath(id))
}
export function releaseConversations(store: ConversationStore, pinned: string[]): void {
  for (const chat of bodies.keys()) if (!pinned.includes(chat.id)) bodies.delete(chat)
  for (const chat of entries.keys()) if (!store.chats.includes(chat)) entries.delete(chat)
}
export function attachmentIds(store: ConversationStore): Set<string> {
  return new Set(
    store.chats.flatMap((chat) =>
      bodies.has(chat) || !entries.has(chat)
        ? [
            ...(bodies.get(chat)?.pages ?? []).flatMap((page) => page.attachments),
            ...chat.items.flatMap((item) => (item.attachments ?? []).map((a) => a.id))
          ]
        : entries.get(chat)!.attachments
    )
  )
}
export function cleanAttachments(store: ConversationStore, removed: Set<string> = new Set()): void {
  purgeAttachments(attachmentIds(store), removed)
  const chats = new Set(store.chats.map((chat) => `${entries.get(chat)?.bodyId ?? chat.id}.json`))
  const details = new Set(
    store.chats.flatMap((chat) => entries.get(chat)?.details ?? []).map(actionDetailsFilename)
  )
  const pages = new Set(
    store.chats.flatMap((chat) => entries.get(chat)?.pages ?? []).map((page) => `${page.id}.json`)
  )
  for (const [directory, retained] of [
    [root(), chats],
    [join(root(), 'pages'), pages],
    [join(app.getPath('userData'), 'action-details'), details]
  ] as const) {
    if (existsSync(directory))
      for (const file of readdirSync(directory))
        if (/^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.json$/.test(file) && !retained.has(file))
          unlinkSync(join(directory, file))
  }
}
