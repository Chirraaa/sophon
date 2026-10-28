const id = {
  type: 'string',
  pattern: '^note-[0-9a-f]{12}$',
  description: 'Exact note id from notes_list.'
}
const revision = {
  type: 'number',
  description: 'Revision returned by the latest notes_read. A changed note is rejected.'
}

export const notesSchemas = [
  {
    type: 'function',
    function: {
      name: 'notes_list',
      description:
        "List Sophon's own notes, newest first, with a short preview. Optional literal query matches titles and text. These are notes stored in Sophon, not Sticky Notes, OneNote or Outlook.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 120 },
          limit: { type: 'number', description: 'Maximum notes to return, 1–50 (default 20).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'notes_read',
      description: 'Read one note in full, including the revision needed to edit or delete it.',
      parameters: { type: 'object', properties: { id }, required: ['id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'notes_create',
      description:
        'Create a note in Sophon. Title up to 120 characters; text up to 20,000. Returns the saved note after read-back.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 120 },
          body: { type: 'string', maxLength: 20000 }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'notes_edit',
      description:
        'Change a note after reading it. Supply title and/or one of body (replace all text) or append (add to the end). Requires the revision from notes_read; the user sees the before and after.',
      parameters: {
        type: 'object',
        properties: {
          id,
          revision,
          title: { type: 'string', maxLength: 120 },
          body: { type: 'string', maxLength: 20000 },
          append: { type: 'string', maxLength: 20000 }
        },
        required: ['id', 'revision']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'notes_delete',
      description:
        'Permanently delete one note. Always asks for approval. Requires the revision from notes_read so only the note the user saw is removed.',
      parameters: { type: 'object', properties: { id, revision }, required: ['id', 'revision'] }
    }
  }
]
