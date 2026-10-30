import { app, session, Menu, dialog, nativeTheme } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { loadSettings, getSettings, onSettingsChange } from './settings'
import { loadSession, onSession, onSessionText } from './chat/session'
import { onTimerDone, onTimersChange } from './services/timers'
import { rememberExternalWindow } from './tools/windows'
import { Desktop, broadcast } from './app/desktop'
import { Shortcuts } from './app/shortcuts'
import { registerIpc } from './app/ipc'
import { createTray } from './app/tray'
import { registerVisualProtocol } from './services/visuals'
import { registerAppScheme, registerAppProtocol } from './services/app-assets'
import { trustedDocument, rendererDocument } from './security/trusted-document'
import { stopRun } from './security/run-manager'
import { lockChromiumSession, closeChromiumEgress } from './security/chromium-egress'
import { initializePrivateStorage } from './security/private-store'
import { cancelChatgptSignIn } from './security/chatgpt-auth'
import { closeConnections } from './plugins/runtime'
import { closeBrowsers } from './tools/browser/runtime'
import { UpdateService } from './services/updates'
import { GithubUpdater } from './services/update-transport'
import { snapshot } from './chat/session'
// Earlier builds stored data under the package name; carry it over to the Sophon folder.
try {
  const legacy = join(app.getPath('appData'), 'voice-agent')
  if (existsSync(legacy) && !existsSync(app.getPath('userData')))
    renameSync(legacy, app.getPath('userData'))
} catch {
  // Leave the old folder in place if it is locked; the app starts with fresh data.
}
app.commandLine.appendSwitch('site-per-process')
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]'
)
app.commandLine.appendSwitch('disable-quic')
registerAppScheme()
function applyLoginItem(): void {
  if (app.isPackaged)
    app.setLoginItemSettings({ openAtLogin: getSettings().launchAtStartup, args: ['--hidden'] })
}
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let desktop: Desktop | null = null
  let shortcuts: Shortcuts | null = null
  app.on('second-instance', () => desktop?.showMain())
  app.on('before-quit', () => {
    void closeConnections()
    void closeBrowsers()
    cancelChatgptSignIn()
    closeChromiumEgress()
    stopRun()
    desktop?.dispose()
    shortcuts?.dispose()
  })
  app.on('browser-window-created', (_event, win) => optimizer.watchWindowShortcuts(win))
  app
    .whenReady()
    .then(async () => {
      nativeTheme.themeSource = 'dark'
      electronApp.setAppUserModelId('com.sophon.desktop')
      Menu.setApplicationMenu(null)
      const document = rendererDocument()
      await lockChromiumSession(
        session.defaultSession,
        !app.isPackaged && /^https?:$/.test(document.protocol) ? document : undefined
      )
      loadSettings()
      initializePrivateStorage()
      loadSession()
      registerVisualProtocol()
      registerAppProtocol()
      const windows = new Desktop()
      desktop = windows
      const keys = new Shortcuts(windows)
      shortcuts = keys
      const updates = new UpdateService(
        app.isPackaged && process.platform === 'win32' ? new GithubUpdater() : null,
        (state) => broadcast('updates:changed', state),
        () => snapshot().busy || windows.voice.active(),
        (quitting) => {
          windows.quitting = quitting
        }
      )
      const stopUpdates = updates.start()
      app.once('will-quit', stopUpdates)
      registerIpc(windows, keys, updates)
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) => {
          callback(
            permission === 'media' &&
              windows.owns(contents) &&
              trustedDocument(contents.mainFrame.url) &&
              details.isMainFrame &&
              windows.voice.canCapture(contents) &&
              'mediaTypes' in details &&
              Boolean(details.mediaTypes?.length) &&
              (details.mediaTypes ?? []).every((type) => type === 'audio')
          )
        }
      )
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, _origin, details) =>
          permission === 'media' &&
          windows.owns(contents) &&
          Boolean(contents && trustedDocument(contents.mainFrame.url)) &&
          details.isMainFrame &&
          trustedDocument(details.requestingUrl ?? '') &&
          windows.voice.canCapture(contents) &&
          details.mediaType === 'audio'
      )
      session.defaultSession.on('will-download', (event) => event.preventDefault())

      const appOrigin = rendererDocument().origin
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        let allowed = /^(sophon-app:|sophon-visual:|data:|blob:)/.test(details.url)
        if (!app.isPackaged) {
          try {
            const url = new URL(details.url)
            const expected = new URL(appOrigin)
            allowed ||=
              url.origin === expected.origin ||
              (url.protocol === 'ws:' && url.host === expected.host)
          } catch {
            /* invalid destination */
          }
        }
        callback({ cancel: !allowed })
      })
      onSession((state) => broadcast('session:update', state))
      onSessionText((update) => broadcast('session:text', update))
      onTimersChange((timers) => broadcast('timers:changed', timers))
      onTimerDone(windows.timerDone)
      windows.createMain()
      windows.createCompact()
      if (process.argv.includes('--hidden')) windows.syncRest()
      const tray = createTray(windows)
      let voiceConfig = JSON.stringify(getSettings().voice)
      onSettingsChange((settings) => {
        const next = JSON.stringify(settings.voice)
        if (next !== voiceConfig) {
          windows.voice.dispose()
          voiceConfig = next
        }
        broadcast('settings:changed', settings)
        tray.refresh()
        applyLoginItem()
      })
      const timer = setInterval(rememberExternalWindow, 150)
      timer.unref()
      app.on('will-quit', () => {
        clearInterval(timer)
        tray.dispose()
      })
      applyLoginItem()
      keys.resume()
    })
    .catch((error: Error) => {
      console.error(error)
      dialog.showErrorBox('Sophon could not start safely', error.message)
      app.quit()
    })
}
