import { app } from 'electron'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { readPrivate, writePrivate } from '../security/private-store'

export const NOTE_LIMIT = 500
export const NOTE_TITLE_MAX = 120
export const NOTE_BODY_MAX = 20000
const LIST_MAX = 50
const PREVIEW_MAX = 160

export interface Note {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
  revision: number
}
export type NoteSummary = Pick<Note, 'id' | 'title' | 'updatedAt' | 'revision'> & {
  preview: string
}
export class NoteError extends Error {
  constructor(
    message: string,
    readonly code: 'missing' | 'stale' | 'invalid' | 'limit'
  ) {
    super(message)
  }
}

const file = (): string => join(app.getPath('userData'), 'notes.json')
const ID = /^note-[\da-f]{12}$/
const valid = (value: unknown): value is Note => {
  const note = value as Note
  return Boolean(
    note &&
    typeof note === 'object' &&
    ID.test(note.id) &&
    typeof note.title === 'string' &&
    note.title.length <= NOTE_TITLE_MAX &&
    typeof note.body === 'string' &&
    note.body.length <= NOTE_BODY_MAX &&
    Number.isFinite(note.createdAt) &&
    Number.isFinite(note.updatedAt) &&
    Number.isInteger(note.revision) &&
    note.revision > 0
  )
}
export function loadNotes(): Note[] {
  try {
    const data: unknown = JSON.parse(readPrivate(file()).toString('utf8'))
    const notes = (data as { version?: number; notes?: unknown })?.notes
    if (
      (data as { version?: number })?.version !== 1 ||
      !Array.isArray(notes) ||
      notes.length > NOTE_LIMIT ||
      !notes.every(valid) ||
      new Set(notes.map((note) => note.id)).size !== notes.length
    )
      throw new Error('Invalid notes store')
    return notes
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('Saved notes could not be read. Existing data has been preserved.', {
      cause: error
    })
  }
}
const persist = (notes: Note[]): void =>
  writePrivate(file(), Buffer.from(JSON.stringify({ version: 1, notes })))

const clean = (value: string): string => value.replace(/\r\n?/g, '\n')
function checked(title: string | undefined, body: string | undefined): void {
  if (title !== undefined && (!title.trim() || title.length > NOTE_TITLE_MAX))
    throw new NoteError(`Title must be 1–${NOTE_TITLE_MAX} characters.`, 'invalid')
  if (body !== undefined && body.length > NOTE_BODY_MAX)
    throw new NoteError(`Note text is limited to ${NOTE_BODY_MAX} characters.`, 'invalid')
}
function find(notes: Note[], id: string): Note {
  const note = notes.find((entry) => entry.id === id)
  if (!note) throw new NoteError('That note no longer exists. List notes again.', 'missing')
  return note
}
function fresh(note: Note, revision: number): void {
  if (note.revision !== revision)
    throw new NoteError(
      `The note changed since it was read (revision ${note.revision}). Read it again before changing it.`,
      'stale'
    )
}

export function listNotes(query?: string, limit = 20): NoteSummary[] {
  const needle = query?.trim().toLowerCase()
  return loadNotes()
    .filter(
      (note) =>
        !needle ||
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.min(Math.max(1, limit), LIST_MAX))
    .map(({ id, title, updatedAt, revision, body }) => ({
      id,
      title,
      updatedAt,
      revision,
      preview: body.replace(/\s+/g, ' ').slice(0, PREVIEW_MAX)
    }))
}
export const readNote = (id: string): Note => find(loadNotes(), id)
export function createNote(title: string, body = ''): Note {
  checked(title, body)
  const notes = loadNotes()
  if (notes.length >= NOTE_LIMIT)
    throw new NoteError(`Notes are limited to ${NOTE_LIMIT}. Delete one first.`, 'limit')
  const now = Date.now()
  const note: Note = {
    id: `note-${randomBytes(6).toString('hex')}`,
    title: title.trim(),
    body: clean(body),
    createdAt: now,
    updatedAt: now,
    revision: 1
  }
  persist([...notes, note])
  return note
}
export function editNote(
  id: string,
  revision: number,
  change: { title?: string; body?: string; append?: string }
): Note {
  if (change.body !== undefined && change.append !== undefined)
    throw new NoteError('Use body OR append, not both.', 'invalid')
  if (change.title === undefined && change.body === undefined && change.append === undefined)
    throw new NoteError('Supply title, body or append.', 'invalid')
  const notes = loadNotes()
  const note = find(notes, id)
  fresh(note, revision)
  const body =
    change.append !== undefined
      ? note.body + (note.body && !note.body.endsWith('\n') ? '\n' : '') + clean(change.append)
      : change.body !== undefined
        ? clean(change.body)
        : note.body
  checked(change.title, body)
  const next: Note = {
    ...note,
    title: change.title?.trim() ?? note.title,
    body,
    updatedAt: Date.now(),
    revision: note.revision + 1
  }
  persist(notes.map((entry) => (entry.id === id ? next : entry)))
  return next
}
export function deleteNote(id: string, revision: number): void {
  const notes = loadNotes()
  fresh(find(notes, id), revision)
  persist(notes.filter((entry) => entry.id !== id))
}
