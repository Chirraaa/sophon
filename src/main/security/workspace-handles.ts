import koffi from 'koffi'
import { dirname, relative, resolve, isAbsolute } from 'path'
import { randomUUID } from 'crypto'

const kernel = koffi.load('kernel32.dll')
const create = kernel.func(
  'intptr __stdcall CreateFileW(str16 path, uint32 access, uint32 share, void *security, uint32 disposition, uint32 flags, intptr template)'
)
const close = kernel.func('bool __stdcall CloseHandle(intptr handle)')
const information = kernel.func(
  'bool __stdcall GetFileInformationByHandle(intptr handle, _Out_ uint32_t *info)'
)
const finalName = kernel.func(
  'uint32 __stdcall GetFinalPathNameByHandleW(intptr handle, _Out_ uint16_t *name, uint32 size, uint32 flags)'
)
const read = kernel.func(
  'bool __stdcall ReadFile(intptr handle, _Out_ void *buffer, uint32 size, _Out_ uint32_t *count, void *overlapped)'
)
const write = kernel.func(
  'bool __stdcall WriteFile(intptr handle, void *buffer, uint32 size, _Out_ uint32_t *count, void *overlapped)'
)
const flush = kernel.func('bool __stdcall FlushFileBuffers(intptr handle)')
const truncate = kernel.func('bool __stdcall SetEndOfFile(intptr handle)')
const setInformation = kernel.func(
  'bool __stdcall SetFileInformationByHandle(intptr handle, int type, void *data, uint32 size)'
)
const OPEN_REPARSE_POINT = 0x00200000
const BACKUP_SEMANTICS = 0x02000000
const normalize = (value: string): string => resolve(value.replace(/^\\\\\?\\/, '')).toLowerCase()
export interface FileIdentity {
  ino: string
  mtimeNs: string
}
export interface DeletionEntry extends FileIdentity {
  path: string
  directory: boolean
}

