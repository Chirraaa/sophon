class VoiceRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.offset = 0
    this.port.onmessage = () => {
      if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset))
      this.offset = 0
      this.port.postMessage('flushed')
    }
  }
  process(inputs) {
    const input = inputs[0]?.[0]
    if (input) {
      for (const value of input) {
        this.buffer[this.offset++] = value
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice())
          this.offset = 0
        }
      }
    }
    return true
  }
}
registerProcessor('voice-recorder', VoiceRecorder)
