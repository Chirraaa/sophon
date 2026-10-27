import { app, safeStorage, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createServer } from 'http'
import { requestJson } from '../network/json-request'
import { revokePolicy } from './run-manager'
import {
  CHATGPT_API,
  CHATGPT_ISSUER,
  CHATGPT_USAGE,
  oauthAttempt,
  authorizationUrl,
  callbackCode,
  validOAuthState,
  verifyChatgptIdentity,
  tokenRequest
} from './chatgpt-oauth'

type Account = {
  id: string
  subject: string
  email: string
  label: string
  clientId: string
  accessToken?: string
  refreshToken?: string
  idToken?: string
  expiresAt?: number
  scopes?: string[]
}
type Store = {
  hostId: string
  activeId?: string
  pendingClientId?: string
  welcomed: boolean
  accounts: Account[]
}
const file = (): string => join(app.getPath('userData'), 'chatgpt-auth.enc')
let pending: AbortController | undefined
let revision = 0
let refresh: { id: string; work: Promise<string> } | undefined
let signingOut = false

function readStore(): Store {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable.')
  try {
    if (statSync(file()).size > 1024 * 1024) throw new Error('Credential file too large.')
    const data = JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Store
    if (
      !/^urn:uuid:[0-9a-f-]{36}$/.test(data.hostId) ||
      !Array.isArray(data.accounts) ||
      data.accounts.length > 30 ||
      data.accounts.some(
        (a) =>
          !a ||
          typeof a.id !== 'string' ||
          typeof a.clientId !== 'string' ||
          typeof a.subject !== 'string' ||
          typeof a.email !== 'string' ||
          typeof a.label !== 'string'
      )
    )
      throw new Error('Invalid credential record.')
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { hostId: `urn:uuid:${randomUUID()}`, welcomed: false, accounts: [] }
    // eslint-disable-next-line preserve-caught-error -- Credential parse errors can contain token data.
    throw new Error(
      'Could not read Sophon’s ChatGPT credentials. The existing file has not been replaced.'
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
function publicStatus(store: Store): ChatgptStatus {
  const active = store.accounts.find((a) => a.id === store.activeId)
  return {
    activeId: store.activeId,
    pending: Boolean(pending),
    welcome: Boolean(
      active?.accessToken && active.scopes?.includes('chatgpt.tokens.use.direct') && !store.welcomed
    ),
    accounts: store.accounts.map((a) => ({
      id: a.id,
      email: a.email,
      label: a.label,
      signedIn: Boolean(a.accessToken),
      planEnabled: Boolean(a.accessToken && a.scopes?.includes('chatgpt.tokens.use.direct'))
    }))
  }
}
export function chatgptStatus(): ChatgptStatus {
  return publicStatus(readStore())
}
export function chatgptAccountScope(): string | undefined {
  return readStore().activeId
}
export function cancelChatgptSignIn(): void {
  pending?.abort()
  pending = undefined
}
export function acknowledgeChatgptWelcome(): void {
  const store = readStore()
  store.welcomed = true
  writeStore(store)
}
export function selectChatgptAccount(id: string): ChatgptStatus {
  if (signingOut) throw new Error('Wait for ChatGPT sign-out to finish.')
  const store = readStore()
  if (!store.accounts.some((a) => a.id === id)) throw new Error('Unknown ChatGPT connection.')
  cancelChatgptSignIn()
  revision++
  revokePolicy()
  store.activeId = id
  writeStore(store)
  return publicStatus(store)
}

function tokens(
  result: Record<string, unknown>,
  previous?: Account
): Pick<Account, 'accessToken' | 'refreshToken' | 'idToken' | 'expiresAt' | 'scopes'> {
  const token = (value: unknown): value is string =>
    typeof value === 'string' && /^[\x21-\x7e]{1,65536}$/.test(value)
  if (
    !token(result.access_token) ||
    !token(result.refresh_token) ||
    result.token_type !== 'Bearer' ||
    typeof result.expires_in !== 'number' ||
    !Number.isFinite(result.expires_in) ||
    result.expires_in <= 0 ||
    result.expires_in > 86400 ||
    (!previous && !token(result.id_token))
  )
    throw new Error('ChatGPT returned incomplete credentials.')
  if (result.id_token !== undefined && !token(result.id_token))
    throw new Error('Invalid ChatGPT identity token.')
  const scopes =
    typeof result.scope === 'string' ? result.scope.split(/\s+/).filter(Boolean) : previous?.scopes
  if (!scopes || scopes.length > 100) throw new Error('ChatGPT did not return granted scopes.')
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    idToken: (result.id_token as string | undefined) ?? previous?.idToken,
    expiresAt: Date.now() + result.expires_in * 1000,
    scopes
  }
}

export async function signInChatgpt(accountId?: string): Promise<ChatgptStatus> {
  if (pending || signingOut) throw new Error('A ChatGPT account operation is already in progress.')
  const store = readStore()
  const previous = accountId ? store.accounts.find((a) => a.id === accountId) : undefined
  if (accountId && !previous) throw new Error('Unknown ChatGPT connection.')
  if (!previous && store.accounts.length >= 30)
    throw new Error('Too many saved ChatGPT connections.')

  writeStore(store)
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
      throw new Error('Could not start ChatGPT sign-in listener.')
    const attempt = oauthAttempt(
      `http://127.0.0.1:${address.port}/auth/callback`,
      previous?.clientId ?? store.pendingClientId
    )
    const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
      let consumed = false
      const abort = (): void => reject(new Error('ChatGPT sign-in cancelled or timed out.'))
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
        if (
          signal.aborted ||
          consumed ||
          request.method !== 'GET' ||
          request.headers.host !== `127.0.0.1:${address.port}` ||
          !request.url ||
          request.url.length > 8192
        ) {
          response.writeHead(400)
          response.end('Invalid sign-in callback.')
          return
        }
        let url: URL
        try {
          url = new URL(request.url, attempt.redirectUri)
        } catch {
          response.writeHead(400)
          response.end('Invalid sign-in callback.')
          return
        }
        if (
          url.origin !== new URL(attempt.redirectUri).origin ||
          url.pathname !== '/auth/callback' ||
          !validOAuthState(url.searchParams.get('state'), attempt.state)
        ) {
          response.writeHead(400)
          response.end('Invalid sign-in callback.')
          return
        }
        consumed = true
        try {
          const code = callbackCode(url.searchParams, attempt)
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
    const url = new URL(authorizationUrl(attempt, store.hostId))
    if (previous?.accessToken && !previous.scopes?.includes('chatgpt.tokens.use.direct'))
      url.searchParams.set('prompt', 'consent')
    await shell.openExternal(url.href)
    const { code, clientId } = await callback
    stopListening?.()
    if (!previous) {
      const latest = readStore()
      latest.pendingClientId = clientId
      writeStore(latest)
    }
    const result = await tokenRequest(
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        resource: CHATGPT_API
      },
      signal
    )
    const credentials = tokens(result)
    const identity = await verifyChatgptIdentity(
      credentials.idToken!,
      clientId,
      attempt.nonce,
      signal
    )
    if (previous && identity.subject !== previous.subject)
      throw new Error('ChatGPT signed in a different account. Use Add account instead.')
    signal.throwIfAborted()
    if (atRevision !== revision) throw new Error('The ChatGPT connection changed during sign-in.')
    const account: Account = {
      id: previous?.id ?? randomUUID(),
      clientId,
      subject: identity.subject,
      email: identity.email,
      label: previous?.label ?? `Connection ${store.accounts.length + 1}`,
      ...credentials
    }
    const latest = readStore()
    latest.accounts = [...latest.accounts.filter((a) => a.id !== account.id), account]
    latest.activeId = account.id
    delete latest.pendingClientId
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

export async function chatgptAccessToken(): Promise<string> {
  if (signingOut) throw new Error('ChatGPT sign-out is in progress.')
  const store = readStore()
  const account = store.accounts.find((a) => a.id === store.activeId)
  if (!account?.accessToken)
    throw new Error('Continue with ChatGPT in Settings > Model to connect your subscription.')
  if (!account.scopes?.includes('chatgpt.tokens.use.direct'))
    throw new Error('ChatGPT plan usage is not enabled. Authorize it in Settings > Model.')
  if ((account.expiresAt ?? 0) > Date.now() + 60000) return account.accessToken
  if (refresh) {
    if (refresh.id !== account.id)
      throw new Error('Wait for the previous ChatGPT account refresh to finish.')
    return refresh.work
  }
  const atRevision = revision
  const work = (async (): Promise<string> => {
    if (!account.refreshToken) throw new Error('ChatGPT access expired. Sign in again.')
    const result = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: account.clientId,
      refresh_token: account.refreshToken,
      resource: CHATGPT_API
    }).catch((error) => {
      if (atRevision === revision && (error as { code?: string }).code === 'invalid_grant') {
        delete account.accessToken
        delete account.refreshToken
        delete account.idToken
        delete account.expiresAt
        revision++
        revokePolicy()
        writeStore(store)
        throw new Error(
          'Your ChatGPT sign-in expired or was revoked. Continue with ChatGPT in Settings > Model to reconnect.'
        )
      }
      throw error
    })
    const credentials = tokens(result, account)
    if (result.id_token) {
      const identity = await verifyChatgptIdentity(
        credentials.idToken!,
        account.clientId,
        undefined
      )
      if (identity.subject !== account.subject)
        throw new Error('ChatGPT refresh changed account identity. Sign in again.')
    }
    const latest = readStore()
    const current = latest.accounts.find((entry) => entry.id === account.id)
    if (!current || current.refreshToken !== account.refreshToken)
      throw new Error('The ChatGPT session changed while renewing access.')
    Object.assign(current, credentials)
    writeStore(latest)
    if (atRevision !== revision)
      throw new Error('The ChatGPT account changed while renewing access.')
    if (!current.scopes?.includes('chatgpt.tokens.use.direct'))
      throw new Error('ChatGPT plan usage permission was removed. Sign in again.')
    return current.accessToken!
  })()
  refresh = { id: account.id, work }
  try {
    return await work
  } finally {
    if (refresh?.work === work) refresh = undefined
  }
}

export async function signOutChatgpt(): Promise<{ status: ChatgptStatus; revoked: boolean }> {
  if (signingOut) throw new Error('ChatGPT sign-out is already in progress.')
  signingOut = true
  cancelChatgptSignIn()
  revokePolicy()

  try {
    await refresh?.work
  } catch {
    /* Sign-out still clears the local session. */
  }
  revision++
  try {
    const store = readStore()
    const account = store.accounts.find((a) => a.id === store.activeId)
    let revoked = !account?.refreshToken
    if (account?.refreshToken) {
      for (let attempt = 0; attempt < 2; attempt++)
        try {
          const discovery = (await requestJson(
            new URL(`${CHATGPT_ISSUER}/.well-known/openid-configuration`),
            { errorDetails: true }
          )) as Record<string, unknown>
          const endpoint = new URL(String(discovery.revocation_endpoint))
          if (
            discovery.issuer !== CHATGPT_ISSUER ||
            endpoint.origin !== CHATGPT_ISSUER ||
            endpoint.username ||
            endpoint.password ||
            endpoint.hash ||
            endpoint.search
          )
            throw new Error('Invalid revocation endpoint.')
          await requestJson(endpoint, {
            body: new URLSearchParams({
              token: account.refreshToken,
              token_type_hint: 'refresh_token',
              client_id: account.clientId
            }).toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            allowEmpty: true,
            errorDetails: true
          })
          revoked = true
          break
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          if (attempt === 0 && (status === undefined || status >= 500))
            await new Promise((resolve) => setTimeout(resolve, 250))
          else break
        }
    }
    if (account) {
      delete account.accessToken
      delete account.refreshToken
      delete account.idToken
      delete account.expiresAt
    }
    delete store.activeId
    writeStore(store)
    return { status: publicStatus(store), revoked }
  } finally {
    signingOut = false
  }
}
export async function openChatgptUsage(): Promise<void> {
  await shell.openExternal(CHATGPT_USAGE)
}
