import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { requestJson } from '../network/json-request'

export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/common'
export const MICROSOFT_KEYS = `${MICROSOFT_AUTHORITY}/discovery/v2.0/keys`
export const MICROSOFT_GRAPH = 'https://graph.microsoft.com'
/** Permissions Sophon asks for. Calendar access is requested now; mail is added only when used. */
export const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite'
]
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const validClientId = (value: unknown): value is string =>
  typeof value === 'string' && GUID.test(value)

export type MicrosoftAttempt = {
  state: string
  nonce: string
  verifier: string
  redirectUri: string
}
export function microsoftAttempt(redirectUri: string): MicrosoftAttempt {
  const url = new URL(redirectUri)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'localhost' ||
    !/^\d{2,5}$/.test(url.port) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid Microsoft loopback callback.')
  return {
    redirectUri,
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(64).toString('base64url')
  }
}
export function microsoftAuthorizationUrl(
  attempt: MicrosoftAttempt,
  clientId: string,
  options: { loginHint?: string; scopes?: string[] } = {}
): string {
  if (!validClientId(clientId)) throw new Error('Invalid Microsoft application ID.')
  const url = new URL(`${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize`)
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: attempt.redirectUri,
    response_mode: 'query',
    scope: (options.scopes ?? MICROSOFT_SCOPES).join(' '),
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url')
  })
  // Adding an account always shows the chooser so a signed-in browser account is not reused silently.
  if (options.loginHint) params.set('login_hint', options.loginHint.slice(0, 254))
  else params.set('prompt', 'select_account')
  url.search = params.toString()
  return url.href
}
export function validOAuthState(value: string | null, expected: string): boolean {
  if (!value || Buffer.byteLength(value) !== Buffer.byteLength(expected)) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}
export function microsoftCallbackCode(params: URLSearchParams, attempt: MicrosoftAttempt): string {
  if (!validOAuthState(params.get('state'), attempt.state))
    throw new Error('Microsoft sign-in state did not match.')
  for (const name of ['state', 'code', 'error'])
    if (params.getAll(name).length > 1) throw new Error('Ambiguous Microsoft sign-in callback.')
  if (params.has('error'))
    throw new Error(
      params.get('error') === 'access_denied'
        ? 'Microsoft sign-in was declined. Nothing was connected.'
        : 'Microsoft sign-in did not complete. Nothing was connected.'
    )
  const code = params.get('code')
  if (!code || code.length > 4096) throw new Error('Microsoft sign-in did not return a valid code.')
  return code
}

export type MicrosoftIdentity = {
  subject: string
  tenantId: string
  email: string
  name: string
}
/** Verifies the signed ID token. Keys are passed in so callers (and tests) control the fetch. */
export async function verifyMicrosoftIdentity(
  idToken: string,
  clientId: string,
  nonce: string | undefined,
  keys: JSONWebKeySet
): Promise<MicrosoftIdentity> {
  if (!keys || !Array.isArray(keys.keys)) throw new Error('Invalid Microsoft signing keys.')
  try {
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'iat', 'exp', 'tid'],
      clockTolerance: 5
    })
    const tenantId = payload.tid
    const oid = payload.oid ?? payload.sub
    if (
      typeof tenantId !== 'string' ||
      !GUID.test(tenantId) ||
      payload.iss !== `https://login.microsoftonline.com/${tenantId}/v2.0` ||
      typeof oid !== 'string' ||
      !oid ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      typeof payload.iat !== 'number' ||
      payload.iat > Date.now() / 1000 + 5
    )
      throw new Error('Invalid identity claims.')
    const text = (value: unknown, max: number): string =>
      typeof value === 'string' ? value.slice(0, max) : ''
    return {
      subject: oid,
      tenantId,
      email: text(payload.email, 254) || text(payload.preferred_username, 254),
      name: text(payload.name, 200)
    }
  } catch {
    throw new Error('Microsoft identity validation failed. Sign in again.')
  }
}
export async function fetchMicrosoftKeys(signal?: AbortSignal): Promise<JSONWebKeySet> {
  return (await requestJson(new URL(MICROSOFT_KEYS), {
    signal,
    maxBytes: 256 * 1024
  })) as JSONWebKeySet
}
export async function microsoftTokenRequest(
  fields: Record<string, string>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const result = await requestJson(new URL(`${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`), {
    signal,
    body: new URLSearchParams(fields).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxBytes: 128 * 1024,
    errorDetails: true
  })
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Invalid Microsoft token response.')
  return result as Record<string, unknown>
}
/** Graph reports scopes bare or as full resource URLs; compare them in one form. */
export const normalizeScopes = (scope: string): string[] =>
  scope
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => entry.replace(`${MICROSOFT_GRAPH}/`, ''))
