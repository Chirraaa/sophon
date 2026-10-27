const path = require('node:path')
const { build, Platform } = require('electron-builder')
build({
  targets: Platform.WINDOWS.createTarget('dir'),
  config: {
    directories: { output: path.resolve(__dirname, '../../.cache/security-package') }
  }
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
