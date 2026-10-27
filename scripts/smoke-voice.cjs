const { readFileSync } = require('fs')
const { join } = require('path')
const assert = require('node:assert/strict')
const { load, root } = require('./security/load.cjs')
const integrity = load('src/main/voice/integrity.ts', {
  './manifest.json': { default: require('../src/main/voice/manifest.json') },
  electron: { app: { isPackaged: false, getAppPath: () => root } },
  fs: require('fs'),
  'fs/promises': require('fs/promises'),
  crypto: require('crypto'),
  path: require('path'),
  '../security/workspace-handles': load('src/main/security/workspace-handles.ts', {
    koffi: require('koffi'),
    path: require('path'),
    crypto: require('crypto')
  })
})
const { WhisperServer } = load('src/main/voice/whisper.ts', {
  child_process: require('child_process'),
  fs: require('fs'),
  path: require('path'),
  net: require('net'),
  crypto: require('crypto'),
  'timers/promises': require('timers/promises'),
  './integrity': integrity,
  '../security/owned-http': load('src/main/security/owned-http.ts', {
    koffi: require('koffi'),
    http: require('http')
  })
})
const { validateRecording } = load('src/main/voice/audio.ts')
const { encodeWav } = load('src/renderer/src/lib/wav.ts')
const original = readFileSync(join(root, '.cache', 'whisper-source', 'samples', 'jfk.wav'))
let offset = 12
let data = null
while (offset + 8 <= original.length) {
  const size = original.readUInt32LE(offset + 4)
  if (original.toString('ascii', offset, offset + 4) === 'data') {
    data = original.subarray(offset + 8, offset + 8 + size)
    break
  }
  offset += 8 + size + (size % 2)
}
assert.ok(data, 'JFK sample has audio data')
const samples = new Float32Array(data.length / 2)
for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768
const wav = encodeWav([samples], 16000)
validateRecording(wav)
const server = new WhisperServer()
const config = {
  enabled: true,
  serverPath: join(root, 'resources', 'whisper', 'whisper-server.exe'),
  modelPath: join(root, 'resources', 'whisper', 'ggml-base.bin'),
  compute: 'cpu',
  language: 'en'
}
;(async () => {
  try {
    const text = await server.transcribe(wav, config, new AbortController().signal)
    assert.match(text.toLowerCase(), /fellow americans/)
    console.log(`Local transcription passed: ${text}`)
  } finally {
    server.stop()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
