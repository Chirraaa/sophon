import type { SecureIpc } from '../security/ipc'
import {
  getSettings,
  updateSettings,
  draftSettings,
  DEFAULT_SETTINGS,
  settingsRecovery,
  acknowledgeSettingsRecovery
} from '../settings'
import { confirmSettings } from '../security/settings-consent'
import { nativeConsent } from '../security/native-consent'
import type { Shortcuts } from './shortcuts'
export function registerSettingsIpc(shortcuts: Shortcuts, ipcMain: SecureIpc): void {
  ipcMain.handle('settings:get', getSettings)
  ipcMain.handle('settings:recovery', settingsRecovery)
  ipcMain.handle('settings:review-recovery', async () => {
    if (!settingsRecovery().required) return
    if (
      await nativeConsent(
        'Review recovered security settings?',
        JSON.stringify(
          {
            recovery: settingsRecovery(),
            rules: getSettings().rules,
            tools: getSettings().tools,
            workspace: getSettings().files.workspace
          },
          null,
          2
        )
      )
    )
      acknowledgeSettingsRecovery()
  })
  ipcMain.handle(
    'settings:update',
    async (_event, patch: SettingsPatch): Promise<SettingsResult> => {
      const before = getSettings()
      try {
        const next = draftSettings(patch)
        if (!(await confirmSettings(before, next)))
          return { ok: false, error: 'Security change cancelled.', settings: getSettings() }
        if (JSON.stringify(before) !== JSON.stringify(getSettings()))
          throw new Error('Settings changed during confirmation. Try again.')
        return { ok: true, settings: shortcuts.commitSettings(next, () => updateSettings(patch)) }
      } catch (error) {
        return { ok: false, error: (error as Error).message, settings: getSettings() }
      }
    }
  )
  ipcMain.handle('settings:reset', async () => {
    const before = getSettings()
    if (!(await confirmSettings(before, DEFAULT_SETTINGS, true))) return getSettings()
    if (JSON.stringify(before) !== JSON.stringify(getSettings()))
      throw new Error('Settings changed during confirmation.')
    const result = shortcuts.commitSettings(DEFAULT_SETTINGS, () =>
      updateSettings(DEFAULT_SETTINGS)
    )
    acknowledgeSettingsRecovery()
    return result
  })
}
