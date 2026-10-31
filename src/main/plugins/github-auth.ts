import { shell } from 'electron'
import { randomUUID } from 'crypto'
import { anyRunActive } from '../security/run-manager'
import { settingsRecovery } from '../settings'
import { addServer, serverSummaries, setGithubIdentity } from './store'
import { callGithubApi } from './github-api'
import type { GithubSignIn } from '../../shared/plugins'

interface Attempt {
  id: string
  clientId: string
  deviceCode: string
  expires: number
  interval: number
  nextPoll: number
  controller: AbortController
}
let attempt: Attempt | undefined
let busy = false
// Public identifier for Sophon's registered OAuth app, safe to ship in desktop builds.
const SOPHON_CLIENT_ID = 'Ov23liUg0YeVU52hF4Mr'
export function githubSignInConfigured(): boolean {
  return /^[A-Za-z0-9_.-]{6,200}$/.test(process.env.SOPHON_GITHUB_CLIENT_ID || SOPHON_CLIENT_ID)
}
function guard(): void {
  if (anyRunActive()) throw new Error('Finish or stop the current task before connecting GitHub.')
  if (settingsRecovery().required) throw new Error('Review recovered settings first.')
}
async function request(
  path: string,
  body: Record<string, string>,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://github.com/login/${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
  })
  if (!response.ok) throw new Error(`GitHub sign-in failed (HTTP ${response.status}). Try again.`)
  const raw = await response.text()
  if (raw.length > 16000) throw new Error('Unexpected GitHub sign-in response.')
  return JSON.parse(raw)
}
export function cancelGithubSignIn(id: string): void {
  if (attempt?.id !== id) return
  attempt.controller.abort()
  attempt = undefined
}
export async function startGithubSignIn(clientId: string): Promise<GithubSignIn> {
  guard()
  if (busy || attempt) throw new Error('A GitHub sign-in is already in progress.')
  const configured = process.env.SOPHON_GITHUB_CLIENT_ID || clientId.trim() || SOPHON_CLIENT_ID
  if (!/^[A-Za-z0-9_.-]{6,200}$/.test(configured))
    throw new Error(
      'Set Sophon’s GitHub OAuth client ID first. Enable device flow in the app registration.'
    )
  busy = true
  const controller = new AbortController()
  try {
    const data = await request(
      'device/code',
      { client_id: configured, scope: 'public_repo' },
      controller.signal
    )
    if (
      typeof data.device_code !== 'string' ||
      !/^[A-Z0-9-]{6,20}$/.test(String(data.user_code)) ||
      data.verification_uri !== 'https://github.com/login/device' ||
      !Number.isFinite(data.expires_in) ||
      !Number.isFinite(data.interval)
    )
      throw new Error('GitHub could not start sign-in. Check the client ID and enable device flow.')
    const interval = Math.max(5, Number(data.interval)) * 1000
    const expires = Date.now() + Math.min(900, Math.max(1, Number(data.expires_in))) * 1000
    const next: Attempt = {
      id: randomUUID(),
      clientId: configured,
      deviceCode: data.device_code,
      expires,
      interval,
      nextPoll: Date.now() + interval,
      controller
    }
    attempt = next
    try {
      await shell.openExternal('https://github.com/login/device')
    } catch {
      cancelGithubSignIn(next.id)
      throw new Error('Could not open your browser. Try signing in again.')
    }
    return {
      id: next.id,
      userCode: String(data.user_code),
      expiresAt: expires,
      pollAfterMs: interval
    }
  } finally {
    busy = false
  }
}
export async function pollGithubSignIn(
  id: string
): Promise<{ serverId?: string; pollAfterMs?: number }> {
  guard()
  const current = attempt
  if (!current || current.id !== id) throw new Error('GitHub sign-in was cancelled. Start again.')
  if (Date.now() >= current.expires) {
    cancelGithubSignIn(id)
    throw new Error('GitHub sign-in expired. Start again for a new code.')
  }
  if (busy || Date.now() < current.nextPoll)
    return { pollAfterMs: Math.max(1000, current.nextPoll - Date.now()) }
  busy = true
  current.nextPoll = Date.now() + current.interval
  try {
    const data = await request(
      'oauth/access_token',
      {
        client_id: current.clientId,
        device_code: current.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      },
      current.controller.signal
    )
    if (attempt !== current) throw new Error('GitHub sign-in was cancelled.')
    if (data.error === 'authorization_pending') return { pollAfterMs: current.interval }
    if (data.error === 'slow_down') {
      current.interval += 5000
      current.nextPoll = Date.now() + current.interval
      return { pollAfterMs: current.interval }
    }
    if (
      data.error ||
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      data.token_type !== 'bearer'
    )
      throw new Error(
        data.error === 'access_denied'
          ? 'GitHub sign-in was declined.'
          : 'GitHub sign-in failed or expired. Start again.'
      )
    const scopes = typeof data.scope === 'string' ? data.scope.split(/[ ,]+/).filter(Boolean) : []
    if (!scopes.includes('public_repo') || scopes.some((scope) => scope !== 'public_repo'))
      throw new Error(
        'GitHub returned permissions beyond public repositories or could not confirm them. Revoke Sophon in GitHub Settings → Applications → Authorized OAuth Apps, then sign in again. This token was not saved.'
      )
    const config = {
      type: 'http' as const,
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: `Bearer ${data.access_token}` }
    }
    const identity = (await callGithubApi(config, 'get_me', {}, current.controller.signal)) as {
      login: string
    }
    if (attempt !== current) throw new Error('GitHub sign-in was cancelled.')
    guard()
    const previous = new Set(serverSummaries().map((server) => server.id))
    addServer('GitHub · public repositories', {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: `Bearer ${data.access_token}` }
    })
    const serverId = serverSummaries().find((server) => !previous.has(server.id))!.id
    setGithubIdentity(serverId, identity.login, config)
    cancelGithubSignIn(id)
    return { serverId }
  } catch (error) {
    cancelGithubSignIn(id)
    throw error
  } finally {
    busy = false
  }
}
