import { app, safeStorage, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createServer } from 'http'
import { revokePolicy } from './run-manager'
import {
  MICROSOFT_SCOPES,
  fetchMicrosoftKeys,
  microsoftAttempt,
  microsoftAuthorizationUrl,
  microsoftCallbackCode,
  microsoftTokenRequest,
  normalizeScopes,
  validClientId,
  validOAuthState,
  verifyMicrosoftIdentity
} from './microsoft-oauth'

const MAX_ACCOUNTS = 10
type Account = {
  id: string
  subject: string
  tenantId: string
  email: string
  name: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scopes: string[]
}
type Store = { clientId: string; activeId?: string; accounts: Account[] }

const file = (): string => join(app.getPath('userData'), 'microsoft-auth.enc')
let pending: AbortController | undefined
let revision = 0
const refreshing = new Map<string, Promise<string>>()

function readStore(): Store {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  try {
    if (statSync(file()).size > 1024 * 1024) throw new Error('Credential file too large.')
    const data = JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Store
    if (
      typeof data.clientId !== 'string' ||
      !Array.isArray(data.accounts) ||
      data.accounts.length > MAX_ACCOUNTS ||
      data.accounts.some(
        (a) =>
          !a ||
          typeof a.id !== 'string' ||
          typeof a.subject !== 'string' ||
          typeof a.tenantId !== 'string' ||
          typeof a.email !== 'string' ||
          typeof a.name !== 'string' ||
          !Array.isArray(a.scopes)
      )
    )
      throw new Error('Invalid credential record.')
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { clientId: '', accounts: [] }
    // eslint-disable-next-line preserve-caught-error -- Credential parse errors can contain token data.
    throw new Error(
      'Could not read Sophon’s Microsoft credentials. The existing file has not been replaced.'
    )
  }
}
function writeStore(store: Store): void {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file() + '.tmp', safeStorage.encryptString(JSON.stringify(store)), { mode: 0o600 })
  renameSync(file() + '.tmp', file())
}
function publicStatus(store: Store): MicrosoftStatus {
  return {
    clientId: store.clientId,
    pending: Boolean(pending),
    activeId: store.accounts.some((a) => a.id === store.activeId) ? store.activeId : undefined,
    accounts: store.accounts.map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      signedIn: Boolean(a.refreshToken),
      calendar: a.scopes.includes('Calendars.ReadWrite')
    }))
  }
}
export const microsoftStatus = (): MicrosoftStatus => publicStatus(readStore())

export function setMicrosoftClientId(value: string): MicrosoftStatus {
  const clientId = value.trim()
  if (clientId && !validClientId(clientId))
    throw new Error(
      'Enter the Application (client) ID from your Azure app registration. It looks like 00000000-0000-0000-0000-000000000000.'
    )
  const store = readStore()
  if (clientId !== store.clientId && store.accounts.length)
    throw new Error(
      'Remove the connected Microsoft accounts before changing the application ID. Their sign-ins belong to the current registration.'
    )
  store.clientId = clientId
  writeStore(store)
  return publicStatus(store)
}
export function cancelMicrosoftSignIn(): void {
  pending?.abort()
  pending = undefined
}
export function selectMicrosoftAccount(id: string): MicrosoftStatus {
  const store = readStore()
  if (!store.accounts.some((a) => a.id === id)) throw new Error('Unknown Microsoft account.')
  cancelMicrosoftSignIn()
  revision++
  revokePolicy()
  store.activeId = id
  writeStore(store)
  return publicStatus(store)
}
/** Forgets an account on this computer. Microsoft has no token revocation for public clients. */
export function removeMicrosoftAccount(id: string): MicrosoftStatus {
  const store = readStore()
  if (!store.accounts.some((a) => a.id === id)) throw new Error('Unknown Microsoft account.')
  cancelMicrosoftSignIn()
  revision++
  revokePolicy()
  store.accounts = store.accounts.filter((a) => a.id !== id)
  // With several accounts left the user chooses; a single remaining account is unambiguous.
  if (store.accounts.length === 1) store.activeId = store.accounts[0].id
  else if (store.activeId === id) store.activeId = undefined
  writeStore(store)
  return publicStatus(store)
}

