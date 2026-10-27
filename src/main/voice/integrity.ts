import { app } from 'electron'
import { createReadStream } from 'fs'
import { readdir, realpath } from 'fs/promises'
import { createHash } from 'crypto'
import { join, dirname } from 'path'
import { lockReadOnlyFile, lockWorkspaceParents } from '../security/workspace-handles'

import manifest from './manifest.json'
export const VOICE_HASHES: Record<string, string> = manifest.files
export async function verifyVoice(
  config: AppSettings['voice'],
  signal: AbortSignal
): Promise<void> {
  const root = await realpath(
    app.isPackaged
      ? join(process.resourcesPath, 'whisper')
      : join(app.getAppPath(), 'resources', 'whisper')
  )
  if (
    (await realpath(config.serverPath)) !== join(root, 'whisper-server.exe') ||
    (await realpath(config.modelPath)) !== join(root, 'ggml-base.bin')
  )
    throw new Error('Only the pinned bundled Whisper program and model are supported.')
  for (const name of await readdir(root)) {
    if (/\.(dll|exe)$/i.test(name) && !Object.hasOwn(VOICE_HASHES, name))
      throw new Error('Unexpected native program/library in the Whisper directory.')
  }
  for (const [name, expected] of Object.entries(VOICE_HASHES)) {
    signal.throwIfAborted()
    const path = await realpath(join(root, name))
    if (dirname(path) !== root) throw new Error('Linked Whisper files are blocked.')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
    if (hash.digest('hex') !== expected) throw new Error(`Whisper integrity check failed: ${name}.`)
  }
  signal.throwIfAborted()
}
export async function leaseVoice(
  config: AppSettings['voice'],
  signal: AbortSignal
): Promise<() => void> {
  const root = await realpath(dirname(config.serverPath))
  const leases: (() => void)[] = []
  const release = (): void => {
    for (const unlock of leases.splice(0).reverse()) unlock()
  }
  try {
    leases.push(lockWorkspaceParents(root, root, true))
    for (const name of Object.keys(VOICE_HASHES)) leases.push(lockReadOnlyFile(join(root, name)))
    await verifyVoice(config, signal)
    return release
  } catch (error) {
    release()
    throw error
  }
}
