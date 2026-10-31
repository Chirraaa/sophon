import { app, BrowserWindow, Notification, screen, type WebContents } from 'electron'
import { join } from 'path'
import { release } from 'os'
import { rendererDocument } from '../security/trusted-document'
import { stopRun, setInterfacePresenceProvider } from '../security/run-manager'
import { getSettings, onSettingsChange } from '../settings'
import { acceptsMessages, onSession, send, snapshot } from '../chat/session'
import { rememberExternalWindow, restoreExternalWindow } from '../tools/windows'
import {
  SW_RESTORE,
  bringToFront,
  foregroundWindow,
  getProcess,
  isMinimized,
  showWindow
} from '../tools/win32'
import { fullscreenApp } from '../services/fullscreen'
import icon from '../../../resources/icon.png?asset'
import { VoiceSession } from '../voice/session'
import { clearVisuals } from '../services/visuals'
import { lockWebRtc } from '../security/chromium-egress'
import { trustedDocument } from '../security/trusted-document'
import { describeDuration, type TimerInfo } from '../../shared/timers'
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
  private restDock = false
  private wasBusy = false
  private wasWaiting = false
  // Whether the shortcut opened over another app that should get focus back.
  private returnToApp = false
  private summoned = false
  private overlayTimer: NodeJS.Timeout | null = null
  private coveredBy = 0
  private raisedAt = 0
  private yieldedToGame = false
  // Games that dropped out of exclusive fullscreen when the bar showed over them.
  private readonly yieldTo = new Set<string>()
  private restTimer: NodeJS.Timeout | null = null
  private readonly offSettings: () => void
  readonly voice = new VoiceSession({
    publish: (state) => broadcast('voice:state', state),
    // Speaking while the open chat works adds to or is routed within its work; only a full
    // set of tasks in other chats blocks.
    busy: () => !acceptsMessages(),
    send: (text, owner) => send(text, [], this.interaction(owner, 'voice'))
  })
  constructor() {
    setInterfacePresenceProvider(() => ({
      fullAppVisible: Boolean(this.main?.isVisible() && !this.main.isMinimized()),
      shortcutVisible: Boolean(this.compact?.isVisible()),
      focused: this.compact?.isFocused() ? 'shortcut' : this.main?.isFocused() ? 'full-app' : null
    }))
    this.offSettings = onSettingsChange((settings) => {
      if (settings.dockAlwaysVisible) this.syncRest()
      else if (
        this.restDock &&
        this.compact?.isVisible() &&
        !snapshot().busy &&
        !this.compactTaskVisible
      )
        this.hideCompact()
    })
    onSession((state) => {
      const waiting = state.items.some(
        (item) => item.pending && item.actions.some((action) => action.status === 'waiting')
      )
      const finished = this.wasBusy && !state.busy
      const needsAction = waiting && !this.wasWaiting
      this.wasBusy = state.busy
      this.wasWaiting = waiting
      if ((finished || needsAction) && this.shouldAlert())
        this.showDock(finished ? 'finished' : undefined)
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
    win.webContents.on('render-process-gone', () => stopRun())
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
    win.on('focus', () => {
      this.stopRestWatch()
      this.hideCompact()
    })
    // A game brought over the full app hides it without minimizing it.
    win.on('blur', () => {
      if (!this.restTimer) this.restTimer = setInterval(this.syncRest, 1000)
    })
    win.on('hide', this.syncRest)
    win.on('minimize', this.syncRest)
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
      this.stopRestWatch()
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
    win.on('focus', () => {
      this.cancelHide()
      // Clicked into directly: there is no app to hand focus back to.
      if (!this.summoned) this.returnToApp = false
      this.summoned = false
    })
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
      this.stopOverlay()
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
    this.returnToApp = rememberExternalWindow()
    const win = this.compact && !this.compact.isDestroyed() ? this.compact : this.createCompact()
    this.cancelHide()
    this.stopOverlay()
    this.compactDocked = false
    this.restDock = false
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
        this.summoned = !win.isFocused()
        win.show()
        win.focus()
      }
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
    else reveal()
  }
  hideCompact = (): void => {
    this.cancelHide()
    this.giveBackFocus()
    this.compactDocked = false
    this.undockedY = null
    if (!this.compact || this.compact.isDestroyed()) return
    this.voice.detached(this.compact.webContents)
    if (this.wantsRestDock()) return this.showDock()
    this.restDock = false
    this.stopOverlay()
    this.compact.hide()
  }
  /** Esc and the shortcut: a docked bar stays where it is and the app behind gets focus back. */
  dismissCompact = (): void => {
    const win = this.compact
    if (!win || win.isDestroyed() || !win.isVisible() || !this.compactDocked)
      return this.hideCompact()
    if (!this.giveBackFocus()) win.blur()
  }
  private giveBackFocus(): boolean {
    if (!this.returnToApp || !this.compact?.isFocused()) return false
    this.returnToApp = false
    return restoreExternalWindow()
  }
  /** Opens the docked bar in place for typing, keeping it docked. */
  private openDock(win: BrowserWindow): void {
    this.returnToApp = rememberExternalWindow()
    this.cancelHide()
    this.yieldedToGame = false
    this.presentation = {
      mode: 'command',
      token: this.presentation.token + 1,
      docked: true,
      expand: true
    }
    win.webContents.send('compact:shown', this.presentation)
    this.summoned = !win.isFocused()
    win.show()
    win.focus()
  }
  private watchOverlay(): void {
    if (!this.overlayTimer) this.overlayTimer = setInterval(this.keepOverlay, 1000)
  }
  private stopOverlay(): void {
    if (this.overlayTimer) clearInterval(this.overlayTimer)
    this.overlayTimer = null
    this.coveredBy = 0
    this.yieldedToGame = false
  }
  private stopRestWatch(): void {
    if (this.restTimer) clearInterval(this.restTimer)
    this.restTimer = null
  }
  // Keeps the docked bar above fullscreen and borderless games. Most fullscreen
  // games are composed by Windows and keep running under a window that never
  // takes focus. One that still drops to the desktop when the bar shows over it
  // gets its window back, and the bar steps aside for that game from then on.
  private keepOverlay = (): void => {
    const win = this.compact
    if (!win || win.isDestroyed() || !this.compactDocked) return this.stopOverlay()
    if (this.coveredBy && this.droppedOut(win)) return
    const game = fullscreenApp()
    if (game && this.yieldTo.has(game.exe)) {
      if (win.isVisible() && !win.isFocused()) {
        win.hide()
        this.yieldedToGame = true
      }
      return
    }
    if (this.yieldedToGame) {
      this.yieldedToGame = false
      win.showInactive()
    }
    if (game && win.isVisible()) {
      // A game that regains focus takes the top of the topmost band, so the bar
      // is raised again on every tick rather than only when the game first shows.
      if (game.hwnd !== this.coveredBy) {
        win.setAlwaysOnTop(true, 'pop-up-menu')
        this.raisedAt = Date.now()
      }
      win.moveTop()
    }
    this.coveredBy = game?.hwnd ?? 0
  }
  // The covered game minimized right after the bar rose and nothing else took
  // the foreground: it left exclusive fullscreen because of the bar.
  private droppedOut(win: BrowserWindow): boolean {
    const hwnd = this.coveredBy
    if (Date.now() - this.raisedAt > 5000 || win.isFocused() || !isMinimized(hwnd)) return false
    const front = foregroundWindow()
    if (front && front !== hwnd) {
      const { pid, exe } = getProcess(front)
      if (pid !== process.pid && exe.toLowerCase() !== 'explorer.exe') return false
    }
    this.yieldTo.add(getProcess(hwnd).exe)
    this.coveredBy = 0
    win.hide()
    this.yieldedToGame = true
    showWindow(hwnd, SW_RESTORE)
    bringToFront(hwnd)
    return true
  }
  private mainShowing(): boolean {
    const main = this.main
    if (!main || main.isDestroyed() || !main.isVisible() || main.isMinimized()) return false
    if (main.isFocused()) return true
    // A fullscreen game in front hides the full app as surely as minimizing it.
    const game = fullscreenApp()
    return !game || game.displayId !== screen.getDisplayMatching(main.getBounds()).id
  }
  private wantsRestDock(): boolean {
    return getSettings().dockAlwaysVisible && !this.mainShowing() && !this.quitting
  }
  // Someone looking at either window already sees what changed.
  private shouldAlert(): boolean {
    return (
      getSettings().dockNotify &&
      !this.quitting &&
      !this.main?.isFocused() &&
      !this.compact?.isFocused()
    )
  }
  /** Rests the shortcut window as a slim top bar when the full app is away. */
  syncRest = (): void => {
    if (!this.mainShowing() || this.main?.isFocused()) this.stopRestWatch()
    if (this.yieldedToGame || this.compact?.isVisible()) return
    if (this.wantsRestDock()) this.showDock()
  }
  /** A timer reached zero: raise a system notification and flag the bar unless someone is already looking. */
  timerDone = (timer: TimerInfo): void => {
    if (this.quitting) return
    if (Notification.isSupported())
      new Notification({
        title: timer.label || 'Timer',
        body: `Time's up — ${describeDuration(timer.durationMs / 1000)}.`,
        icon
      }).show()
    if (this.shouldAlert()) this.showDock('timer')
  }
  /** Shows the docked bar without taking focus, optionally flagging a finished task. */
  showDock = (notice?: 'finished' | 'timer'): void => {
    const win = this.compact && !this.compact.isDestroyed() ? this.compact : this.createCompact()
    this.cancelHide()
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const [currentWidth, height] = win.getSize()
    const width = Math.min(currentWidth, area.width)
    this.compactDocked = true
    this.restDock = true
    this.undockedY = null
    win.setBounds({
      width,
      height,
      x: Math.round(area.x + (area.width - width - this.compactMainOffset) / 2),
      y: area.y
    })
    this.presentation = {
      mode: 'command',
      token: this.presentation.token + 1,
      docked: true,
      ...(notice ? { notice } : {})
    }
    const reveal = (): void => {
      if (win.isDestroyed()) return
      win.webContents.send('compact:shown', this.presentation)
      this.watchOverlay()
      const game = fullscreenApp()
      if (game && this.yieldTo.has(game.exe) && !win.isFocused()) {
        win.hide()
        this.yieldedToGame = true
      } else win.showInactive()
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
    else reveal()
  }
  toggleCompact = (): void => {
    const win = this.compact && !this.compact.isDestroyed() ? this.compact : null
    if (win?.isVisible() && win.isFocused()) this.dismissCompact()
    else if (win && this.compactDocked && (win.isVisible() || this.yieldedToGame))
      this.openDock(win)
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
    const nextWidth = Math.round(Math.min(Math.max(width, 320), 1664, area.width))
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
      this.watchOverlay()
      win.setBounds({ ...bounds, y: screen.getDisplayMatching(bounds).workArea.y })
      return
    }
    this.stopOverlay()
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
    this.offSettings()
    this.cancelHide()
    this.stopOverlay()
    this.stopRestWatch()
    this.voice.dispose()
  }
}
