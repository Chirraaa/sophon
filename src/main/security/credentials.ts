import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { revokePolicy } from './run-manager'

const location = (): string => join(app.getPath('userData'), 'search-key.enc')
export function searchKey(): string {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  try {
    return safeStorage.decryptString(readFileSync(location()))
  } catch {
    throw new Error('Add a Brave Search API key in Settings to enable public search.')
  }
}
export function hasSearchKey(): boolean {
  try {
    return Boolean(searchKey())
  } catch {
    return false
  }
}
export function setSearchKey(key: string): void {
  revokePolicy()
  if (!key) {
    rmSync(location(), { force: true })
    return
  }
  if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw new Error('Invalid search API key.')
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(location() + '.tmp', safeStorage.encryptString(key))
  renameSync(location() + '.tmp', location())
}
