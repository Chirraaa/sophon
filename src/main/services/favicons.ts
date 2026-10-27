import { get } from 'https'

const cache = new Map<string, Promise<Buffer>>()

export function favicon(domain: string): Promise<Buffer> {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
    return Promise.reject(new Error('Invalid favicon domain'))
  const existing = cache.get(domain)
  if (existing) return existing
  const pending = new Promise<Buffer>((resolve, reject) => {
    const request = get(
      `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=32`,
      { headers: { Accept: 'image/png' } },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !response.headers['content-type']?.startsWith('image/png')
        ) {
          response.resume()
          reject(new Error('Favicon unavailable'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 65536) response.destroy(new Error('Favicon too large'))
          else chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          const bytes = Buffer.concat(chunks)
          if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            resolve(bytes)
          else reject(new Error('Invalid favicon'))
        })
      }
    )
    request.setTimeout(5000, () => request.destroy(new Error('Favicon timed out')))
    request.on('error', reject)
  })
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(domain, pending)
  return pending
}
