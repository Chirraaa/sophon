import { app, safeStorage } from 'electron'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { modelEndpoint } from '../network/endpoint'
import { revokePolicy } from './run-manager'

function location(provider: ModelProvider, endpoint: string): string {
  if (!['openai', 'compatible', 'anthropic', 'claude'].includes(provider))
    throw new Error('This provider does not use an API key.')
  const base = modelEndpoint(endpoint, provider)
  const scope = createHash('sha256').update(`${provider}:${base}`).digest('hex')
  return join(app.getPath('userData'), `model-key-${scope}.enc`)
}
export function modelKey(provider: ModelProvider, endpoint: string): string {
  const file = location(provider, endpoint)
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  try {
    return safeStorage.decryptString(readFileSync(file))
  } catch {
    throw new Error('Add an API key for this model provider and endpoint in Settings > Model.')
  }
}
export function hasModelKey(provider: ModelProvider, endpoint: string): boolean {
  try {
    return Boolean(modelKey(provider, endpoint))
  } catch {
    return false
  }
}
export function setModelKey(provider: ModelProvider, endpoint: string, key: string): void {
  const file = location(provider, endpoint)
  if (key && !/^[\x21-\x7e]{8,4096}$/.test(key)) throw new Error('Invalid model API key.')
  if (provider === 'anthropic' && key && !key.startsWith('sk-ant-'))
    throw new Error('Anthropic API keys start with sk-ant-.')
  if (provider === 'claude' && key && !key.startsWith('sk-ant-oat'))
    throw new Error('Claude Code tokens start with sk-ant-oat. Create one with: claude setup-token')
  revokePolicy()
  if (!key) {
    rmSync(file, { force: true })
    return
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file + '.tmp', safeStorage.encryptString(key))
  renameSync(file + '.tmp', file)
}
