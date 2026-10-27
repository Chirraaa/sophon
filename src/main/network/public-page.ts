import { request } from 'https'
import { randomUUID } from 'crypto'
import { publicLookup, publicSourceUrl } from './url-policy'
import { assertRun, type RunContext } from '../security/run-manager'
import { getSettings } from '../settings'
import { extractWebHtml } from './html-text'
import { parsePdf } from '../services/isolated-parser'

export async function requestPublicText(
  input: string,
  signal: AbortSignal
): Promise<{
  url: string
  body: string
  html: boolean
  pages?: string[]
}> {
  let target = input
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  for (let hop = 0; hop <= 3; hop++) {
    const allowed = publicSourceUrl(target)
    if (!allowed) throw new Error('Only public HTTPS pages on port 443 are supported.')
    const url = new URL(allowed)
    const lookup = await publicLookup(url.hostname, deadline)
    deadline.throwIfAborted()
    const result = await new Promise<{
      body: string
      html: boolean
      pdf?: Buffer
      redirect?: string
    }>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          agent: false,
          lookup,
          signal: deadline,
          maxHeaderSize: 32768,
          headers: {
            Accept: 'text/html, text/plain;q=0.9, application/pdf;q=0.9',
            'Accept-Encoding': 'identity',
            'User-Agent': 'Sophon/1.0 (public web reader)'
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
              resolve({
                body: '',
                html: false,
                redirect: new URL(res.headers.location, url).href
              })
            } catch {
              reject(new Error('Invalid redirect destination.'))
            }
            return
          }
          if (res.statusCode !== 200) return fail(`Website returned HTTP ${res.statusCode}.`)
          if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
            return fail('Compressed web responses are not supported.')
          const type = res.headers['content-type'] ?? ''
          const pdf = /^application\/pdf\b/i.test(type)
          const maxBytes = pdf ? 8 * 1024 * 1024 : 1024 * 1024
          if (!/^(text\/html|text\/plain|application\/pdf)\b/i.test(type))
            return fail('Only HTML, plain text and PDF documents are supported.')
          if (!pdf && /charset\s*=\s*["']?(?!utf-8\b|us-ascii\b)[\w-]+/i.test(type))
            return fail('This page uses an unsupported text encoding.')
          if (Number(res.headers['content-length']) > maxBytes)
            return fail(`Page exceeds the ${maxBytes / 1024 / 1024} MB limit.`)
          const chunks: Buffer[] = []
          let bytes = 0
          res.on('error', reject)
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > maxBytes)
              return fail(`Page exceeds the ${maxBytes / 1024 / 1024} MB limit.`)
            chunks.push(chunk)
          })
          res.on('end', () =>
            resolve({
              body: pdf ? '' : Buffer.concat(chunks).toString('utf8'),
              pdf: pdf ? Buffer.concat(chunks) : undefined,
              html: /^text\/html\b/i.test(type)
            })
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
    })
    deadline.throwIfAborted()
    if (result.redirect) {
      target = result.redirect
      continue
    }
    if (result.pdf) {
      const document = await parsePdf(result.pdf)
      signal.throwIfAborted()
      return { url: url.href, body: document.text, html: false, pages: document.pages }
    }
    return { url: url.href, body: result.body, html: result.html }
  }
  throw new Error('Website exceeded the three-redirect limit.')
}

export async function webFetch(
  url: string,
  run: RunContext
): Promise<
  ResearchSource & {
    text: string
    truncated: boolean
    links: { title: string; url: string }[]
  }
> {
  assertRun(run)
  if (++run.pages > 6) throw new Error('Page reading is limited to six calls per request.')
  const page = await requestPublicText(url, run.signal)
  assertRun(run)
  const parsed = page.html ? extractWebHtml(page.body) : null
  const text = parsed?.text ?? page.body

  const model = getSettings().model
  const limit =
    model.provider === 'chatgpt'
      ? 16000
      : Math.min(16000, Math.max(1000, Math.floor(model.contextWindow / 8)))
  const title = parsed?.title ?? ''
  const links: { title: string; url: string }[] = []
  for (const entry of parsed?.links ?? []) {
    try {
      const link = publicSourceUrl(new URL(entry.href, page.url).href)
      if (link && !links.some((entry) => entry.url === link))
        links.push({ title: entry.title, url: link })
    } catch {
      /* Invalid links are omitted. */
    }
    if (links.length >= 12) break
  }
  const source: ResearchSource = {
    id: randomUUID(),
    taskId: run.id,
    title: title.slice(0, 300) || page.url,
    url: page.url,
    snippet: text.slice(0, 1000),
    fetchedAt: new Date().toISOString(),
    provenance: 'untrusted-web'
  }
  run.sources.push(source)
  return { ...source, text: text.slice(0, limit), truncated: text.length > limit, links }
}
