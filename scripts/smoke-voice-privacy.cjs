const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')

let settings = { voice: { enabled: false, deviceId: 'preferred' } }
let changed
let transcriptions = 0
let stops = 0
let finish
let signal
let sends = 0
let validations = 0
const events = []
const owner = { isDestroyed: () => false, send: (_channel, event) => events.push(event) }
const stranger = { isDestroyed: () => false, send: () => {} }
const { VoiceSession } = load('src/main/voice/session.ts', {
  crypto: require('node:crypto'),
  '../settings': {
    getSettings: () => settings,
    onSettingsChange: (listener) => {
      changed = listener
      return () => {}
    }
  },
  './audio': { validateRecording: (audio) => audio, MAX_RECORDING_SECONDS: 30 },
  './whisper': {
    validateWhisperPaths: () => validations++,
    WhisperServer: class {
      stop() {
        stops++
      }
      transcribe(_audio, _config, abort) {
        transcriptions++
        signal = abort
        return new Promise((resolve) => {
          finish = resolve
        })
      }
    }
  },
  '../chat/session': { snapshot: () => ({ mode: 'private' }) }
})
const session = new VoiceSession({
  publish: () => {},
  busy: () => false,
  send: async () => {
    sends++
  }
})
const enable = (enabled) => {
  settings = { voice: { ...settings.voice, enabled } }
  changed(settings)
}
async function main() {
  const { WhisperServer } = load('src/main/voice/whisper.ts', {
    child_process: { spawn: () => assert.fail('Disabled voice must never spawn Whisper') },
    fs: {},
    path: {},
    net: {},
    crypto: {},
    'timers/promises': {},
    './integrity': { leaseVoice: () => assert.fail('Disabled voice must not load model files') },
    '../security/owned-http': {}
  })
  await assert.rejects(
    new WhisperServer().transcribe(
      new Uint8Array(),
      { enabled: false },
      new AbortController().signal
    ),
    /Microphone access is disabled/
  )
  session.start(owner)
  session.toggle(owner)
  assert.equal(session.canCapture(owner), false)
  assert.throws(() => session.beginDeviceDetection(owner), /Enable microphone/)
  assert.equal(events.length, 0)
  assert.equal(validations, 0)
  assert.equal(transcriptions, 0)

  enable(true)
  session.beginDeviceDetection(owner)
  assert.equal(session.canCapture(owner), true)
  assert.equal(session.canCapture(stranger), false)
  enable(false)
  assert.equal(session.canCapture(owner), false)
  enable(true)
  assert.equal(session.canCapture(owner), false, 'Disabling revokes detection grants')

  session.start(owner)
  const first = session.snapshot().id
  session.ready(owner, first)
  enable(false)
  assert.equal(events.at(-1).command, 'cancel')
  assert.equal(session.snapshot().phase, 'idle')
  await session.receive(owner, first, new Uint8Array())
  assert.equal(transcriptions, 0, 'Late recordings cannot start Whisper')

  enable(true)
  session.start(owner)
  const second = session.snapshot().id
  session.ready(owner, second)
  session.stop()
  const pending = session.receive(owner, second, new Uint8Array())
  assert.equal(transcriptions, 1)
  enable(false)
  assert.equal(signal.aborted, true)
  assert.ok(stops > 0)
  finish('This must never be sent')
  await pending
  assert.equal(sends, 0)
  assert.equal(session.snapshot().phase, 'idle')
  session.dispose()
  console.log(
    'Voice privacy passed: disabled capture, detection revocation, recording cancellation, Whisper shutdown and discarded late transcripts.'
  )
}
main().catch((error) => {
  session.dispose()
  console.error(error)
  process.exitCode = 1
})
