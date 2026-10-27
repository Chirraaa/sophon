import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { getSettings, onSettingsChange } from '../settings'
import { validateRecording, MAX_RECORDING_SECONDS } from './audio'
import { validateWhisperPaths, WhisperServer } from './whisper'
type Hooks = {
  publish: (state: VoiceSnapshot) => void
  busy: () => boolean
  send: (text: string, owner: WebContents) => Promise<void>
}
export class VoiceSession {
  private state: VoiceSnapshot = { phase: 'idle' }
  private owner: WebContents | null = null
  private timer: NodeJS.Timeout | null = null
  private abort: AbortController | null = null
  private server = new WhisperServer()
  private config: AppSettings['voice'] | null = null
  private stopWhenReady = false
  private detection: { owner: WebContents; expires: number } | null = null
  beginDeviceDetection(owner: WebContents): void {
    if (!getSettings().voice.enabled)
      throw new Error('Enable microphone access in Settings → Voice first.')
    this.detection = { owner, expires: Date.now() + 10000 }
  }
  endDeviceDetection(owner: WebContents): void {
    if (this.detection?.owner === owner) this.detection = null
  }
  canCapture(owner: WebContents | null): boolean {
    return Boolean(
      owner &&
      getSettings().voice.enabled &&
      ((owner === this.owner && ['starting', 'listening'].includes(this.state.phase)) ||
        (this.detection?.owner === owner && this.detection.expires > Date.now()))
    )
  }
  constructor(private hooks: Hooks) {
    onSettingsChange((settings) => {
      if (!settings.voice.enabled) {
        this.detection = null
        this.cancel()
        this.server.stop()
      }
    })
  }
  snapshot = (): VoiceSnapshot => this.state
  owns = (owner: WebContents, id: string): boolean => this.owner === owner && this.state.id === id
  active = (): boolean => ['starting', 'listening', 'transcribing'].includes(this.state.phase)
  private publish(state: VoiceSnapshot): void {
    this.state = state
    this.hooks.publish(state)
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
  private signal(command: 'start' | 'stop' | 'cancel'): void {
    if (this.owner && !this.owner.isDestroyed() && this.state.id)
      this.owner.send('voice:capture', { command, id: this.state.id })
  }
  start(owner: WebContents): void {
    if (!getSettings().voice.enabled) return
    if (this.active() || this.hooks.busy()) return
    try {
      validateWhisperPaths(getSettings().voice)
    } catch (error) {
      this.publish({ phase: 'error', error: (error as Error).message })
      return
    }
    this.owner = owner
    this.config = { ...getSettings().voice }
    this.stopWhenReady = false
    this.publish({ phase: 'starting', id: randomUUID() })
    this.signal('start')
    this.timer = setTimeout(
      () => this.fail('The microphone did not start. Check microphone access in Windows Settings.'),
      15000
    )
  }
  ready(owner: WebContents, id: string): void {
    if (this.owner !== owner || this.state.id !== id || this.state.phase !== 'starting') return
    this.clearTimer()
    this.publish({ phase: 'listening', id })
    if (this.stopWhenReady) {
      this.stop()
      return
    }
    this.timer = setTimeout(() => this.stop(), MAX_RECORDING_SECONDS * 1000)
  }
  stop(): void {
    if (this.state.phase === 'starting') {
      this.stopWhenReady = true
      return
    }
    if (this.state.phase !== 'listening') return
    this.clearTimer()
    this.stopWhenReady = false
    this.publish({ phase: 'transcribing', id: this.state.id })
    this.signal('stop')
    this.timer = setTimeout(
      () => this.fail('The microphone recording could not be read. Please try again.'),
      5000
    )
  }
  toggle(owner: WebContents): void {
    if (this.state.phase === 'starting' || this.state.phase === 'listening') this.stop()
    else if (!this.active()) this.start(owner)
  }
  fail(message: string): void {
    this.cancel()
    this.publish({ phase: 'error', error: message })
  }
  captureError(owner: WebContents, id: string, message: string): void {
    if (owner === this.owner && id === this.state.id) this.fail(String(message).slice(0, 400))
  }
  async receive(owner: WebContents, id: string, data: unknown): Promise<void> {
    if (
      !getSettings().voice.enabled ||
      owner !== this.owner ||
      this.state.id !== id ||
      this.state.phase !== 'transcribing' ||
      this.abort
    )
      return
    this.clearTimer()
    const abort = new AbortController()
    this.abort = abort
    try {
      const audio = validateRecording(data)
      const text = await this.server.transcribe(audio, this.config!, abort.signal)
      if (abort.signal.aborted || this.state.id !== id) return
      this.abort = null
      this.owner = null
      this.publish({ phase: 'idle' })
      await this.hooks.send(text, owner)
    } catch (error) {
      if (!abort.signal.aborted && this.state.id === id) this.fail((error as Error).message)
    } finally {
      if (this.abort === abort) this.abort = null
    }
  }
  cancel(): void {
    this.clearTimer()
    this.signal('cancel')
    if (this.abort) {
      this.abort.abort()
      this.server.stop()
      this.abort = null
    }
    this.owner = null
    this.publish({ phase: 'idle' })
  }
  detached(owner: WebContents): void {
    this.endDeviceDetection(owner)
    if (this.owner === owner) this.cancel()
  }
  dispose(): void {
    this.detection = null
    this.cancel()
    this.server.stop()
  }
}
