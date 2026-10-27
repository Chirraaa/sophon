export function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const input = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    input.set(chunk, offset)
    offset += chunk.length
  }
  const rate = 16000
  const count = Math.min(rate * 30, Math.floor((length * rate) / sampleRate))
  const bytes = new Uint8Array(44 + count * 2)
  const view = new DataView(bytes.buffer)
  const write = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }
  write(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  write(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * sampleRate) / rate)
    const end = Math.max(start + 1, Math.floor(((i + 1) * sampleRate) / rate))
    let sum = 0
    for (let j = start; j < end && j < input.length; j++) sum += input[j]
    const value = Math.max(-1, Math.min(1, sum / (end - start)))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}
