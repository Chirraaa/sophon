const RATE = 16000
export const MAX_RECORDING_SECONDS = 30
export function validateRecording(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error('Invalid microphone recording.')
  const b = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (
    b.length < 44 ||
    b.length > 44 + RATE * 2 * MAX_RECORDING_SECONDS ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.readUInt32LE(4) !== b.length - 8 ||
    b.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    b.readUInt32LE(16) !== 16 ||
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt32LE(24) !== RATE ||
    b.readUInt32LE(28) !== RATE * 2 ||
    b.readUInt16LE(32) !== 2 ||
    b.readUInt16LE(34) !== 16 ||
    b.toString('ascii', 36, 40) !== 'data' ||
    b.readUInt32LE(40) !== b.length - 44 ||
    b.length % 2
  ) {
    throw new Error('Invalid microphone recording.')
  }
  let speechFrames = 0
  for (let offset = 44; offset + 640 <= b.length; offset += 640) {
    let energy = 0
    for (let i = offset; i < offset + 640; i += 2) energy += (b.readInt16LE(i) / 32768) ** 2
    if (Math.sqrt(energy / 320) >= 0.008) speechFrames++
  }
  if (speechFrames < 5)
    throw new Error('No speech detected. Hold the microphone button and try again.')
  return value
}