function tokens(
  result: Record<string, unknown>,
  previous?: Account
): Pick<Account, 'accessToken' | 'refreshToken' | 'expiresAt' | 'scopes'> {
  const token = (value: unknown): value is string =>
    typeof value === 'string' && /^[\x21-\x7e]{1,65536}$/.test(value)
  if (
    !token(result.access_token) ||
    String(result.token_type).toLowerCase() !== 'bearer' ||
    typeof result.expires_in !== 'number' ||
    !Number.isFinite(result.expires_in) ||
    result.expires_in <= 0 ||
    result.expires_in > 86400 ||
    (result.refresh_token !== undefined && !token(result.refresh_token)) ||
    (!result.refresh_token && !previous?.refreshToken)
  )
    throw new Error('Microsoft returned incomplete credentials.')
  const scopes = typeof result.scope === 'string' ? normalizeScopes(result.scope) : previous?.scopes
  if (!scopes || scopes.length > 100)
    throw new Error('Microsoft did not return granted permissions.')
  return {
    accessToken: result.access_token,
    refreshToken: (result.refresh_token as string | undefined) ?? previous?.refreshToken,
    expiresAt: Date.now() + result.expires_in * 1000,
    scopes
  }
}

/** Starts a browser sign-in. Without an account ID it adds an account; with one it reconnects it. */
export async function signInMicrosoft(accountId?: string): Promise<MicrosoftStatus> {
  if (pending) throw new Error('A Microsoft sign-in is already in progress.')
  const store = readStore()
  if (!validClientId(store.clientId))
    throw new Error('Enter your Azure application (client) ID first.')
  const previous = accountId ? store.accounts.find((a) => a.id === accountId) : undefined
  if (accountId && !previous) throw new Error('Unknown Microsoft account.')
  if (!previous && store.accounts.length >= MAX_ACCOUNTS)
    throw new Error('Too many saved Microsoft accounts. Remove one first.')

  const clientId = store.clientId
  const controller = new AbortController()
  pending = controller
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60 * 1000)])
  const atRevision = revision
  const server = createServer({ maxHeaderSize: 8192 })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.maxRequestsPerSocket = 1
  let stopListening: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Could not start Microsoft sign-in listener.')
    const attempt = microsoftAttempt(`http://localhost:${address.port}/`)
    const hosts = [`localhost:${address.port}`, `127.0.0.1:${address.port}`]
    const callback = new Promise<string>((resolve, reject) => {
      let consumed = false
      const abort = (): void => reject(new Error('Microsoft sign-in cancelled or timed out.'))
      signal.addEventListener('abort', abort, { once: true })
      server.once('error', reject)
      stopListening = () => {
        signal.removeEventListener('abort', abort)
        server.close()
        server.closeAllConnections()
      }
      server.on('request', (request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Referrer-Policy', 'no-referrer')
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        const reject400 = (): void => {
          response.writeHead(400)
          response.end('Invalid sign-in callback.')
        }
        if (
          signal.aborted ||
          consumed ||
          request.method !== 'GET' ||
          !hosts.includes(String(request.headers.host)) ||
          !request.url ||
          request.url.length > 8192
        )
          return reject400()
        let url: URL
        try {
          url = new URL(request.url, attempt.redirectUri)
        } catch {
          return reject400()
        }
        if (url.pathname !== '/' || !validOAuthState(url.searchParams.get('state'), attempt.state))
          return reject400()
        consumed = true
        try {
          const code = microsoftCallbackCode(url.searchParams, attempt)
          response.end('Sign-in received. Return to Sophon to finish connecting.')
          resolve(code)
        } catch (error) {
          response.writeHead(400)
          response.end('Sign-in was not completed. Return to Sophon.')
          reject(error)
        }
      })
      if (signal.aborted) abort()
    })

    void callback.catch(() => {})
    signal.throwIfAborted()
    await shell.openExternal(
      microsoftAuthorizationUrl(attempt, clientId, { loginHint: previous?.email || undefined })
    )
    const code = await callback
    stopListening?.()
    const result = await microsoftTokenRequest(
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        scope: MICROSOFT_SCOPES.join(' ')
      },
      signal
    )
    const credentials = tokens(result)
    if (typeof result.id_token !== 'string')
      throw new Error('Microsoft did not return an identity token.')
    const identity = await verifyMicrosoftIdentity(
      result.id_token,
      clientId,
      attempt.nonce,
      await fetchMicrosoftKeys(signal)
    )
    if (
      previous &&
      (identity.subject !== previous.subject || identity.tenantId !== previous.tenantId)
    )
      throw new Error('Microsoft signed in a different account. Use Add account instead.')
    signal.throwIfAborted()
    if (atRevision !== revision) throw new Error('The Microsoft accounts changed during sign-in.')
    const latest = readStore()
    const existing =
      latest.accounts.find((a) => a.id === previous?.id) ??
      latest.accounts.find(
        (a) => a.subject === identity.subject && a.tenantId === identity.tenantId
      )
    const account: Account = {
      id: existing?.id ?? randomUUID(),
      subject: identity.subject,
      tenantId: identity.tenantId,
      email: identity.email,
      name: identity.name,
      ...credentials
    }
    latest.accounts = [...latest.accounts.filter((a) => a.id !== account.id), account]
    latest.activeId = account.id
    revision++
    revokePolicy()
    writeStore(latest)
    return { ...publicStatus(latest), pending: false }
  } finally {
    controller.abort()
    stopListening?.()
    server.close()
    server.closeAllConnections()
    if (pending === controller) pending = undefined
  }
}

