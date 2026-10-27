import { app } from 'electron'
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
export function clearSecurityEvents(): number {
  const directory = join(app.getPath('userData'), 'security-events')
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw new Error('Could not read security diagnostics. Check folder access and try again.', {
      cause: error
    })
  }
  let deleted = 0
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
    try {
      unlinkSync(join(directory, name))
      deleted++
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new Error(
        'Could not delete all security diagnostics. Check folder access and try again.',
        { cause: error }
      )
    }
  }
  return deleted
}

export function securityEvent(
  event:
    | 'run_started'
    | 'run_stopped'
    | 'tool_allowed'
    | 'tool_denied'
    | 'tool_failed'
    | 'policy_changed',
  taskId?: string,
  tool?: string
): void {
  try {
    const directory = join(app.getPath('userData'), 'security-events')
    mkdirSync(directory, { recursive: true })
    const now = new Date()
    for (const name of readdirSync(directory)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
      const file = join(directory, name)
      if (now.getTime() - statSync(file).mtimeMs > 7 * 86400000) unlinkSync(file)
    }
    const file = join(directory, now.toISOString().slice(0, 10) + '.jsonl')
    try {
      if (statSync(file).size > 1024 * 1024) return
    } catch {
      /* new day */
    }
    appendFileSync(
      file,
      JSON.stringify({
        event,
        time: now.toISOString(),
        taskId,
        tool: tool && /^[a-z_]{1,40}$/.test(tool) ? tool : undefined,
        policyVersion: 1
      }) + '\n'
    )
  } catch {
    /* Diagnostics must not change authorization. */
  }
}
