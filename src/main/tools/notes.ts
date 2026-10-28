import { toolOutcome, type ToolOutcome } from '../workflow/tool-outcome'
import {
  NoteError,
  createNote,
  deleteNote,
  editNote,
  listNotes,
  loadNotes,
  readNote
} from '../services/notes'

export const NOTE_TOOLS = ['notes_list', 'notes_read', 'notes_create', 'notes_edit', 'notes_delete']

/** Describes the exact change for the approval card, and rejects stale targets before asking. */
export function bindNotesAction(
  name: string,
  args: Record<string, unknown>
): { preview: Record<string, unknown>; revalidate: () => void } {
  if (name === 'notes_create')
    return {
      preview: { operation: 'create', title: args.title, body: args.body ?? '' },
      revalidate: () => undefined
    }
  if (name !== 'notes_edit' && name !== 'notes_delete')
    return { preview: {}, revalidate: () => undefined }
  const id = String(args.id)
  const revision = Number(args.revision)
  const check = (): ReturnType<typeof readNote> => {
    const note = readNote(id)
    if (note.revision !== revision)
      throw new NoteError(
        `The note changed since it was read (revision ${note.revision}). Read it again before changing it.`,
        'stale'
      )
    return note
  }
  const note = check()
  const preview =
    name === 'notes_delete'
      ? { operation: 'delete', id, title: note.title, body: note.body }
      : {
          operation: 'edit',
          id,
          before: { title: note.title, body: note.body },
          after: {
            title: typeof args.title === 'string' ? args.title.trim() : note.title,
            body:
              typeof args.append === 'string'
                ? `${note.body}${note.body && !note.body.endsWith('\n') ? '\n' : ''}${args.append}`
                : typeof args.body === 'string'
                  ? args.body
                  : note.body
          }
        }
  return { preview, revalidate: () => void check() }
}

export function executeNotesTool(
  name: string,
  args: Record<string, unknown>
): string | ToolOutcome {
  try {
    if (name === 'notes_list') {
      const notes = listNotes(args.query as string | undefined, args.limit as number | undefined)
      return JSON.stringify({ kind: 'notes', total: loadNotes().length, notes })
    }
    if (name === 'notes_read')
      return JSON.stringify({ kind: 'note', note: readNote(String(args.id)) })
    if (name === 'notes_create') {
      const created = createNote(String(args.title), (args.body as string | undefined) ?? '')
      const note = readNote(created.id)
      return JSON.stringify({
        kind: 'note-change',
        operation: 'create',
        verified: note.revision === 1 && note.title === created.title && note.body === created.body,
        note
      })
    }
    if (name === 'notes_edit') {
      const edited = editNote(String(args.id), Number(args.revision), {
        title: args.title as string | undefined,
        body: args.body as string | undefined,
        append: args.append as string | undefined
      })
      const note = readNote(edited.id)
      return JSON.stringify({
        kind: 'note-change',
        operation: 'edit',
        verified: note.revision === edited.revision && note.body === edited.body,
        note
      })
    }
    const id = String(args.id)
    deleteNote(id, Number(args.revision))
    const gone = !loadNotes().some((note) => note.id === id)
    return JSON.stringify({ kind: 'note-change', operation: 'delete', verified: gone, id })
  } catch (error) {
    if (error instanceof NoteError)
      return toolOutcome('failed', `Note not changed: ${error.message}`, {
        execution: 'not-started',
        code: error.code === 'missing' ? 'target-missing' : 'execution-error'
      })
    return toolOutcome('uncertain', `Tool error: ${(error as Error).message}`, {
      execution: 'unknown'
    })
  }
}
