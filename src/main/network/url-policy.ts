import { isIP } from 'net'
import { lookup } from 'dns/promises'
import type { LookupFunction } from 'net'

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 2, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    )
  }
  if (isIP(address) !== 6) return false
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase()
  const halves = normalized.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(
    (part) => parseInt(part, 16)
  )
  return (
    words[0] >= 0x2000 &&
    words[0] <= 0x3fff &&
    !(words[0] === 0x2001 && (words[1] <= 0x1ff || words[1] === 0xdb8)) &&
    words[0] !== 0x2002 &&
    !(words[0] === 0x3fff && words[1] <= 0xfff)
  )
}
export async function publicLookup(host: string, signal: AbortSignal): Promise<LookupFunction> {
  signal.throwIfAborted()
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('DNS lookup cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
  })
  const addresses = await Promise.race([
    lookup(host, { all: true, verbatim: true }),
    cancelled
  ]).finally(() => signal.removeEventListener('abort', abort))
  signal.throwIfAborted()
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error('Blocked non-public service destination.')
  const address = addresses[0]

  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address])
    else callback(null, address.address, address.family)
  }
}
export function publicSourceUrl(input: string): string | null {
  try {
    if (input.length > 2048) return null
    const url = new URL(input)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !url.hostname.includes('.') ||
      /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname)
    )
      return null
    if (
      isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
      !publicAddress(url.hostname.replace(/^\[|\]$/g, ''))
    )
      return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}