/**
 * The account a tool should use. An email must match a connected account exactly; otherwise the
 * active account is used, or the only signed-in one. Never guesses between several.
 */
export function microsoftAccountFor(selector?: string): { id: string; email: string } {
  const store = readStore()
  const usable = store.accounts.filter((a) => a.refreshToken)
  const wanted = selector?.trim().toLowerCase()
  const matches = wanted ? store.accounts.filter((a) => a.email.toLowerCase() === wanted) : []
  if (matches.length > 1)
    throw new Error(
      `More than one connected account uses ${selector}. Choose it as the active account in Settings > Plugins.`
    )
  const account = wanted
    ? matches[0]
    : (store.accounts.find((a) => a.id === store.activeId && a.refreshToken) ??
      (usable.length === 1 ? usable[0] : undefined))
  if (!account) {
    const known = store.accounts.map((a) => a.email).filter(Boolean)
    throw new Error(
      wanted
        ? `No connected Microsoft account matches ${selector}. Connected: ${known.join(', ') || 'none'}.`
        : usable.length > 1
          ? `Several Microsoft accounts are connected (${usable.map((a) => a.email).join(', ')}). Ask which one to use, or choose an active account in Settings > Plugins.`
          : 'No Microsoft account is connected. Connect one in Settings > Plugins.'
    )
  }
  if (!account.refreshToken)
    throw new Error(`${account.email} is signed out. Reconnect it in Settings > Plugins.`)
  return { id: account.id, email: account.email }
}

/** A valid access token for an account (default: the active one), renewed when it is close to expiry. */
export async function microsoftAccessToken(
  accountId?: string,
  requiredScope?: string
): Promise<string> {
  const store = readStore()
  const account = store.accounts.find((a) => a.id === (accountId ?? store.activeId))
  if (!account) throw new Error('Choose a Microsoft account in Settings > Plugins first.')
  if (!account.refreshToken)
    throw new Error(`Sign in again to ${account.email || 'this Microsoft account'} in Settings.`)
  if (requiredScope && !account.scopes.includes(requiredScope))
    throw new Error(
      `${account.email || 'This Microsoft account'} has not granted ${requiredScope}. Reconnect it in Settings.`
    )
  if (account.accessToken && (account.expiresAt ?? 0) > Date.now() + 60000)
    return account.accessToken
  const inFlight = refreshing.get(account.id)
  if (inFlight) return inFlight
  const atRevision = revision
  const work = (async (): Promise<string> => {
    const result = await microsoftTokenRequest({
      grant_type: 'refresh_token',
      client_id: store.clientId,
      refresh_token: account.refreshToken!,
      scope: MICROSOFT_SCOPES.join(' ')
    }).catch((error) => {
      if (atRevision === revision && (error as { code?: string }).code === 'invalid_grant') {
        const latest = readStore()
        const current = latest.accounts.find((a) => a.id === account.id)
        if (current) {
          delete current.accessToken
          delete current.refreshToken
          delete current.expiresAt
          revision++
          revokePolicy()
          writeStore(latest)
        }
        throw new Error(
          `Your Microsoft sign-in for ${account.email || 'this account'} expired or was revoked. Reconnect it in Settings.`
        )
      }
      throw error
    })
    const credentials = tokens(result, account)
    const latest = readStore()
    const current = latest.accounts.find((a) => a.id === account.id)
    if (!current || current.refreshToken !== account.refreshToken)
      throw new Error('The Microsoft account changed while renewing access.')
    Object.assign(current, credentials)
    writeStore(latest)
    if (atRevision !== revision)
      throw new Error('The Microsoft accounts changed while renewing access.')
    return credentials.accessToken!
  })()
  refreshing.set(account.id, work)
  try {
    return await work
  } finally {
    if (refreshing.get(account.id) === work) refreshing.delete(account.id)
  }
}
