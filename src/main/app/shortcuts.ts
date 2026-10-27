import { globalShortcut } from 'electron'
import { getSettings } from '../settings'
import { snapshot } from '../chat/session'
import { shortcutKeys, waitForRelease } from '../voice/shortcut'
import type { Desktop } from './desktop'
import { validateShortcut } from '../../shared/shortcut-contract'
export class Shortcuts {
  commitSettings(next: AppSettings, persist: () => AppSettings): AppSettings {
    validateShortcut(next.hotkeys.summon)
    validateShortcut(next.hotkeys.talk)
    if (next.hotkeys.summon.toLowerCase() === next.hotkeys.talk.toLowerCase())
      throw new Error('Choose different shortcuts.')
    const staged: string[] = []
    try {
      for (const kind of ['summon', 'talk'] as const) {
        if (kind === 'talk' && !next.voice.enabled) continue
        const value = next.hotkeys[kind]
        if (value === this[kind]) continue
        if (
          !globalShortcut.register(
            value,
            kind === 'summon' ? this.desktop.toggleCompact : this.talkPressed
          )
        )
          throw new Error('Shortcut is unavailable.')
        staged.push(value)
      }
      const result = persist()
      for (const kind of ['summon', 'talk'] as const) {
        if (kind === 'talk' && !next.voice.enabled) {
          if (this.talk) globalShortcut.unregister(this.talk)
          this.talk = null
          this.releaseTalk?.()
          this.releaseTalk = null
          continue
        }
        if (this[kind] && this[kind] !== next.hotkeys[kind]) globalShortcut.unregister(this[kind]!)
        this[kind] = next.hotkeys[kind]
      }
      return result
    } catch (error) {
      for (const value of staged) globalShortcut.unregister(value)
      throw error
    }
  }
  private summon: string | null = null
  private talk: string | null = null
  private releaseTalk: (() => void) | null = null
  private resumeTimer: NodeJS.Timeout | null = null
  constructor(private desktop: Desktop) {}
  private register(
    kind: 'summon' | 'talk',
    accelerator: string,
    handler: () => void
  ): {
    ok: boolean
    error?: string
  } {
    try {
      validateShortcut(accelerator)
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
    const previous = this[kind]
    if (previous) globalShortcut.unregister(previous)
    try {
      if (globalShortcut.register(accelerator, handler)) {
        this[kind] = accelerator
        return { ok: true }
      }
    } catch {
      this[kind] = null
    }
    this[kind] = null
    if (previous) {
      try {
        if (globalShortcut.register(previous, handler)) this[kind] = previous
      } catch {
        this[kind] = null
      }
    }
    return {
      ok: false,
      error: `Couldn't use "${accelerator}". It may be invalid or taken by another app.`
    }
  }
  registerSummon = (
    value: string
  ): {
    ok: boolean
    error?: string
  } => this.register('summon', value, this.desktop.toggleCompact)
  registerTalk = (
    value: string
  ): {
    ok: boolean
    error?: string
  } => {
    if (!getSettings().voice.enabled) return { ok: true }
    try {
      shortcutKeys(value)
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
    return this.register('talk', value, this.talkPressed)
  }
  private talkPressed = (): void => {
    if (!getSettings().voice.enabled) return
    const voice = this.desktop.voice
    if (this.releaseTalk || snapshot().busy || voice.snapshot().phase === 'transcribing') return
    const hold = getSettings().voice.mode === 'hold'
    let released = false
    let captureId: string | undefined
    this.releaseTalk = waitForRelease(getSettings().hotkeys.talk, () => {
      released = true
      this.releaseTalk = null
      if (hold && captureId && voice.snapshot().id === captureId) voice.stop()
    })
    if (voice.active()) {
      if (!hold) voice.stop()
      return
    }
    const win = this.desktop.talkTarget()
    const start = (): void => {
      if (win.isDestroyed() || (hold && released)) return
      voice.start(win.webContents)
      captureId = voice.snapshot().id
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', start)
    else start()
  }
  suspend = (): void => {
    this.desktop.voice.cancel()
    this.releaseTalk?.()
    this.releaseTalk = null
    globalShortcut.unregisterAll()
    this.summon = null
    this.talk = null
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    this.resumeTimer = setTimeout(this.resume, 60000)
  }
  resume = (): void => {
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    this.resumeTimer = null
    if (!this.summon) this.registerSummon(getSettings().hotkeys.summon)
    if (!this.talk) this.registerTalk(getSettings().hotkeys.talk)
  }
  dispose(): void {
    this.releaseTalk?.()
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    globalShortcut.unregisterAll()
  }
}
