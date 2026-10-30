import { app } from 'electron'
import { join } from 'path'
import { readPrivate, writePrivate } from '../security/private-store'
import { matchScore, terms } from './records'

// A compact, encrypted digest of each conversation so later chats can recall what was asked
// and answered. Built from the transcript as each reply finishes: no background model calls.
export const EPISODE_LIMIT = 200
const EXCHANGE_LIMIT = 20
const USER_CHARS = 400
const REPLY_CHARS = 500

export interface EpisodeExchange {
  id: string
  at: number
  user: string
  reply: string
}
export interface Episode {
  chatId: string
  title: string
  workspace: string
  updatedAt: number
  exchanges: EpisodeExchange[]
}
const file = (): string => join(app.getPath('userData'), 'episodes.json')
let cache: Episode[] | undefined

const clip = (text: string, max: number): string => {
  const value = text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\s+/g, ' ')
    .trim()
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}
const validEpisode = (value: unknown): value is Episode => {
  const episode = value as Episode
  return (
    !!episode &&
    typeof episode.chatId === 'string' &&
    typeof episode.title === 'string' &&
    typeof episode.workspace === 'string' &&
    typeof episode.updatedAt === 'number' &&
    Array.isArray(episode.exchanges) &&
    episode.exchanges.length <= EXCHANGE_LIMIT &&
    episode.exchanges.every(
      (exchange) =>
        typeof exchange?.id === 'string' &&
        typeof exchange.at === 'number' &&
        typeof exchange.user === 'string' &&
        typeof exchange.reply === 'string'
    )
  )
}
export function listEpisodes(): Episode[] {
  if (cache) return cache
  try {
    const data: unknown = JSON.parse(readPrivate(file()).toString('utf8'))
    if (
      !data ||
      typeof data !== 'object' ||
      !('version' in data) ||
      data.version !== 1 ||
      !('episodes' in data) ||
      !Array.isArray(data.episodes) ||
      !data.episodes.every(validEpisode)
    )
      throw new Error('Invalid conversation memory')
    cache = data.episodes
    return cache
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return (cache = [])
    throw new Error('Conversation memory could not be read. Existing data has been preserved.', {
      cause: error
    })
  }
}
function persist(episodes: Episode[]): void {
  writePrivate(file(), Buffer.from(JSON.stringify({ version: 1, episodes })))
  cache = episodes
}
/**
 * Records one finished exchange. Rerunning an earlier prompt replaces it and drops the
 * exchanges after it, matching the conversation.
 */
export function recordEpisode(entry: {
  chatId: string
  title: string
  workspace: string
  promptId: string
  user: string
  reply: string
}): void {
  const user = clip(entry.user, USER_CHARS)
  const reply = clip(entry.reply, REPLY_CHARS)
  if (!user || !reply) return
  const episodes = listEpisodes()
  const old = episodes.find((episode) => episode.chatId === entry.chatId)
  const earlier = old?.exchanges ?? []
  const index = earlier.findIndex((exchange) => exchange.id === entry.promptId)
  const now = Date.now()
  const episode: Episode = {
    chatId: entry.chatId,
    title: clip(entry.title, 80) || 'Untitled chat',
    workspace: entry.workspace,
    updatedAt: now,
    exchanges: [
      ...(index < 0 ? earlier : earlier.slice(0, index)),
      { id: entry.promptId, at: now, user, reply }
    ].slice(-EXCHANGE_LIMIT)
  }
  persist(
    [episode, ...episodes.filter((value) => value.chatId !== entry.chatId)].slice(0, EPISODE_LIMIT)
  )
}
export function renameEpisode(chatId: string, title: string): void {
  const episodes = listEpisodes()
  const episode = episodes.find((value) => value.chatId === chatId)
  if (!episode || episode.title === title) return
  persist(
    episodes.map((value) => (value === episode ? { ...value, title: clip(title, 80) } : value))
  )
}
export function deleteEpisode(chatId: string): void {
  const episodes = listEpisodes()
  if (episodes.some((episode) => episode.chatId === chatId))
    persist(episodes.filter((episode) => episode.chatId !== chatId))
}
export function pruneEpisodes(chatIds: Set<string>): void {
  const episodes = listEpisodes()
  const kept = episodes.filter((episode) => chatIds.has(episode.chatId))
  if (kept.length !== episodes.length) persist(kept)
}
export function clearEpisodes(): void {
  persist([])
}
export interface EpisodeMatch {
  chatId: string
  title: string
  workspace: string
  updatedAt: number
  exchanges: EpisodeExchange[]
}
/** Past conversations that best match the query, each with its most relevant exchanges. */
export function searchEpisodes(query: string, excludeChatId: string, limit = 4): EpisodeMatch[] {
  const queryTerms = terms(query)
  if (!queryTerms.size) return []
  return listEpisodes()
    .filter((episode) => episode.chatId !== excludeChatId)
    .map((episode) => {
      const title = matchScore(queryTerms, episode.title, '')
      const exchanges = episode.exchanges
        .map((exchange) => ({
          exchange,
          score: matchScore(queryTerms, exchange.user, exchange.reply)
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || b.exchange.at - a.exchange.at)
      return {
        episode,
        score: title + (exchanges[0]?.score ?? 0) + 0.5 * (exchanges[1]?.score ?? 0),
        exchanges: (exchanges.length
          ? exchanges.map(({ exchange }) => exchange)
          : episode.exchanges
        )
          .slice(0, 2)
          .sort((a, b) => a.at - b.at)
      }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.episode.updatedAt - a.episode.updatedAt)
    .slice(0, limit)
    .map(({ episode, exchanges }) => ({
      chatId: episode.chatId,
      title: episode.title,
      workspace: episode.workspace,
      updatedAt: episode.updatedAt,
      exchanges
    }))
}
