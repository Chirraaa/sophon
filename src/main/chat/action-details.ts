import { app } from 'electron'
import { createHash } from 'crypto'
import { basename, join } from 'path'
import { readPrivate, writePrivate } from '../security/private-store'

const LIMIT = 2000
function path(id: string): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,1024}$/.test(id))
    throw new Error('Invalid action ID.')

  const key = /^[0-9a-f-]{36}$/.test(id) ? id : createHash('sha256').update(id).digest('hex')
  return join(app.getPath('userData'), 'action-details', `${key}.json`)
}
export function actionDetailsFilename(id: string): string {
  return basename(path(id))
}

function summary(value: string): string {
  if (value.length <= LIMIT) return value
  try {
    const compact = (v: unknown, depth = 0): unknown => {
      if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '… [Stored on disk]' : v
      if (!v || typeof v !== 'object') return v
      if (depth > 4) return '[Stored on disk]'
      if (Array.isArray(v)) return v.slice(0, 12).map((item) => compact(item, depth + 1))
      return Object.fromEntries(
        Object.entries(v)
          .slice(0, 24)
          .map(([k, item]) => [k, compact(item, depth + 1)])
      )
    }
    const result = JSON.stringify(compact(JSON.parse(value)))
    if (result.length <= 8000) return result
  } catch {
    /* Plain-text results are also supported. */
  }
  return value.slice(0, LIMIT) + '\n[Full details stored on disk.]'
}
export function archiveAction(action: ToolAction): void {
  if (action.detailsStored || !['done', 'failed'].includes(action.status)) return
  if ((action.preview?.length ?? 0) + (action.detail?.length ?? 0) <= LIMIT) return
  writePrivate(
    path(action.id),
    Buffer.from(JSON.stringify({ preview: action.preview, detail: action.detail }))
  )
  action.preview = action.preview === undefined ? undefined : summary(action.preview)
  action.detail = action.detail === undefined ? undefined : summary(action.detail)
  action.detailsStored = true
}
export function readActionDetails(id: string): { preview?: string; detail?: string } {
  return JSON.parse(readPrivate(path(id)).toString('utf8'))
}
