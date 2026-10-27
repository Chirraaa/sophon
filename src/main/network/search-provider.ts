import { randomUUID } from 'crypto'
import { searchKey } from '../security/credentials'
import { assertRun, type RunContext } from '../security/run-manager'
import { publicLookup, publicSourceUrl } from './url-policy'
import { requestJson } from './json-request'
import { getSettings } from '../settings'
import { requestPublicText } from './public-page'
import { extractWebHtml } from './html-text'
import { exaSearch } from './exa-search'

export function searchProviderLabel(): string {
  if (getSettings().research.provider === 'exa') return 'Exa (mcp.exa.ai)'
  return getSettings().research.provider === 'duckduckgo'
    ? 'DuckDuckGo (html.duckduckgo.com)'
    : 'Brave Search (api.search.brave.com)'
}

async function duckDuckGoSearch(
  url: URL,
  signal: AbortSignal
): Promise<ReturnType<typeof duckDuckGoResults>> {
  try {
    return duckDuckGoResults((await requestPublicText(url.href, signal)).body)
  } catch (error) {
    if (/HTTP (202|403|429)\b/.test((error as Error).message))
      throw new Error(
        'DuckDuckGo blocked or rate-limited this automated search (possibly a CAPTCHA). Try later or select Exa (no key) or a configured API provider in Settings.',
        { cause: error }
      )
    throw error
  }
}

export function duckDuckGoResults(
  html: string
): { title: string; url: string; description: string }[] {
  const results: { title: string; url: string; description: string }[] = []
  for (const entry of extractWebHtml(html).results) {
    if (results.length >= 5) break
    try {
      const target = new URL(entry.href, 'https://html.duckduckgo.com')
      const url = publicSourceUrl(
        (target.hostname === 'duckduckgo.com' || target.hostname.endsWith('.duckduckgo.com')) &&
          target.pathname === '/l/'
          ? (target.searchParams.get('uddg') ?? '')
          : target.href
      )
      if (!url || results.some((entry) => entry.url === url)) continue
      results.push({ title: entry.title, url, description: entry.description })
    } catch {
      /* Ignore malformed provider links. */
    }
  }
  if (!results.length && !/\bno results\b|\bresult--no-result\b/i.test(html))
    throw new Error(
      'DuckDuckGo did not return readable results. It may require a CAPTCHA or have changed its markup. Try later or select Exa (no key) in Settings.'
    )
  return results
}

export interface WebSource {
  id: string
  taskId: string
  title: string
  url: string
  snippet: string
  fetchedAt: string
  provenance: 'untrusted-web'
}
export async function webSearch(query: string, run: RunContext): Promise<WebSource[]> {
  assertRun(run)
  if (++run.searches > 3) throw new Error('Search is limited to three calls per request.')
  if (!query.trim() || query.length > 500)
    throw new Error('Use a public query up to 500 characters.')
  const duckduckgo = getSettings().research.provider === 'duckduckgo'
  const exa = getSettings().research.provider === 'exa'
  const url = new URL(
    duckduckgo
      ? 'https://html.duckduckgo.com/html/'
      : 'https://api.search.brave.com/res/v1/web/search'
  )
  url.searchParams.set('q', query)
  if (duckduckgo) url.searchParams.set('kp', '1')
  else {
    url.searchParams.set('count', '5')
    url.searchParams.set('safesearch', 'moderate')
  }
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(15000)])
  const lookup = duckduckgo || exa ? undefined : await publicLookup(url.hostname, signal)
  assertRun(run)
  const data = (
    exa
      ? { web: { results: await exaSearch(query, signal) } }
      : duckduckgo
        ? { web: { results: await duckDuckGoSearch(url, signal) } }
        : await requestJson(url, {
            signal,
            lookup,
            headers: { 'X-Subscription-Token': searchKey() }
          })
  ) as {
    web?: { results?: { title?: unknown; url?: unknown; description?: unknown }[] }
  }
  assertRun(run)
  if (!Array.isArray(data?.web?.results)) return []
  const sources = data.web.results.slice(0, 5).flatMap((entry) => {
    const url = typeof entry?.url === 'string' ? publicSourceUrl(entry.url) : null
    if (!url) return []
    return [
      {
        id: randomUUID(),
        taskId: run.id,
        title: String(entry.title ?? '').slice(0, 300),
        url,
        snippet: String(entry.description ?? '').slice(0, 3000),
        fetchedAt: new Date().toISOString(),
        provenance: 'untrusted-web' as const
      }
    ]
  })
  run.sources.push(...sources)
  return sources
}
