import { BrowserWindow, screen } from 'electron'
import { getSettings, onSettingsChange } from '../settings'

let active: { window: BrowserWindow; dispose: () => void } | null = null

export function hideScreenGlow(): void {
  const previous = active
  active = null
  previous?.dispose()
}

export function showScreenGlow(displayId: number, signal: AbortSignal): void {
  hideScreenGlow()
  const settings = getSettings()
  const display = screen.getAllDisplays().find((item) => item.id === displayId)
  if (!settings.screenGlow.enabled || signal.aborted || !display) return
  let win: BrowserWindow | undefined
  try {
    win = new BrowserWindow({
      ...display.bounds,
      title: 'Sophon screen observation',
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      focusable: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
        backgroundThrottling: false
      }
    })
    const window = win
    window.setIgnoreMouseEvents(true)
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setContentProtection(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    const still = settings.motion === 'reduced'
    const color = settings.screenGlow.color
    const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
      html,body { margin:0; width:100%; height:100%; overflow:hidden; background:transparent; pointer-events:none }
      .aura { position:fixed; inset:1px; border-radius:12px; border:1px solid ${color}99;
        box-shadow:inset 0 0 12px ${color}66,inset 0 0 32px ${color}33;
        opacity:.75; ${still ? '' : 'animation:breathe 3.6s ease-in-out infinite alternate;'} }
      @keyframes breathe { from { opacity:.45 } to { opacity:.9 } }
      ${settings.motion === 'system' ? '@media(prefers-reduced-motion:reduce) { .aura { animation:none } }' : ''}
      </style></head><body><div class="aura"></div></body></html>`
    const close = (): void => {
      if (active?.window === window) hideScreenGlow()
    }
    const unsubscribe = onSettingsChange(close)
    const dispose = (): void => {
      unsubscribe()
      signal.removeEventListener('abort', close)
      screen.removeListener('display-removed', close)
      screen.removeListener('display-metrics-changed', close)
      if (!window.isDestroyed()) window.destroy()
    }
    active = { window, dispose }
    signal.addEventListener('abort', close, { once: true })
    screen.on('display-removed', close)
    screen.on('display-metrics-changed', close)
    window.on('closed', close)
    window.webContents.on('render-process-gone', close)
    window.once('ready-to-show', () => {
      if (active?.window === window && !signal.aborted) window.showInactive()
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(close)
  } catch {
    if (active?.window === win) hideScreenGlow()
    else if (win && !win.isDestroyed()) win.destroy()
  }
}
