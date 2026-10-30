import { request } from 'https'
import { publicLookup, publicSourceUrl } from './url-policy'
import { assertRun, type RunContext } from '../security/run-manager'
import { decodeImage } from '../services/isolated-parser'

const MAX_BYTES = 8 * 1024 * 1024
const TYPES = /^image\/(png|jpeg|webp|gif|bmp)\b/i

// Fetches a public HTTPS picture. The bytes are re-encoded by the isolated image
// parser, so the chat only ever shows a normalized JPEG, never the original file.
export async function fetchPublicImage(
  input: string,
  run: RunContext
): Promise<{ url: string; image: string }> {
  assertRun(run)
  if (++run.images > 6) throw new Error('Showing web images is limited to six per request.')
  let target = input
  const deadline = AbortSignal.any([run.signal, AbortSignal.timeout(15000)])
  for (let hop = 0; hop <= 3; hop++) {
    const allowed = publicSourceUrl(target)
    if (!allowed) throw new Error('Only public HTTPS images on port 443 are supported.')
    const url = new URL(allowed)
    const lookup = await publicLookup(url.hostname, deadline)
    deadline.throwIfAborted()
    const result = await new Promise<{ bytes?: Buffer; type?: string; redirect?: string }>(
      (resolve, reject) => {
        const req = request(
          url,
          {
            method: 'GET',
            agent: false,
            lookup,
            signal: deadline,
            maxHeaderSize: 32768,
            headers: {
              Accept: 'image/png, image/jpeg, image/webp, image/gif, image/bmp',
              'Accept-Encoding': 'identity',
              'User-Agent': 'Sophon/1.0 (public image viewer)'
            }
          },
          (res) => {
            const fail = (message: string): void => {
              res.destroy()
              reject(new Error(message))
            }
            if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
              res.destroy()
              if (!res.headers.location) return reject(new Error('Redirect has no destination.'))
              try {
                resolve({ redirect: new URL(res.headers.location, url).href })
              } catch {
                reject(new Error('Invalid redirect destination.'))
              }
              return
            }
            if (res.statusCode !== 200) return fail(`Website returned HTTP ${res.statusCode}.`)
            if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
              return fail('Compressed web responses are not supported.')
            const type = res.headers['content-type'] ?? ''
            if (!TYPES.test(type))
              return fail('Only PNG, JPEG, WebP, GIF and BMP images are supported.')
            if (Number(res.headers['content-length']) > MAX_BYTES)
              return fail('Image exceeds the 8 MB limit.')
            const chunks: Buffer[] = []
            let bytes = 0
            res.on('error', reject)
            res.on('data', (chunk: Buffer) => {
              bytes += chunk.length
              if (bytes > MAX_BYTES) return fail('Image exceeds the 8 MB limit.')
              chunks.push(chunk)
            })
            res.on('end', () =>
              resolve({ bytes: Buffer.concat(chunks), type: TYPES.exec(type)![1].toLowerCase() })
            )
          }
        )
        req.maxHeadersCount = 100
        req.on('error', () =>
          reject(
            new Error(
              deadline.aborted
                ? 'Web request stopped or timed out.'
                : 'Could not connect to the website.'
            )
          )
        )
        req.end()
      }
    )
    deadline.throwIfAborted()
    if (result.redirect) {
      target = result.redirect
      continue
    }
    const image = await decodeImage(
      `data:image/${result.type};base64,${result.bytes!.toString('base64')}`
    )
    assertRun(run)
    return { url: url.href, image }
  }
  throw new Error('Website exceeded the three-redirect limit.')
}
