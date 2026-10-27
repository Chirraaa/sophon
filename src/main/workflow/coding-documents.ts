import { app } from 'electron'
import { join } from 'path'
import { existsSync, lstatSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'

export function saveCodingDocuments(id: string, documents: Record<string, string>): string {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid coding session ID.')
  let directory = app.getPath('userData')
  for (const part of ['coding-runs', id]) {
    directory = join(directory, part)
    if (!existsSync(directory)) mkdirSync(directory)
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe coding checkpoint directory.')
  }
  for (const [name, content] of Object.entries(documents)) {
    if (
      !['PLAN.md', 'TASKS.md', 'DOCS.md', 'STATE.md', 'DECISIONS.md', 'TRACE.md'].includes(name) ||
      Buffer.byteLength(content) > 64000
    )
      throw new Error('Invalid coding checkpoint document.')
    const target = join(directory, name)
    if (existsSync(target)) {
      const stat = lstatSync(target)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new Error('Unsafe coding checkpoint file.')
    }
    const temp = join(directory, randomUUID() + '.tmp')
    try {
      writeFileSync(temp, content, { flag: 'wx' })
      renameSync(temp, target)
    } finally {
      if (existsSync(temp)) unlinkSync(temp)
    }
  }
  return directory
}
