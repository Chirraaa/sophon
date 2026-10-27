import { encodeWav } from './wav'
export class MicrophoneRecording {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private chunks: Float32Array[] = []
  private samples = 0
  private cancelled = false
  private flush: (() => void) | null = null
  private lastLevelAt = 0
  constructor(private onLevel?: (level: number) => void) {}
  async start(deviceId = ''): Promise<boolean> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    })
    if (this.cancelled) {
      stream.getTracks().forEach((track) => track.stop())
      return false
    }
    this.stream = stream
    let context: AudioContext
    try {
      context = new AudioContext({ sampleRate: 16000 })
    } catch {
      context = new AudioContext()
    }
    this.context = context
    await context.resume()
    await context.audioWorklet.addModule(new URL('voice-worklet.js', document.baseURI).href)
    if (this.cancelled) return false
    const node = new AudioWorkletNode(context, 'voice-recorder')
    this.node = node
    node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>): void => {
      if (data === 'flushed') {
        this.flush?.()
        return
      }
      if (data instanceof Float32Array && this.samples < context.sampleRate * 30) {
        const chunk = data.slice(0, context.sampleRate * 30 - this.samples)
        if (performance.now() - this.lastLevelAt > 80) {
          this.lastLevelAt = performance.now()
          const rms = Math.sqrt(
            chunk.reduce((sum, value) => sum + value * value, 0) / Math.max(1, chunk.length)
          )
          this.onLevel?.(Math.min(1, rms * 5))
        }
        this.chunks.push(chunk)
        this.samples += chunk.length
      }
    }
    this.source = context.createMediaStreamSource(stream)
    this.source.connect(node)
    node.connect(context.destination)
    return true
  }
  async finish(): Promise<Uint8Array> {
    if (!this.node || !this.context) throw new Error('The microphone was not ready.')
    this.source?.disconnect()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500)
      this.flush = () => {
        clearTimeout(timer)
        resolve()
      }
      this.node!.port.postMessage('flush')
    })
    const audio = encodeWav(this.chunks, this.context.sampleRate)
    this.cancel()
    return audio
  }
  cancel(): void {
    this.cancelled = true
    this.flush?.()
    this.flush = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.source?.disconnect()
    this.node?.disconnect()
    if (this.node) this.node.port.onmessage = null
    void this.context?.close().catch(() => {})
    this.stream = null
    this.chunks = []
  }
}
export function microphoneError(error: unknown): string {
  if (
    error instanceof DOMException &&
    ['NotAllowedError', 'PermissionDeniedError'].includes(error.name)
  ) {
    return 'Microphone access was denied. Allow desktop microphone access in Windows Settings → Privacy & security → Microphone.'
  }
  if (error instanceof DOMException && error.name === 'OverconstrainedError')
    return 'The selected microphone is unavailable. Choose another microphone in Settings → Voice.'
  if (error instanceof DOMException && error.name === 'NotFoundError')
    return 'No microphone found. Connect a microphone and try again.'
  return error instanceof Error ? error.message : 'The microphone could not be started.'
}
