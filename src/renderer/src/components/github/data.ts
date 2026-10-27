export type Row = Record<string, unknown>
export const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
export const label = (value: unknown): string => (typeof value === 'string' ? value : '')
export function friendlyError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || '')
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    .replace(/^Error:\s*/, '')
  if (/401|bad credentials/i.test(message))
    return 'Your GitHub sign-in has expired. Sign in again to reconnect your account.'
  if (/rate limit|429/i.test(message))
    return 'GitHub is receiving too many requests. Wait a few minutes, then try again.'
  if (/403|resource not accessible|permission denied|insufficient scopes|forbidden/i.test(message))
    return 'This account does not have access to that action. Choose another account or review its repository permissions on GitHub.'
  if (/404|not found/i.test(message))
    return 'That repository or item could not be found. Check the name and make sure the selected account has access.'
  if (/fetch failed|failed to fetch|network|\bECONN[A-Z_]*\b/i.test(message))
    return 'Could not reach GitHub. Check your internet connection and try again.'
  return message || 'GitHub could not complete this action. Please try again.'
}
export function unpack(value: unknown): unknown {
  const envelope = object(value)
  const content = Array.isArray(envelope.content) ? envelope.content : []
  const text = content
    .map((part) => label(object(part).text))
    .filter(Boolean)
    .join('\n')
  if (envelope.isError) throw new Error(text || 'GitHub reported an error.')
  if (envelope.structuredContent) return envelope.structuredContent
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}
export function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.map(object)
  const data = object(value)
  for (const key of ['items', 'repositories', 'branches', 'commits', 'pull_requests', 'comments'])
    if (Array.isArray(data[key])) return (data[key] as unknown[]).map(object)
  throw new Error('Unexpected GitHub list response. Refresh the connection and try again.')
}
