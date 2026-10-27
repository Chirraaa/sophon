import { StringDecoder } from 'string_decoder'

export function eventStream(onData: (data: string) => void): {
  write: (chunk: Buffer) => void
  end: () => void
} {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let data: string[] = []
  let first = true
  const consume = (text: string, final = false): void => {
    if (first && text.length) {
      first = false
      text = text.replace(/^\uFEFF/, '')
    }
    pending += text
    let index: number
    while ((index = pending.search(/[\r\n]/)) >= 0) {
      if (pending[index] === '\r' && index === pending.length - 1 && !final) break
      const line = pending.slice(0, index)
      const length = pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1
      pending = pending.slice(index + length)
      if (!line) {
        if (data.length) onData(data.join('\n'))
        data = []
      } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (final && (pending || data.length)) throw new Error('Incomplete model stream.')
  }
  return {
    write: (chunk) => consume(decoder.write(chunk)),
    end: () => consume(decoder.end(), true)
  }
}
