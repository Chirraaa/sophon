import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { LookupFunction } from 'net'
import { eventStream } from './sse'

export function requestJson(
  url: URL,
  options: {
    signal?: AbortSignal
    body?: string
    headers?: Record<string, string>
    lookup?: LookupFunction
    timeout?: number
    maxBytes?: number
    modelErrors?: boolean
    errorDetails?: boolean
    allowEmpty?: boolean
    onEvent?: (data: string) => void
  } = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? 15000)])
      : AbortSignal.timeout(options.timeout ?? 15000)
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: options.body === undefined ? 'GET' : 'POST',
        agent: false,
        signal,
        lookup: options.lookup,
        maxHeaderSize: 32768,
        headers: {
          Accept: options.onEvent ? 'text/event-stream, application/json' : 'application/json',
          'Accept-Encoding': 'identity',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers
        }
      },
      (response) => {
        const fail = (message: string): void => {
          reject(new Error(message))
          response.destroy()
        }
        if (response.statusCode !== 200 && !(options.allowEmpty && response.statusCode === 204)) {
          if (options.errorDetails) {
            let size = 0
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > 8192)
                return fail(
                  `Service returned HTTP ${response.statusCode} (error detail too large).`
                )
              chunks.push(chunk)
            })
            response.on('error', reject)
            response.on('aborted', () => fail('Service error response was interrupted.'))
            response.on('end', () => {
              let code = ''
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
                const candidate = typeof body.error === 'string' ? body.error : body.error?.code
                if (typeof candidate === 'string' && /^[a-z0-9_]{1,100}$/.test(candidate))
                  code = candidate
              } catch {
                /* Never display arbitrary auth response bodies. */
              }
              const error = new Error(
                `Service returned HTTP ${response.statusCode}${code ? ` (${code})` : ''}.`
              ) as Error & { code?: string; statusCode?: number; requestId?: string }
              error.code = code
              error.statusCode = response.statusCode
              const requestId = response.headers['x-request-id']
              if (typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId))
                error.requestId = requestId
              reject(error)
            })
            return
          }
          if (!options.modelErrors || response.statusCode !== 400) {
            const hint =
              response.statusCode === 401 || response.statusCode === 403
                ? ' Check your API key and model access.'
                : response.statusCode === 429
                  ? ' Rate limit or API quota exceeded.'
                  : response.statusCode && response.statusCode >= 300 && response.statusCode < 400
                    ? ' Redirects are blocked.'
                    : ''
            return fail(`Service returned HTTP ${response.statusCode}.${hint}`)
          }

          let bytes = 0
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 8192)
              return fail('Model server returned HTTP 400 (error detail too large).')
            chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            let detail = ''
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              const message = body.error?.message ?? body.error ?? body.message
              if (typeof message === 'string') detail = ': ' + message.slice(0, 700)
            } catch {
              /* Do not display arbitrary HTML or malformed service bodies. */
            }
            reject(new Error(`Model server returned HTTP 400${detail}`))
          })
          return
        }
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        )
          return fail('Compressed responses are not accepted.')
        const streaming =
          options.onEvent &&
          /^text\/event-stream\s*(?:;|$)/i.test(response.headers['content-type'] ?? '')

        let detecting = Boolean(options.onEvent && !response.headers['content-type'])
        if (
          !streaming &&
          !detecting &&
          !(
            options.allowEmpty &&
            (response.statusCode === 204 || !response.headers['content-type'])
          ) &&
          !/^application\/json\s*(?:;|$)/i.test(response.headers['content-type'] ?? '')
        ) {
          const rawType = response.headers['content-type']?.split(';')[0].trim()
          const contentType =
            rawType && /^[a-z0-9!#$&^_.+/-]{1,100}$/i.test(rawType)
              ? rawType
              : 'missing or invalid Content-Type'
          const requestId = response.headers['x-request-id']
          const reference =
            typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId)
              ? ` Request ID: ${requestId}.`
              : ''
          return fail(
            (options.onEvent
              ? `The service returned an unexpected response instead of a model stream (HTTP ${response.statusCode}, ${contentType}). Retry the request; if it persists, check your connection and provider service.`
              : `The service did not return JSON (HTTP ${response.statusCode}, ${contentType}). Check your connection and provider address.`) +
              reference
          )
        }
        let size = 0
        const chunks: Buffer[] = []
        let stream = streaming ? eventStream(options.onEvent!) : undefined
        let failed = false
        response.on('data', (chunk: Buffer) => {
          if (failed) return
          size += chunk.length
          if (size > (options.maxBytes ?? 2 * 1024 * 1024)) {
            failed = true
            return fail('Service response exceeded its byte budget.')
          }
          try {
            if (detecting) {
              chunks.push(chunk)
              const prefix = Buffer.concat(chunks)
                .toString('utf8')
                .replace(/^\uFEFF/, '')
                .replace(/^(?:\r\n|\r|\n)+/, '')
              if (/^\s*[[{]/.test(prefix)) {
                detecting = false
                return
              }
              const newline = prefix.search(/[\r\n]/)
              if (newline >= 0) {
                if (newline > 8192)
                  throw new Error(
                    'The service response without Content-Type could not be identified within 8192 bytes.'
                  )
                const line = prefix.slice(0, newline).replace(/\r$/, '')
                if (!/^(?:data:|event:|id:|retry:|:)/.test(line))
                  throw new Error(
                    'The service returned an unrecognized body without Content-Type. Expected a model stream or JSON.'
                  )
                detecting = false
                stream = eventStream(options.onEvent!)
                for (const buffered of chunks) stream.write(buffered)
                chunks.length = 0
              } else if (size > 8192) {
                throw new Error(
                  'The service response without Content-Type could not be identified within 8192 bytes.'
                )
              }
              return
            }
            if (stream) stream.write(chunk)
            else chunks.push(chunk)
          } catch (error) {
            failed = true
            fail((error as Error).message)
          }
        })
        response.on('error', reject)
        response.on('aborted', () => fail('Service response was interrupted. Please retry.'))
        response.on('end', () => {
          if (failed) return
          try {
            if (size === 0 && options.onEvent)
              throw new Error(
                'The service returned HTTP 200 with an empty body instead of a model stream. Please retry.'
              )
            if (detecting)
              throw new Error(
                'The service returned an incomplete or unrecognized body without Content-Type. Expected a model stream or JSON.'
              )
            if (stream) {
              stream.end()
              resolve(null)
            } else if (options.allowEmpty && size === 0) resolve(null)
            else resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(
              new Error(
                stream || detecting || size === 0
                  ? (error as Error).message
                  : 'Invalid service JSON.'
              )
            )
          }
        })
      }
    )
    request.maxHeadersCount = 100
    request.on('socket', (socket) => {
      const timer = setTimeout(
        () => request.destroy(new Error('Connection deadline exceeded.')),
        5000
      )
      socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () =>
        clearTimeout(timer)
      )
      socket.once('close', () => clearTimeout(timer))
    })
    request.on('error', () =>
      reject(
        new Error(
          signal.aborted
            ? 'Request stopped or timed out.'
            : 'Could not connect to the configured service.'
        )
      )
    )
    request.end(options.body)
  })
}
