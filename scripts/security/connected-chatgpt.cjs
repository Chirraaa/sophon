const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// Runs only in Electron. Use the application's encrypted credential store and
// production refresh/scope checks in place; never copy, print or export tokens.
async function connectedChatgpt({ load, manager, transport, profile, scratch }) {
  const { app, safeStorage, shell } = require('electron')
  if (!app) throw new Error('Connected ChatGPT tests require Electron.')
  const credentialProfile = profile || path.join(app.getPath('appData'), 'sophon')
  // Windows safeStorage uses the profile's encryption context. A disposable
  // Electron profile cannot decrypt the application's existing credential file.
  app.setPath('userData', credentialProfile)
  app.setAppLogsPath(path.join(scratch, 'electron-logs'))
  await app.whenReady()
  if (!fs.existsSync(path.join(credentialProfile, 'chatgpt-auth.enc')))
    throw new Error(
      'No Sophon ChatGPT connection in the selected profile. Sign in through Sophon first.'
    )
  const auth = load('src/main/security/chatgpt-auth.ts', {
    electron: {
      app: { getPath: (name) => (name === 'userData' ? credentialProfile : app.getPath(name)) },
      safeStorage,
      shell
    },
    fs,
    path,
    crypto,
    http: require('node:http'),
    '../network/json-request': transport,
    './run-manager': manager,
    './chatgpt-oauth': load('src/main/security/chatgpt-oauth.ts', {
      crypto,
      jose: require('jose'),
      '../network/json-request': transport
    })
  })
  const status = auth.chatgptStatus()
  if (
    !status.accounts.some(
      (account) => account.id === status.activeId && account.signedIn && account.planEnabled
    )
  )
    throw new Error(
      'The selected Sophon account has no active ChatGPT plan-use consent. Enable it in Sophon settings.'
    )
  return auth
}
module.exports = { connectedChatgpt }
