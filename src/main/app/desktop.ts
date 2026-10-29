import { app, BrowserWindow, screen, type WebContents } from 'electron'
import { join } from 'path'
import { release } from 'os'
import { rendererDocument } from '../security/trusted-document'
import { stopRun, setInterfacePresenceProvider } from '../security/run-manager'
import { getSettings } from '../settings'
import { onSession, send, snapshot } from '../chat/session'
import { rememberExternalWindow } from '../tools/windows'
import icon from '../../../resources/icon.png?asset'
import { VoiceSession } from '../voice/session'
import { clearVisuals } from '../services/visuals'
import { lockWebRtc } from '../security/chromium-egress'
import { trustedDocument } from '../security/trusted-document'
const recipients = new Set<WebContents>()
export function broadcast(channel: string, payload: unknown): void {
  for (const contents of recipients)
    if (!contents.isDestroyed() && trustedDocument(contents.mainFrame.url))
      contents.send(channel, payload)
}
function loadRenderer(win: BrowserWindow, route = ''): void {
  const url = rendererDocument()
  url.hash = route
  void win.loadURL(url.href)
}
export class Desktop {
  main: BrowserWindow | null = null
  compact: BrowserWindow | null = null
  quitting = false
  presentation: CompactPresentation = { mode: 'command', token: 0 }
  private commandPosition: {
    x: number
    y: number
  } | null = null
  private modalDepth = 0
  private compactTaskVisible = false
  private compactMainOffset = 0
  private compactDocked = false
  private undockedY: number | null = null
  private hideTimer: NodeJS.Timeout | null = null
  readonly voice = new VoiceSession({
    publish: (state) => broadcast('voice:state', state),
    busy: () => snapshot().busy,
    send: (text, owner) => send(text, [], this.interaction(owner, 'voice'))
  })
  constructor() {
    setInterfacePresenceProvider(() => ({
      fullAppVisible: Boolean(this.main?.isVisible() && !this.main.isMinimized()),
      shortcutVisible: Boolean(this.compact?.isVisible()),
      focused: this.compact?.isFocused() ? 'shortcut' : this.main?.isFocused() ? 'full-app' : null
    }))
    onSession((state) => {
      this.cancelHide()
      if (state.busy || this.compactTaskVisible || this.compactDocked || !this.compact?.isVisible())
        return
      if (!this.compact.isFocused())
        this.hideTimer = setTimeout(() => {
          if (
            !snapshot().busy &&
            !this.compactTaskVisible &&
            !this.voice.active() &&
            !this.compact?.isFocused()
          )
            this.hideCompact()
        }, 12000)
    })
  }
  owns(contents: WebContents | null): boolean {
    return Boolean(
      contents && (contents === this.main?.webContents || contents === this.compact?.webContents)
    )
  }
  interaction(
    contents: WebContents,
    input: InteractionContext['input'] = 'text'
  ): InteractionContext {
    return { surface: contents === this.compact?.webContents ? 'shortcut' : 'full-app', input }
  }
  private watch(win: BrowserWindow): void {
    recipients.add(win.webContents)
    win.webContents.once('destroyed', () => recipients.delete(win.webContents))
    lockWebRtc(win.webContents)
    win.webContents.on('will-frame-navigate', (event) => {
      if (
        event.isMainFrame ||
        !event.url.startsWith('sophon-visual://render/') ||
        event.initiator !== win.webContents.mainFrame
      )
        event.preventDefault()
    })
    win.webContents.on('destroyed', () => clearVisuals(win.webContents))
    win.webContents.on('render-process-gone', () => this.voice.detached(win.webContents))
    win.webContents.on('did-start-loading', () => this.voice.detached(win.webContents))
    win.webContents.on('destroyed', () => this.voice.detached(win.webContents))
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.on('render-process-gone', stopRun)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }
  createMain(): BrowserWindow {
    const mica = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621
    const win = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 780,
      minHeight: 540,
      show: false,
      autoHideMenuBar: true,
      title: 'Sophon',
      icon,
      backgroundColor: mica ? '#00000000' : '#0b0b0c',
      ...(mica ? { backgroundMaterial: 'mica' as const } : {}),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#d4d4d8', height: 40 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        devTools: !app.isPackaged,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false
      }
    })
    this.main = win
    win.on('focus', () => this.hideCompact())
    win.on('ready-to-show', () => {
      if (!process.argv.includes('--hidden')) win.show()
    })
    win.on('close', (event) => {
      if (this.quitting) return
      if (getSettings().closeToTray) {
        event.preventDefault()
        win.hide()
      } else app.quit()
    })
    win.on('closed', () => {
      this.main = null
    })
    this.watch(win)
    loadRenderer(win)
    return win
  }
  showMain = (): void => {
    const win = this.main && !this.main.isDestroyed() ? this.main : this.createMain()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  createCompact(): BrowserWindow {
    const win = new BrowserWindow({
      width: 680,
      title: 'Sophon quick command',
      icon,
      height: 160,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        devTools: !app.isPackaged,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        backgroundThrottling: false
      }
    })
    this.compact = win
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.on('blur', () => {
      if (
        this.modalDepth ||
        this.compactDocked ||
        this.compactTaskVisible ||
        snapshot().busy ||
        this.voice.active() ||
        this.presentation.mode === 'voice'
      )
        return
      this.hideCompact()
    })
    win.on('focus', () => this.cancelHide())
    const reportArea = (): void => {
      if (!win.isDestroyed()) win.webContents.send('compact:work-area', this.compactWorkArea())
    }
    const fitWorkArea = (): void => {
      if (win.isDestroyed()) return
      const [width, height] = win.getSize()
      this.resizeCompact(height, width)
      reportArea()
    }
    win.on('move', reportArea)
    screen.on('display-metrics-changed', fitWorkArea)
    screen.on('display-removed', fitWorkArea)
    win.on('will-move', (event, bounds) => {
      if (this.compactDocked) return event.preventDefault()
      this.commandPosition = { x: bounds.x, y: bounds.y }
    })
    win.on('closed', () => {
      this.compact = null
      this.compactTaskVisible = false
      screen.removeListener('display-metrics-changed', fitWorkArea)
      screen.removeListener('display-removed', fitWorkArea)
    })
    this.watch(win)
    loadRenderer(win, '/compact')
    return win
  }
  private cancelHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
  }
  showCompact = (mode: 'command' | 'voice' = 'command'): void => {
    rememberExternalWindow()
    const win = this.compact && !this.compact.isDestroyed() ? this.compact : this.createCompact()
    this.cancelHide()
    this.compactDocked = false
    this.undockedY = null
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const [currentWidth, currentHeight] = win.getSize()
    const width = Math.min(currentWidth, area.width)
    const height = Math.min(currentHeight, area.height)
    const saved = mode === 'command' ? this.commandPosition : null
    win.setBounds({
      width,
      height,
      x: Math.round(
        Math.max(
          area.x,
          Math.min(
            saved?.x ?? area.x + (area.width - width - this.compactMainOffset) / 2,
            area.x + area.width - width
          )
        )
      ),
      y: Math.round(
        Math.max(
          area.y,
          Math.min(
            saved?.y ?? (mode === 'voice' ? area.y : area.y + area.height * 0.16),
            area.y + area.height - height
          )
        )
      )
    })
    this.presentation = { mode, token: this.presentation.token + 1 }
    const reveal = (): void => {
      if (win.isDestroyed()) return
      win.webContents.send('compact:shown', this.presentation)
      if (mode === 'voice') win.showInactive()
      else {
        win.show()
        win.focus()
      }
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
    else reveal()
  }
  hideCompact = (): void => {
    this.cancelHide()
    this.compactDocked = false
    this.undockedY = null
    if (!this.compact || this.compact.isDestroyed()) return
    this.voice.detached(this.compact.webContents)
    this.compact.hide()
  }
  toggleCompact = (): void => {
    if (this.compact?.isVisible() && this.compact.isFocused()) this.hideCompact()
    else this.showCompact()
  }
  talkTarget(): BrowserWindow {
    if (this.main?.isVisible() && this.main.isFocused()) return this.main
    this.showCompact('voice')
    return this.compact!
  }
  resizeCompact(height: number, width = 680, mainOffset = this.compactMainOffset): void {
    const win = this.compact
    if (!win || win.isDestroyed() || !Number.isFinite(height) || !Number.isFinite(width)) return
    const bounds = win.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const nextWidth = Math.round(Math.min(Math.max(width, 360), 1664, area.width))
    const nextHeight = Math.round(Math.min(Math.max(height, 96), 900, area.height))
    const x = Math.max(
      area.x,
      Math.min(
        bounds.x + Math.round((bounds.width + this.compactMainOffset - nextWidth - mainOffset) / 2),
        area.x + area.width - nextWidth
      )
    )
    const y = this.compactDocked
      ? area.y
      : Math.max(area.y, Math.min(bounds.y, area.y + area.height - nextHeight))
    this.compactMainOffset = mainOffset
    if (this.commandPosition && !this.compactDocked) this.commandPosition = { x, y }
    if (
      bounds.height !== nextHeight ||
      bounds.y !== y ||
      bounds.width !== nextWidth ||
      bounds.x !== x
    )
      win.setBounds({ width: nextWidth, height: nextHeight, x, y })
  }
  compactWorkArea(): { width: number; height: number } {
    const area =
      this.compact && !this.compact.isDestroyed()
        ? screen.getDisplayMatching(this.compact.getBounds()).workArea
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    return { width: area.width, height: area.height }
  }
  dockCompact(docked: boolean): void {
    const win = this.compact
    if (!win || win.isDestroyed() || docked === this.compactDocked) return
    const bounds = win.getBounds()
    this.compactDocked = docked
    if (docked) {
      this.undockedY = bounds.y
      this.cancelHide()
      win.setBounds({ ...bounds, y: screen.getDisplayMatching(bounds).workArea.y })
      return
    }
    const area = screen.getDisplayMatching(bounds).workArea
    const y = Math.max(
      area.y,
      Math.min(this.undockedY ?? bounds.y, area.y + area.height - bounds.height)
    )
    this.undockedY = null
    win.setBounds({ ...bounds, y })
  }
  setCompactTaskVisible(visible: boolean): void {
    this.compactTaskVisible = visible
    if (visible) this.cancelHide()
  }
  async keepOpen<T>(action: () => Promise<T>): Promise<T> {
    this.modalDepth++
    try {
      return await action()
    } finally {
      this.modalDepth--
    }
  }
  dispose(): void {
    setInterfacePresenceProvider(() => undefined)
    this.quitting = true
    this.cancelHide()
    this.voice.dispose()
  }
}
