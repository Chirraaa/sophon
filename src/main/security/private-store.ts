import { app, safeStorage } from 'electron'
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'crypto'
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
  unlinkSync
} from 'fs'
import { join, dirname, basename, extname } from 'path'
const MAGIC = Buffer.from('SOPHON2\0')
let cached: Buffer | undefined
function key(create = true): Buffer {
  if (cached) return cached
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS encryption is unavailable; private data storage is disabled.')
  const path = join(app.getPath('userData'), 'private-store.key.enc')
  if (!existsSync(path)) {
    if (!create)
      throw new Error(
        'Private-data encryption key is missing. Restore the original key; the data has not been overwritten.'
      )
    // Never replace a lost key with one that cannot recover existing ciphertext.
    const profile = app.getPath('userData')
    const encrypted = (file: string): boolean => {
      const handle = openSync(file, 'r')
      try {
        const header = Buffer.alloc(MAGIC.length)
        return (
          readSync(handle, header, 0, header.length, 0) === header.length && header.equals(MAGIC)
        )
      } finally {
        closeSync(handle)
      }
    }
    const attachmentDirectory = join(profile, 'attachments')
    const files = [
      join(profile, 'chats.json'),
      join(profile, 'conversations', 'index.json'),
      ...['conversations', 'conversations/pages', 'action-details'].flatMap((directory) => {
        const location = join(profile, directory)
        return existsSync(location)
          ? readdirSync(location)
              .filter((name) => /^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.json$/.test(name))
              .map((name) => join(location, name))
          : []
      }),
      join(profile, 'memories.json'),
      join(profile, 'notes.json'),
      ...(existsSync(attachmentDirectory)
        ? readdirSync(attachmentDirectory)
            .filter((name) => /\.(bin|json)$/.test(name))
            .map((name) => join(attachmentDirectory, name))
        : [])
    ]
    if (files.some((file) => existsSync(file) && encrypted(file)))
      throw new Error(
        'Private-data encryption key is missing. Restore the original key; existing data has not been changed.'
      )
    mkdirSync(dirname(path), { recursive: true })
    const value = randomBytes(32).toString('base64')
    writeFileSync(path, safeStorage.encryptString(value), { flag: 'wx', mode: 0o600 })
  }
  const value = Buffer.from(safeStorage.decryptString(readFileSync(path)), 'base64')
  if (value.length !== 32) throw new Error('Invalid private-data key.')
  cached = value
  return value
}
export function initializePrivateStorage(): void {
  key()
  const profile = app.getPath('userData')
  const chats = join(profile, 'chats.json')
  if (existsSync(chats)) readPrivate(chats)
  const attachments = join(profile, 'attachments')
  if (existsSync(attachments)) {
    for (const name of readdirSync(attachments)) {
      if (/^[0-9a-f-]{36}\.(bin|json)$/.test(name)) readPrivate(join(attachments, name))
    }
  }
}
export function writePrivate(path: string, bytes: Buffer): void {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  cipher.setAAD(Buffer.from(basename(path)))
  const encrypted = Buffer.concat([MAGIC, nonce])
  const body = Buffer.concat([cipher.update(bytes), cipher.final()])
  const output = Buffer.concat([encrypted, cipher.getAuthTag(), body])
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, output, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}
export function readPrivate(path: string): Buffer {
  if (statSync(path).size > 96 * 1024 * 1024)
    throw new Error('Private data file exceeds its storage budget.')
  const bytes = readFileSync(path)
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    // A damaged encrypted header must not be mistaken for legacy plaintext and
    // overwritten. Admit only recognizable legacy JSON, UTF-8 text or rasters;
    // inspect image signatures here without decoding them in main.
    if (extname(path) === '.json') {
      try {
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch {
        throw new Error(
          'Invalid legacy JSON or damaged encrypted storage; original bytes preserved.'
        )
      }
    } else {
      const raster =
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
        /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii')) ||
        (bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
          bytes.subarray(8, 12).toString('ascii') === 'WEBP') ||
        bytes.subarray(0, 2).toString('ascii') === 'BM'
      if (!raster) {
        if (bytes.includes(0))
          throw new Error(
            'Invalid legacy data or damaged encrypted storage; original bytes preserved.'
          )
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          throw new Error(
            'Invalid legacy data or damaged encrypted storage; original bytes preserved.'
          )
        }
      }
    }

    writePrivate(path, bytes)
    return bytes
  }
  if (bytes.length < 36) throw new Error('Invalid encrypted private data.')
  const decipher = createDecipheriv('aes-256-gcm', key(false), bytes.subarray(8, 20))
  decipher.setAAD(Buffer.from(basename(path)))
  decipher.setAuthTag(bytes.subarray(20, 36))
  return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()])
}
