import { app, Menu, nativeImage, Tray } from 'electron'
import icon from '../../../resources/icon.png?asset'
import { getSettings } from '../settings'
import type { Desktop } from './desktop'
export function createTray(desktop: Desktop): {
  refresh: () => void
  dispose: () => void
} {
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip('Sophon')
  tray.on('click', desktop.showMain)
  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Sophon', click: desktop.showMain },
        {
          label: 'Quick command (' + getSettings().hotkeys.summon.replace(/Control/g, 'Ctrl') + ')',
          click: () => desktop.showCompact()
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
  }
  refresh()
  return { refresh, dispose: () => tray.destroy() }
}
