import { protocol } from 'electron'
import { readFile, realpath } from 'fs/promises'
import { join, relative, isAbsolute, extname } from 'path'
import { favicon } from './favicons'

export const APP_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: sophon-app:; font-src 'self'; connect-src 'none'; frame-src sophon-visual:; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'self' blob:; media-src 'self' blob:"
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'sophon-visual', privileges: { standard: true, secure: true } },
    {
      scheme: 'sophon-parser',
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    },
    { scheme: 'sophon-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}
export function registerAppProtocol(
  target: Pick<typeof protocol, 'handle'> = protocol,
  parserOnly = false
): void {
  const handler = async (request: Request, parser: boolean): Promise<Response> => {
    try {
      const url = new URL(request.url)
      if (
        request.method !== 'GET' ||
        url.host !== (parser ? 'parser' : 'app') ||
        url.search ||
        url.username ||
        url.password
      )
        return new Response(null, { status: 403 })
      const path = decodeURIComponent(url.pathname)
      if (!parser && /^\/favicon\/[a-z0-9.-]+$/i.test(path)) {
        return new Response(new Uint8Array(await favicon(path.slice('/favicon/'.length))), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'max-age=86400',
            'X-Content-Type-Options': 'nosniff'
          }
        })
      }
      if (
        path.includes('\\') ||
        path.includes('\0') ||
        !(
          parser ? /^\/(?:parser\.html|assets\/[\w./-]+)$/ : /^\/(?:index\.html|voice-worklet\.js|assets\/[\w./-]+)$/
        ).test(path)
      )
        return new Response(null, { status: 403 })
      const root = await realpath(join(__dirname, '../renderer'))
      const file = await realpath(join(root, path.slice(1)))
      const rel = relative(root, file)
      if (rel.startsWith('..') || isAbsolute(rel)) return new Response(null, { status: 403 })
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.png': 'image/png'
      }
      return new Response(new Uint8Array(await readFile(file)), {
        headers: {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'Content-Security-Policy': parser
            ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
            : APP_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(), geolocation=(), clipboard-read=(), clipboard-write=()'
        }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
  if (!parserOnly) target.handle('sophon-app', (request) => handler(request, false))
  target.handle('sophon-parser', (request) => handler(request, true))
}
