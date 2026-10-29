import { request } from 'https'

export const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const BASE = `${GRAPH_ORIGIN}/v1.0`

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number
  ) {
    super(message)
  }
}

export type GraphOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Path and query below /v1.0, starting with a single slash. */
  path: string
  token: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number
  maxBytes?: number
}
export type GraphResponse = { status: number; body: Record<string, unknown> | null }

function target(path: string): URL {
  if (
    !/^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/?]*$/.test(path) ||
    path.startsWith('//') ||
    /\/\.\.?(\/|$|\?)/.test(path)
  )
    throw new Error('Invalid Graph path.')
  const url = new URL(BASE + path)
  if (url.origin !== GRAPH_ORIGIN || url.username || url.password)
    throw new Error('Invalid Graph path.')
  return url
}
const safeCode = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(value) ? value : ''

/** One HTTPS request to Microsoft Graph with the account's bearer token. No redirects, bounded output. */
export function graphRequest(options: GraphOptions): Promise<GraphResponse> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = target(options.path)
    } catch (error) {
      return reject(error)
    }
    if (!/^[\x21-\x7e]{1,65536}$/.test(options.token)) return reject(new Error('Invalid token.'))
    const payload =
      options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(options.timeout ?? 20000)
    ])
    const limit = options.maxBytes ?? 1024 * 1024
    const req = request(
      url,
      {
        method: options.method,
        agent: false,
        signal,
        maxHeaderSize: 32768,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          Authorization: `Bearer ${options.token}`,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {}),
          ...options.headers
        }
      },
      (response) => {
        const status = response.statusCode ?? 0
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > limit) {
            response.destroy(new Error('Microsoft Graph response was too large.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('aborted', () => reject(new Error('Microsoft Graph response was interrupted.')))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body: Record<string, unknown> | null = null
          if (text.trim()) {
            try {
              const parsed: unknown = JSON.parse(text)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                body = parsed as Record<string, unknown>
            } catch {
              if (status >= 200 && status < 300)
                return reject(new Error('Microsoft Graph returned invalid JSON.'))
            }
          }
          if (status >= 200 && status < 300) return resolve({ status, body })
          const error = body?.error as { code?: unknown } | undefined
          const retry = Number(response.headers['retry-after'])
          reject(
            new GraphError(
              `Microsoft Graph returned HTTP ${status}.`,
              status,
              safeCode(error?.code),
              Number.isFinite(retry) && retry >= 0 ? Math.min(retry, 3600) : undefined
            )
          )
        })
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}
