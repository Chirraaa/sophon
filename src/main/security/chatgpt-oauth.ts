import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { requestJson } from '../network/json-request'

export const CHATGPT_API = 'https://api.openai.com/v1'
export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const CHATGPT_USAGE = 'https://chatgpt.com/#settings/Usage'
export type OAuthAttempt = {
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  clientId?: string
}
export function oauthAttempt(redirectUri: string, clientId?: string): OAuthAttempt {
  const url = new URL(redirectUri)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/auth/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid ChatGPT loopback callback.')
  return {
    redirectUri,
    clientId,
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(64).toString('base64url')
  }
}
export function authorizationUrl(attempt: OAuthAttempt, hostId: string): string {
  const url = new URL(`${CHATGPT_ISSUER}/api/accounts/authorize`)
  url.search = new URLSearchParams({
    client_id: attempt.clientId ?? 'dynamic_agent_client',
    ...(!attempt.clientId ? { agent_name_hint: 'Sophon' } : {}),
    ext_agent_host_id: hostId,
    redirect_uri: attempt.redirectUri,
    response_type: 'code',
    scope: CHATGPT_SCOPES,
    resource: CHATGPT_API,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url')
  }).toString()
  return url.href
}
export function validOAuthState(value: string | null, expected: string): boolean {
  if (!value || Buffer.byteLength(value) !== Buffer.byteLength(expected)) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}
export function callbackCode(
  params: URLSearchParams,
  attempt: OAuthAttempt
): { code: string; clientId: string } {
  if (!validOAuthState(params.get('state'), attempt.state))
    throw new Error('ChatGPT sign-in state did not match.')
  for (const name of ['state', 'code', 'client_id', 'error'])
    if (params.getAll(name).length > 1) throw new Error('Ambiguous ChatGPT sign-in callback.')
  if (params.has('error'))
    throw new Error('ChatGPT sign-in was declined. No plan requests were made.')
  const clientId = params.get('client_id') ?? attempt.clientId
  if (
    !clientId ||
    clientId === 'dynamic_agent_client' ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) ||
    (attempt.clientId && clientId !== attempt.clientId)
  )
    throw new Error('ChatGPT registration did not return the expected client ID.')
  const code = params.get('code')
  if (!code || code.length > 4096) throw new Error('ChatGPT sign-in did not return a valid code.')
  return { clientId, code }
}
export async function verifyChatgptIdentity(
  idToken: string,
  clientId: string,
  nonce: string | undefined,
  signal?: AbortSignal
): Promise<{ subject: string; email: string }> {
  const keys = (await requestJson(new URL(`${CHATGPT_ISSUER}/.well-known/jwks.json`), {
    signal,
    maxBytes: 128 * 1024
  })) as JSONWebKeySet
  if (!keys || !Array.isArray(keys.keys)) throw new Error('Invalid OpenAI signing keys.')
  try {
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
      issuer: CHATGPT_ISSUER,
      audience: clientId,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'iat', 'exp'],
      clockTolerance: 5
    })
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      typeof payload.iat !== 'number' ||
      payload.iat > Date.now() / 1000 + 5
    )
      throw new Error('Invalid identity claims.')
    return {
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.slice(0, 254) : ''
    }
  } catch {
    throw new Error('ChatGPT identity validation failed. Sign in again.')
  }
}

export async function tokenRequest(
  fields: Record<string, string>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const result = await requestJson(new URL(`${CHATGPT_ISSUER}/api/accounts/oauth/token`), {
    signal,
    body: new URLSearchParams(fields).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxBytes: 128 * 1024,
    errorDetails: true
  })
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Invalid ChatGPT token response.')
  return result as Record<string, unknown>
}
