const { build, Platform } = require('electron-builder')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const manifest = require('../../src/main/voice/manifest.json')
const unsigned = process.argv.includes('--unsigned')
function verifyVoice(directory) {
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(directory, name)))
      .digest('hex')
    if (actual !== expected) throw new Error(`Release voice manifest mismatch: ${name}`)
  }
}
verifyVoice(path.resolve(__dirname, '../../resources/whisper'))

build({
  publish: 'never',
  targets: Platform.WINDOWS.createTarget('nsis'),
  config: {
    forceCodeSigning: !unsigned,
    afterSign: (context) => verifyVoice(path.join(context.appOutDir, 'resources/whisper'))
  }
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
