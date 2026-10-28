import { realpath, readdir, stat, lstat, mkdir } from 'fs/promises'
import { resolve, relative, isAbsolute, dirname, extname, basename } from 'path'
import { getSettings } from '../settings'
import { toolOutcome, type ToolOutcome } from '../workflow/tool-outcome'
import type { CapturedScreen } from './screen'
import {
  lockWorkspaceParents,
  readLockedDocument,
  writeLockedDocument,
  replaceLockedDocument,
  deleteLockedEntries,
  type DeletionEntry,
  type FileIdentity
} from '../security/workspace-handles'
import { currentRun, assertRun } from '../security/run-manager'
import {
  validateWorkspaceRoot,
  SENSITIVE_PART,
  READ_EXTENSIONS,
  WRITE_EXTENSIONS,
  validateCsv
} from '../security/workspace-policy'
import { untrustedData } from '../llm/untrusted-data'
import { decodeImage } from '../services/isolated-parser'
const checkRun = (): void => {
  const run = currentRun()
  if (run) assertRun(run)
}
const SENSITIVE = SENSITIVE_PART
const PROJECT_GUIDANCE = /^(?:AGENTS|SKILL)\.md$/i
export interface WorkspaceDeletion {
  root: string
  target: string
  path: string
  directory: boolean
  recursive: boolean
  entries: DeletionEntry[]
}

export async function prepareWorkspaceDeletion(
  args: { path: string; recursive?: boolean },
  directory: boolean
): Promise<WorkspaceDeletion> {
  if (/[*?]/.test(args.path))
    throw new Error('Deletion requires one exact path; wildcards are blocked.')
  const target = await workspacePath(args.path)
  const root = await realpath(getSettings().files.workspace)
  if (!relative(root, target)) throw new Error('Deleting the working folder itself is blocked.')
  const entries: DeletionEntry[] = []
  const release = lockWorkspaceParents(root, target)
  try {
    const visit = async (path: string, depth: number): Promise<void> => {
      checkRun()
      if (depth > 24 || entries.length >= 250)
        throw new Error(
          'Deletion is limited to 250 entries and 24 nested levels. Choose a smaller folder.'
        )
      const checked = await workspacePath(relative(root, path))
      const entry = await lstat(checked, { bigint: true })
      if (
        (!entry.isFile() && !entry.isDirectory()) ||
        entry.isSymbolicLink() ||
        (entry.isFile() && entry.nlink !== 1n)
      )
        throw new Error('Linked or special deletion targets are blocked.')
      if (!entries.length && entry.isDirectory() !== directory)
        throw new Error(
          directory ? 'Use delete_file for a file.' : 'Use delete_directory for a folder.'
        )
      entries.push({
        path: checked,
        directory: entry.isDirectory(),
        ino: entry.ino.toString(),
        mtimeNs: entry.mtimeNs.toString()
      })
      if (entry.isDirectory()) {
        const children = (await readdir(checked)).sort()
        if (children.length && !args.recursive)
          throw new Error(
            'Folder is not empty. Use recursive: true only when removing all its contents is requested.'
          )
        for (const child of children) await visit(resolve(checked, child), depth + 1)
      }
    }
    await visit(target, 0)
    return { root, target, path: args.path, directory, recursive: args.recursive === true, entries }
  } finally {
    release()
  }
}

export async function revalidateWorkspaceDeletion(snapshot: WorkspaceDeletion): Promise<void> {
  const now = await prepareWorkspaceDeletion(
    { path: snapshot.path, recursive: snapshot.recursive },
    snapshot.directory
  )
  if (JSON.stringify(now) !== JSON.stringify(snapshot))
    throw new Error('The approved deletion contents changed. Request fresh approval.')
}

