import { request } from 'https'
import { publicLookup, publicSourceUrl } from './url-policy'

interface SearchHit {
  title: string
  url: string
  description: string
}

export async function exaSearch(query: string, signal: AbortSignal): Promise<SearchHit[]> {
  if (!query.trim() || query.length > 500)
    throw new Error('Use a public query up to 500 characters.')
  const url = new URL('https://mcp.exa.ai/mcp')
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  const lookup = await publicLookup(url.hostname, deadline)
  deadline.throwIfAborted()
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'web_search_exa',
      arguments: { query, numResults: 5 }
    }
  })
  const response = await new Promise<string>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent: false,
        lookup,
        signal: deadline,
        maxHeaderSize: 32768,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Sophon/1.0'
        }
      },
      (res) => {
        const fail = (message: string): void => {
          res.destroy()
          reject(new Error(message))
        }
        if (res.statusCode !== 200)
          return fail(
            `Exa search returned HTTP ${res.statusCode}. No redirect or provider fallback was followed.`
          )
        if (!/^(application\/json|text\/event-stream)\b/i.test(res.headers['content-type'] ?? ''))
          return fail('Exa search returned an unsupported response format.')
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
          return fail('Exa search returned unsupported compression.')
        if (Number(res.headers['content-length']) > 2 * 1024 * 1024)
          return fail('Exa search exceeded the response byte limit.')
        let bytes = 0
        const chunks: Buffer[] = []
        res.on('error', () => reject(new Error('Exa search response was interrupted.')))
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 2 * 1024 * 1024) return fail('Exa search exceeded the response byte limit.')
          chunks.push(chunk)
        })
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      }
    )
    req.maxHeadersCount = 100
    req.on('error', () =>
      reject(
        new Error(
          deadline.aborted ? 'Exa search stopped or timed out.' : 'Exa search could not connect.'
        )
      )
    )
    req.end(body)
  })
  deadline.throwIfAborted()
  return parseExaResponse(response)
}

export function parseExaResponse(body: string): SearchHit[] {
  if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024)
    throw new Error('Exa search exceeded the response byte limit.')
  const trimmed = body.trim()
  const frames = trimmed.startsWith('{')
    ? [trimmed]
    : body
        .split(/\r\n\r\n|\n\n|\r\r/)
        .slice(0, 64)
        .flatMap((frame) => {
          const lines = frame
            .split(/\r\n|\r|\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
          return lines.length ? [lines.join('\n')] : []
        })
  for (const frame of frames) {
    let payload: {
      jsonrpc?: unknown
      id?: unknown
      error?: unknown
      result?: { isError?: unknown; content?: { type?: unknown; text?: unknown }[] }
    }
    try {
      payload = JSON.parse(frame)
    } catch {
      continue
    }
    if (!payload || payload.jsonrpc !== '2.0' || payload.id !== 1) continue
    if (payload.error || payload.result?.isError)
      throw new Error(
        'Exa search is unavailable or its free-tier limit has been reached. Try later or select another configured provider.'
      )
    if (!Array.isArray(payload.result?.content)) break
    const text = payload.result.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
    return parseExaResults(text)
  }
  throw new Error('Exa search returned an invalid MCP response.')
}

export function parseExaResults(text: string): SearchHit[] {
  const results: SearchHit[] = []
  for (const block of text.split(/\r?\n---\r?\n/)) {
    const metadata = block.trim().match(/^Title:\s*([^\r\n]*)\r?\nURL:\s*([^\r\n]+)/)
    if (!metadata) continue
    const url = publicSourceUrl(metadata[2].trim())
    if (!url || results.some((entry) => entry.url === url)) continue
    const published = block.match(/(?:^|\n)Published: ([^\r\n]+)/)?.[1]
    const highlights = block.match(/(?:^|\n)Highlights:\s*\r?\n([\s\S]*)/)?.[1] ?? ''
    results.push({
      title: metadata[1].trim().slice(0, 300),
      url,
      description: (
        (published && published !== 'N/A' ? `Published: ${published}\n` : '') + highlights.trim()
      ).slice(0, 3000)
    })
    if (results.length >= 5) break
  }
  if (!results.length && !/^\s*no (?:search )?results(?: found)?[.!]?\s*$/i.test(text))
    throw new Error('Exa search returned no readable source results.')
  return results
}
