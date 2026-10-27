const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
module.exports = async function ({ load, root, fixture, runManager }) {
  const profile = path.join(fixture, 'privacy')
  fs.mkdirSync(profile)
  const app = { isPackaged: false, getPath: () => profile, getAppPath: () => root }
  let encrypted = true
  const credentials = load('src/main/security/credentials.ts', {
    electron: {
      app,
      safeStorage: {
        isEncryptionAvailable: () => encrypted,
        encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
        decryptString: (bytes) => bytes.toString().split('').reverse().join('')
      }
    },
    fs,
    path,
    './run-manager': runManager
  })
  encrypted = false
  assert.throws(() => credentials.setSearchKey('SYNTHETIC_KEY_123'), /encryption/)
  assert(!fs.existsSync(path.join(profile, 'search-key.enc')))
  encrypted = true
  credentials.setSearchKey('SYNTHETIC_KEY_123')
  assert.equal(credentials.searchKey(), 'SYNTHETIC_KEY_123')
  credentials.setSearchKey('')
  assert.equal(credentials.hasSearchKey(), false)
  const audit = load('src/main/security/audit.ts', { electron: { app }, fs, path })
  audit.securityEvent('tool_denied', crypto.randomUUID(), 'web_search')
  const logs = fs
    .readdirSync(path.join(profile, 'security-events'))
    .map((name) => fs.readFileSync(path.join(profile, 'security-events', name), 'utf8'))
    .join('')
  assert(
    !logs.includes('SYNTHETIC_KEY') && !logs.includes('query') && !logs.includes('authorization')
  )
  const attachments = load('src/main/services/attachments.ts', {
    electron: { app },
    crypto,
    'fs/promises': fsp,
    fs,
    path,
    '../llm/untrusted-data': load('src/main/llm/untrusted-data.ts', { crypto }),
    './isolated-parser': {},
    '../security/private-store': {}
  })
  const directory = path.join(profile, 'attachments')
  fs.mkdirSync(directory)
  const shared = crypto.randomUUID(),
    removed = crypto.randomUUID()
  for (const id of [shared, removed])
    for (const extension of ['.bin', '.json'])
      fs.writeFileSync(path.join(directory, id + extension), 'synthetic attachment')
  attachments.purgeAttachments(new Set([shared]), new Set([shared, removed]))
  assert(fs.existsSync(path.join(directory, shared + '.bin')))
  assert(!fs.existsSync(path.join(directory, removed + '.bin')))
  assert(!fs.existsSync(path.join(directory, removed + '.json')))
  const integrity = load('src/main/voice/integrity.ts', {
    './manifest.json': { default: require('../../src/main/voice/manifest.json') },
    electron: { app },
    fs,
    'fs/promises': fsp,
    crypto,
    path,
    '../security/workspace-handles': load('src/main/security/workspace-handles.ts', {
      koffi: require('koffi'),
      path,
      crypto
    })
  })
  await integrity.verifyVoice(
    {
      serverPath: path.join(root, 'resources/whisper/whisper-server.exe'),
      modelPath: path.join(root, 'resources/whisper/ggml-base.bin')
    },
    new AbortController().signal
  )
  await assert.rejects(
    integrity.verifyVoice(
      {
        serverPath: path.join(root, 'package.json'),
        modelPath: path.join(root, 'resources/whisper/ggml-base.bin')
      },
      new AbortController().signal
    ),
    /pinned/
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    integrity.verifyVoice(
      {
        serverPath: path.join(root, 'resources/whisper/whisper-server.exe'),
        modelPath: path.join(root, 'resources/whisper/ggml-base.bin')
      },
      controller.signal
    )
  )
  console.log(
    'PASS unavailable encryption fails closed, key deletion, redacted diagnostics, shared-attachment preservation and real pinned Whisper/model hashes'
  )
}