// Lock and validate the complete approved set before deleting anything. Parents
// cannot be swapped and files cannot be edited while held. A recursive delete is
// not atomic: cancellation or a new child may leave partial work, reported below.
export async function deleteLockedEntries(
  root: string,
  entries: DeletionEntry[],
  assertCurrent: () => void,
  revalidate: () => Promise<void>
): Promise<void> {
  if (!entries.length || entries.length > 250) throw new Error('Invalid deletion snapshot.')
  const release = lockWorkspaceParents(root, entries[0].path)
  const held: { handle: number; entry: DeletionEntry }[] = []
  let removed = 0
  try {
    for (const entry of entries) {
      assertCurrent()
      const rel = relative(root, entry.path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Blocked deletion path.')
      const handle = openHandle(
        entry.path,
        0x80010000,
        entry.directory ? 3 : 1,
        3,
        OPEN_REPARSE_POINT | (entry.directory ? BACKUP_SEMANTICS : 0)
      )
      held.push({ handle, entry })
      const fields = info(handle, entry.path)
      const mtimeNs =
        (((BigInt(fields[6]) << 32n) | BigInt(fields[5])) - 116444736000000000n) * 100n
      if (
        Boolean(fields[0] & 0x10) !== entry.directory ||
        fileId(fields) !== entry.ino ||
        mtimeNs.toString() !== entry.mtimeNs ||
        (!entry.directory && fields[10] !== 1)
      )
        throw new Error('The approved deletion target changed. Request fresh approval.')
    }
    await revalidate()
    assertCurrent()
    for (let index = held.length - 1; index >= 0; index--) {
      assertCurrent()
      const { handle, entry } = held[index]
      const current = info(handle, entry.path)
      if (!entry.directory && current[10] !== 1)
        throw new Error('File links changed before deletion.')
      const disposition = Buffer.from([1, 0, 0, 0])
      if (!setInformation(handle, 4, disposition, disposition.length))
        throw new Error(
          'Windows could not delete the approved object; it may be in use, read-only or no longer empty.'
        )
      removed++
      close(handle)
      held.pop()
    }
  } catch (error) {
    if (removed)
      throw Object.assign(
        new Error(
          `Deletion stopped after ${removed} of ${entries.length} entries. Some contents were removed; inspect before continuing. ${(error as Error).message}`
        ),
        { code: 'DELETE_PARTIAL' }
      )
    throw error
  } finally {
    for (const { handle } of held.reverse()) close(handle)
    release()
  }
}
const fileId = (fields: Uint32Array): string =>
  ((BigInt(fields[11]) << 32n) | BigInt(fields[12])).toString()
function info(handle: number, expected: string): Uint32Array {
  const fields = new Uint32Array(13)
  const buffer = new Uint16Array(32768)
  const length = finalName(handle, buffer, buffer.length, 0)
  if (
    !information(handle, fields) ||
    !length ||
    length >= buffer.length ||
    normalize(Buffer.from(buffer.buffer, 0, length * 2).toString('utf16le')) !==
      normalize(expected) ||
    fields[0] & 0x400
  )
    throw new Error('Blocked: the workspace object is linked or changed.')
  return fields
}
function openHandle(
  path: string,
  access: number,
  share: number,
  disposition: number,
  flags: number
): number {
  const handle = Number(create(path, access, share, null, disposition, flags, 0))
  if (handle === -1 || handle === 0)
    throw new Error(
      'Blocked: the workspace object could not be locked safely. Close other editors and retry.'
    )
  return handle
}
// Retain every ancestor without FILE_SHARE_DELETE, preventing junction/rename swaps
// from root through the final parent for the entire operation. No weaker fallback.
export function lockWorkspaceParents(root: string, target: string, directory = false): () => void {
  const end = directory ? target : dirname(target)
  const rel = relative(root, end)
  if (root.startsWith('\\\\') || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Blocked workspace path.')
  const handles: number[] = []
  const release = (): void => {
    for (const handle of handles.reverse()) close(handle)
  }
  try {
    let cursor = root
    for (const part of ['', ...rel.split(/[\\/]/).filter(Boolean)]) {
      cursor = resolve(cursor, part)
      const handle = openHandle(cursor, 0x80000000, 3, 3, OPEN_REPARSE_POINT | BACKUP_SEMANTICS)
      handles.push(handle)
      if (!(info(handle, cursor)[0] & 0x10)) throw new Error('Expected a workspace directory.')
    }
    return release
  } catch (error) {
    release()
    throw error
  }
}
export function readLockedDocument(root: string, target: string, expected?: FileIdentity): Buffer {
  const release = lockWorkspaceParents(root, target)
  let handle: number | undefined
  try {
    handle = openHandle(target, 0x80000000, 1, 3, OPEN_REPARSE_POINT)
    const fields = info(handle, target)
    const mtimeNs = (((BigInt(fields[6]) << 32n) | BigInt(fields[5])) - 116444736000000000n) * 100n
    if (expected && (fileId(fields) !== expected.ino || mtimeNs.toString() !== expected.mtimeNs))
      throw new Error('The approved file identity or contents changed.')
    if (fields[0] & 0x10 || fields[8] !== 0 || fields[9] > 8 * 1024 * 1024 || fields[10] !== 1)
      throw new Error('Choose an unlinked file smaller than 8 MB.')
    const bytes = Buffer.alloc(fields[9])
    const count = new Uint32Array(1)
    if (
      bytes.length &&
      (!read(handle, bytes, bytes.length, count, null) || count[0] !== bytes.length)
    )
      throw new Error('Could not read the complete workspace file.')
    if (info(handle, target)[10] !== 1) throw new Error('File links changed during read.')
    return bytes
  } finally {
    if (handle !== undefined) close(handle)
    release()
  }
}
export function lockReadOnlyFile(path: string): () => void {
  const handle = openHandle(path, 0x80000000, 1, 3, OPEN_REPARSE_POINT)
  try {
    if (info(handle, path)[10] !== 1) throw new Error('Linked native files are blocked.')
    return () => {
      close(handle)
    }
  } catch (error) {
    close(handle)
    throw error
  }
}
export function replaceLockedDocument(
  root: string,
  target: string,
  bytes: Buffer,
  expected: FileIdentity
): void {
  const release = lockWorkspaceParents(root, target)
  let handle: number | undefined
  try {
    handle = openHandle(target, 0xc0000000, 0, 3, OPEN_REPARSE_POINT)
    const fields = info(handle, target)
    const mtimeNs = (((BigInt(fields[6]) << 32n) | BigInt(fields[5])) - 116444736000000000n) * 100n
    if (
      fields[0] & 0x10 ||
      fields[10] !== 1 ||
      fileId(fields) !== expected.ino ||
      mtimeNs.toString() !== expected.mtimeNs
    )
      throw new Error('The approved file identity or contents changed.')
    const count = new Uint32Array(1)
    if (
      (bytes.length &&
        (!write(handle, bytes, bytes.length, count, null) || count[0] !== bytes.length)) ||
      !truncate(handle) ||
      !flush(handle)
    )
      throw new Error('Replacement did not complete; inspect the file before retrying.')
  } finally {
    if (handle !== undefined) close(handle)
    release()
  }
}
export function writeLockedDocument(root: string, target: string, bytes: Buffer): void {
  const release = lockWorkspaceParents(root, target)
  let handle: number | undefined
  try {
    const temporary = resolve(dirname(target), `.sophon-${randomUUID()}.tmp`)
    handle = openHandle(temporary, 0xc0010000, 0, 1, OPEN_REPARSE_POINT)
    if (info(handle, temporary)[10] !== 1) throw new Error('Linked writes are blocked.')
    const count = new Uint32Array(1)
    if (
      bytes.length &&
      (!write(handle, bytes, bytes.length, count, null) || count[0] !== bytes.length)
    )
      throw new Error('Could not write the complete workspace document.')
    if (!flush(handle)) throw new Error('Could not flush the complete workspace document.')
    const name = Buffer.from(target, 'utf16le')
    const rename = Buffer.alloc(20 + name.length + 2)
    rename.writeUInt32LE(name.length, 16)
    name.copy(rename, 20)
    if (!setInformation(handle, 3, rename, rename.length))
      throw new Error('Could not publish the new document; destination may already exist.')
    info(handle, target)
  } catch (error) {
    if (handle !== undefined) {
      const disposition = Buffer.from([1, 0, 0, 0])
      setInformation(handle, 4, disposition, disposition.length)
    }
    throw error
  } finally {
    if (handle !== undefined) close(handle)
    release()
  }
}
