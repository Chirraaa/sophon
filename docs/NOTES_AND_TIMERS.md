# Notes and timers

Sophon keeps simple notes and countdown timers locally. Neither needs an account.
Permissions are under **Settings > Permissions**; each tool defaults to **Ask
first**.

## Notes

Notes are stored on this device in the app data folder (`notes.json`), at most 500.

| Tool           | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `notes_list`   | Recent notes, optionally filtered, 1–50 per call (default 20). |
| `notes_read`   | One note in full, with the revision needed to edit or delete.  |
| `notes_create` | Save a new note.                                               |
| `notes_edit`   | Change a note. Rejected if the note changed since it was read. |
| `notes_delete` | Delete one listed note.                                        |

Edits and deletes use the exact note id from `notes_list` and the revision from
the latest `notes_read`, so a stale or changed note is never overwritten. Note
text is data that the model reads: it cannot grant permission or change policy.

## Timers

| Tool           | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `timer_set`    | Start a countdown (1 second to 24 hours) with an optional name. |
| `timer_cancel` | Stop a running timer by the id `timer_set` returned.            |

Up to five timers run at once. They appear in the app and in the shortcut window,
and alert you when they end.

Both are separate from the long-lived [memory](../MEMORY_HARNESS.md), which holds
facts and preferences rather than reminders or drafts.