export async function deleteWorkspaceEntry(
  args: { path: string; recursive?: boolean },
  directory: boolean,
  snapshot?: WorkspaceDeletion
): Promise<ToolOutcome> {
  if (
    !snapshot ||
    snapshot.path !== args.path ||
    snapshot.directory !== directory ||
    snapshot.recursive !== (args.recursive === true)
  )
    throw new Error('Deletion requires an approved snapshot of the exact target.')
  await revalidateWorkspaceDeletion(snapshot)
  checkRun()
  try {
    await deleteLockedEntries(snapshot.root, snapshot.entries, checkRun, () =>
      revalidateWorkspaceDeletion(snapshot)
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'DELETE_PARTIAL')
      return toolOutcome('uncertain', 'Unverified: ' + (error as Error).message)
    throw error
  }

  try {
    await lstat(snapshot.target)
    return toolOutcome(
      'uncertain',
      'Unverified: the approved objects were removed but the path exists again. Inspect it before any further action.'
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      return toolOutcome(
        'uncertain',
        'Unverified: deletion ran but path absence could not be checked. Inspect before continuing.'
      )
  }
  return toolOutcome(
    'verified',
    `Deleted ${directory ? 'folder' : 'file'} ${args.path}. Verified path is absent.`
  )
}
function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
export async function workspacePath(
  input: unknown,
  write = false,
  directory = false,
  readGuidance = false
): Promise<string> {
  const configured = getSettings().files.workspace
  if (!configured) throw new Error('Choose a working folder in Settings → Files first.')
  if (typeof input !== 'string' || input.includes('\0'))
    throw new Error('Use a relative file path inside the working folder.')
  let requested = input
  const root = await validateWorkspaceRoot(configured)
  if (/^[a-z]:[\\/]/i.test(requested)) {
    // Accept model-produced full paths only within the already authorized root.
    // Check ambiguous segments before relative() can normalize them away.
    if (
      requested.slice(2).includes(':') ||
      requested
        .split(/[\\/]/)
        .some(
          (part) => part === '..' || part.endsWith('.') || part.endsWith(' ') || /~\d/.test(part)
        )
    )
      throw new Error('Blocked: unsafe or sensitive workspace path.')
    if (!contained(root, requested))
      throw new Error('Blocked: that path is outside your working folder.')
    requested = relative(root, requested)
  }
  if (requested.includes(':'))
    throw new Error('Use a relative file path inside the working folder.')
  const parts = requested.split(/[\\/]/).filter((part) => part && part !== '.')
  if (
    isAbsolute(requested) ||
    /^[\\/]/.test(requested) ||
    parts.some(
      (part, index) =>
        part === '..' ||
        part.endsWith('.') ||
        part.endsWith(' ') ||
        /~\d/.test(part) ||
        (SENSITIVE.test(part) &&
          !(
            readGuidance &&
            !write &&
            !directory &&
            index === parts.length - 1 &&
            PROJECT_GUIDANCE.test(part)
          )) ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
    )
  )
    throw new Error('Blocked: unsafe or sensitive workspace path.')
  if (write && !directory && !WRITE_EXTENSIONS.has(extname(requested).toLowerCase()))
    throw new Error('Choose a supported text, HTML, data, or source-code filename.')
  let cursor = root
  for (let index = 0; index < parts.length; index++) {
    cursor = resolve(cursor, parts[index])
    try {
      const entry = await lstat(cursor)
      if (entry.isSymbolicLink() || (!entry.isDirectory() && entry.nlink !== 1))
        throw new Error('Blocked: linked workspace entries are not allowed.')
    } catch (error) {
      if (!(
        write &&
        index === parts.length - 1 &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ))
        throw error
    }
  }
  const target = resolve(root, requested || '.')
  if (!contained(root, target))
    throw new Error('Blocked: that path is outside your working folder.')
  const parent = await realpath(write ? dirname(target) : target)
  if (!contained(root, parent))
    throw new Error('Blocked: that link points outside your working folder.')
  if (write) {
    try {
      const actual = await realpath(target)
      if (!contained(root, actual))
        throw new Error('Blocked: that link points outside your working folder.')
      const info = await stat(actual)
      if (directory ? !info.isDirectory() : !info.isFile())
        throw new Error('Unexpected workspace entry type.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  checkRun()
  return target
}
export async function listFiles(args: { path?: string }): Promise<string> {
  const path = await workspacePath(args.path ?? '.')
  const root = await realpath(getSettings().files.workspace)
  checkRun()
  const release = lockWorkspaceParents(root, path, true)
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(path, { withFileTypes: true })
    checkRun()
  } finally {
    release()
  }
  return (
    entries
      .filter(
        (entry) =>
          (!SENSITIVE.test(entry.name) ||
            (!entry.isDirectory() && PROJECT_GUIDANCE.test(entry.name))) &&
          !entry.isSymbolicLink()
      )
      .slice(0, 200)
      .map((entry) => (entry.isDirectory() ? '[folder] ' : '[file] ') + entry.name)
      .join('\n') || 'This folder is empty.'
  )
}
export async function readWorkspaceFile(
  args: { path: string; start_line?: number; line_count?: number; max_chars?: number },
  identity?: FileIdentity
): Promise<string | CapturedScreen> {
  if (!READ_EXTENSIONS.has(extname(args.path).toLowerCase()))
    throw new Error('This file format is not allowed for workspace reads.')
  const path = await workspacePath(args.path, false, false, true)
  const root = await realpath(getSettings().files.workspace)
  checkRun()
  const bytes = readLockedDocument(root, path, identity)
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extname(path).toLowerCase())) {
    if (args.start_line !== undefined || args.line_count !== undefined)
      throw new Error('Line ranges apply only to text files.')
    const extension = extname(path).toLowerCase()
    const mime = ['.jpg', '.jpeg'].includes(extension) ? 'jpeg' : extension.slice(1)
    const image = await decodeImage(`data:image/${mime};base64,${bytes.toString('base64')}`)
    checkRun()
    return {
      text: `Image file: ${basename(path)}`,
      image
    }
  }
  if (bytes.includes(0) || bytes.length > 512 * 1024)
    throw new Error('This tool reads UTF-8 text files up to 512 KB, and images up to 8 MB.')
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const maxChars = args.max_chars ?? 60000
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 60000)
    throw new Error('max_chars must be an integer from 1 to 60000.')
  if (args.start_line !== undefined || args.line_count !== undefined) {
    const start = args.start_line ?? 1,
      count = args.line_count ?? 120
    if (
      !Number.isInteger(start) ||
      start < 1 ||
      start > 100000 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 500
    )
      throw new Error('Use a positive start_line and line_count from 1 to 500.')
    const lines = decoded.split(/\r?\n/)
    const selected = lines.slice(start - 1, start - 1 + count).join('\n')
    return untrustedData(
      'local-file-excerpt',
      args.path,
      `[Excerpt: ${start > lines.length ? 'start is beyond end of file' : `lines ${start}-${Math.min(lines.length, start + count - 1)} of ${lines.length}`}. Use exact text only when patching.]\n` +
        selected.slice(0, Math.min(16000, maxChars)) +
        (selected.length > Math.min(16000, maxChars)
          ? `\n[Excerpt truncated at ${Math.min(16000, maxChars)} characters. Request another bounded excerpt; do not infer omitted text.]`
          : '')
    )
  }
  return untrustedData(
    'local-file',
    args.path,
    decoded.slice(0, maxChars) +
      (decoded.length > maxChars
        ? `\n[Truncated at ${maxChars} characters. Do not replace this entire file; request another bounded excerpt and use edit_file for a focused change.]`
        : '')
  )
}
export async function readWorkspaceCsv(pathName: string, identity?: FileIdentity): Promise<string> {
  if (extname(pathName).toLowerCase() !== '.csv')
    throw new Error('Python file input must be a CSV file.')
  const path = await workspacePath(pathName)
  const root = await realpath(getSettings().files.workspace)
  checkRun()
  const bytes = readLockedDocument(root, path, identity)
  if (bytes.includes(0) || bytes.length > 512000)
    throw new Error('CSV must be UTF-8 text up to 512000 bytes.')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export async function createWorkspaceDirectory(args: { path: string }): Promise<ToolOutcome> {
  const target = await workspacePath(args.path, true, true)
  const root = await realpath(getSettings().files.workspace)
  checkRun()
  const release = lockWorkspaceParents(root, target)
  try {
    await mkdir(target)
    checkRun()
    await workspacePath(args.path)
    return toolOutcome('verified', `Created folder ${args.path}.`)
  } finally {
    release()
  }
}
export async function editWorkspaceFile(
  args: {
    path: string
    old_text?: string
    new_text?: string
    edits?: { old_text: string; new_text: string }[]
  },
  identity?: FileIdentity
): Promise<ToolOutcome> {
  if (!identity) throw new Error('Editing requires an approved file identity.')
  const target = await workspacePath(args.path, true)
  const root = await realpath(getSettings().files.workspace)
  const bytes = readLockedDocument(root, target, identity)
  if (bytes.includes(0) || bytes.length > 512 * 1024)
    throw new Error('Edit requires UTF-8 text up to 512 KB.')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (args.edits && (args.old_text !== undefined || args.new_text !== undefined))
    throw new Error('Use edits OR old_text/new_text, not both.')
  const edits = args.edits ?? [{ old_text: args.old_text, new_text: args.new_text }]
  if (!edits.length || edits.length > 12) throw new Error('Provide between 1 and 12 patch edits.')
  let content = text
  for (const edit of edits) {
    if (typeof edit.old_text !== 'string' || !edit.old_text || typeof edit.new_text !== 'string')
      throw new Error('Each patch needs old_text and new_text.')
    const index = content.indexOf(edit.old_text)
    if (index === -1 || content.indexOf(edit.old_text, index + 1) !== -1)
      throw Object.assign(
        new Error(
          'Expected exactly one match for old_text. No patch was saved. Read the file and choose a unique excerpt.'
        ),
        { code: 'PATCH_NOT_APPLIED' }
      )
    content = content.slice(0, index) + edit.new_text + content.slice(index + edit.old_text.length)
  }
  const result = await writeWorkspaceFile({ path: args.path, content, overwrite: true }, identity)
  return result.status === 'verified'
    ? toolOutcome('verified', `Edited ${args.path}. Verified by reading back identical bytes.`)
    : result
}
export async function writeWorkspaceFile(
  args: {
    path: string
    content: string
    overwrite?: boolean
  },
  identity?: FileIdentity
): Promise<ToolOutcome> {
  if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 512 * 1024)
    throw new Error('Provide UTF-8 text up to 512 KB.')
  const path = await workspacePath(args.path, true)
  if (extname(path).toLowerCase() === '.csv') validateCsv(args.content)
  if (args.overwrite && !identity)
    throw new Error('Replacement requires an approved existing file identity.')
  checkRun()
  const root = await realpath(getSettings().files.workspace)
  checkRun()
  if (args.overwrite)
    replaceLockedDocument(root, path, Buffer.from(args.content, 'utf8'), identity!)
  else writeLockedDocument(root, path, Buffer.from(args.content, 'utf8'))
  checkRun()

  try {
    const observed = readLockedDocument(root, path)
    checkRun()
    if (!observed.equals(Buffer.from(args.content, 'utf8')))
      return toolOutcome(
        'uncertain',
        'Unverified: the document was created, but its bytes did not match the requested content. Inspect it before retrying.'
      )
  } catch {
    checkRun()
    return toolOutcome(
      'uncertain',
      'Unverified: the document was created, but its contents could not be read back. Inspect it before retrying.'
    )
  }
  return toolOutcome(
    'verified',
    `Saved ${args.path} (${Buffer.byteLength(args.content)} bytes). Verified by reading back identical bytes.`
  )
}
