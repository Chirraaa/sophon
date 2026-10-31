import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { lstat, realpath, mkdir } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { readPrivate, writePrivate } from '../security/private-store'
import { validateWorkspaceRoot } from '../security/workspace-policy'
import { anyRunActive } from '../security/run-manager'
import { settingsRecovery } from '../settings'
import { serverRecord } from './store'
import type { GithubCheckout, GithubCheckoutAction } from '../../shared/github-history'

const execute = promisify(execFile)
const key = (context: GithubContext): string =>
  `${context.serverId}:${context.repository.toLowerCase()}`
const location = (): string => join(app.getPath('userData'), 'github-checkouts.json')
let saved: Record<string, GithubCheckout> | undefined
let working = false
function records(): Record<string, GithubCheckout> {
  if (saved) return saved
  try {
    saved = JSON.parse(readPrivate(location()).toString('utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    saved = {}
  }
  return saved!
}
function store(context: GithubContext, checkout: GithubCheckout | null): void {
  const next = { ...records() }
  if (checkout) next[key(context)] = checkout
  else delete next[key(context)]
  writePrivate(location(), Buffer.from(JSON.stringify(next)))
  saved = next
}
function authorize(context: GithubContext): ReturnType<typeof serverRecord> {
  if (anyRunActive()) throw new Error('Finish or stop the current task before updating a checkout.')
  if (settingsRecovery().required) throw new Error('Review recovered settings first.')
  const server = serverRecord(context.serverId)
  if (
    server.config.type !== 'http' ||
    server.config.url !== 'https://api.githubcopilot.com/mcp/' ||
    server.githubLogin?.toLowerCase() !== context.account.toLowerCase()
  )
    throw new Error('Reload the selected GitHub account before using this checkout.')
  return server
}
export function githubCheckoutStatus(context: GithubContext): GithubCheckout | null {
  const server = serverRecord(context.serverId)
  if (settingsRecovery().required) throw new Error('Review recovered settings first.')
  if (
    server.config.type !== 'http' ||
    server.config.url !== 'https://api.githubcopilot.com/mcp/' ||
    server.githubLogin?.toLowerCase() !== context.account.toLowerCase()
  )
    return null
  return records()[key(context)] ?? null
}
export async function githubCheckoutAction(
  context: GithubContext,
  action: Exclude<GithubCheckoutAction, 'status'>,
  chosenPath?: string
): Promise<GithubCheckout | null> {
  if (working) throw new Error('A checkout operation is already running. Wait for it to finish.')
  const server = authorize(context)
  if (action === 'unlink') {
    store(context, null)
    return null
  }
  const stored = records()[key(context)]
  if (action === 'link' && !chosenPath) return stored ?? null
  const folder = chosenPath ?? stored?.path
  if (!folder) throw new Error('Link a local checkout before using Fetch or Pull.')
  working = true
  try {
    const root = await validateWorkspaceRoot(folder)
    if (action !== 'link' && root.toLowerCase() !== folder.toLowerCase())
      throw new Error(
        'The linked checkout folder moved or now points elsewhere. Link the folder again before updating it.'
      )
    const gitDir = await lstat(join(root, '.git')).catch(() => null)
    if (!gitDir?.isDirectory() || gitDir.isSymbolicLink())
      throw new Error(
        'Choose the main checkout folder containing a .git directory. Linked worktrees are not supported here yet.'
      )
    let executable = 'git'
    if (process.platform === 'win32') {
      const found = await execute('where.exe', ['git.exe'], {
        windowsHide: true,
        timeout: 5000
      }).catch(() => {
        throw new Error('Install Git for Windows and restart Sophon.')
      })
      executable =
        found.stdout
          .trim()
          .split(/\r?\n/)
          .find((entry) => isAbsolute(entry)) ?? ''
      if (!executable) throw new Error('Install Git for Windows and restart Sophon.')
    }
    const hooks = join(app.getPath('userData'), 'disabled-git-hooks')
    await mkdir(hooks, { recursive: true })
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^GIT_|^GCM_|^SSH_ASKPASS$/i.test(name))
    ) as NodeJS.ProcessEnv
    Object.assign(env, {
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'
    })
    const options = [
      '-c',
      `core.hooksPath=${hooks}`,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'credential.helper=',
      '-c',
      'credential.interactive=false',
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.https.allow=always',
      '-c',
      'http.followRedirects=false',
      '-c',
      'fetch.recurseSubmodules=false',
      '-c',
      'submodule.recurse=false',
      '-c',
      'maintenance.auto=false',
      '-c',
      'gc.auto=0',
      '-c',
      'merge.autostash=false'
    ]
    // Preserve harmless conversion settings from the user's normal Git config.
    // Dropping core.autocrlf on Windows can make a clean checkout appear dirty.
    const inheritedEnv = { ...env }
    delete inheritedEnv.GIT_CONFIG_GLOBAL
    delete inheritedEnv.GIT_CONFIG_NOSYSTEM
    const inherited = await execute(executable, ['config', '--null', '--list'], {
      cwd: root,
      env: inheritedEnv,
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    })
    for (const entry of inherited.stdout.split('\0')) {
      const split = entry.indexOf('\n')
      const name = entry.slice(0, split).toLowerCase()
      const value = entry.slice(split + 1)
      if (
        (name === 'core.autocrlf' && /^(true|false|input)$/i.test(value)) ||
        (name === 'core.eol' && /^(lf|crlf|native)$/i.test(value)) ||
        (name === 'core.safecrlf' && /^(true|false|warn)$/i.test(value))
      )
        options.push('-c', `${name}=${value}`)
    }
    const headerKeys: string[] = ['http.extraHeader']
    const run = async (args: string[], network = false): Promise<string> => {
      authorize(context)
      if (
        serverRecord(context.serverId).config.headers?.Authorization !==
        server.config.headers?.Authorization
      )
        throw new Error('The GitHub connection changed. Reload it and try again.')
      const requestEnv = { ...env }
      const configEntries = headerKeys.map((name) => [name, ''])
      const authorization = server.config.headers?.Authorization
      const bearer = authorization?.match(/^Bearer\s+(.+)$/i)
      const gitAuthorization = bearer
        ? `Basic ${Buffer.from(`x-access-token:${bearer[1]}`).toString('base64')}`
        : authorization
      if (network && gitAuthorization)
        configEntries.push([
          'http.https://github.com/.extraHeader',
          `Authorization: ${gitAuthorization}`
        ])
      requestEnv.GIT_CONFIG_COUNT = String(configEntries.length)
      configEntries.forEach(([name, value], index) => {
        requestEnv[`GIT_CONFIG_KEY_${index}`] = name
        requestEnv[`GIT_CONFIG_VALUE_${index}`] = value
      })
      try {
        return (
          await execute(executable, [...options, ...args], {
            cwd: root,
            env: requestEnv,
            windowsHide: true,
            timeout: network ? 120000 : 30000,
            maxBuffer: 1024 * 1024
          })
        ).stdout.trim()
      } catch {
        throw new Error(
          network
            ? 'Git could not fetch this branch. Check your connection and GitHub repository access, then retry Fetch.'
            : 'Git could not complete this operation. Check the checkout for conflicts or another running Git command, then retry.'
        )
      }
    }
    // Repo config may define executable filters or URL rewrites. Disable those
    // before any checkout or network operation; credentials stay in the child environment.
    const config = await run(['config', '--null', '--list'])
    const configuredKeys = [...new Set(config.split('\0').map((entry) => entry.split('\n')[0]))]
    if (configuredKeys.some((name) => /^url\..*\.(?:insteadof|pushinsteadof)$/i.test(name)))
      throw new Error(
        'This checkout uses custom Git URL rewrites. Use a checkout with a direct GitHub origin URL for Fetch and Pull.'
      )
    headerKeys.push(
      ...configuredKeys.filter(
        (name) => /^http(?:\..*)?\.extraheader$/i.test(name) && !headerKeys.includes(name)
      )
    )
    if (configuredKeys.some((name) => /^remote\.https?:\/\//i.test(name)))
      throw new Error(
        'This checkout defines a remote with a URL as its name. Use a standard origin remote for Fetch and Pull.'
      )
    const extraKeys = configuredKeys.filter((name) =>
      /^(?:filter\..*\.(?:clean|smudge|process|required)|credential(?:\..*)?\.helper|http(?:\..*)?\.(?:proxy|followredirects|sslverify|sslcainfo|sslcapath))$/i.test(
        name
      )
    )
    for (const name of extraKeys)
      options.push(
        '-c',
        `${name}=${/\.(?:required|followredirects)$/i.test(name) ? 'false' : /\.sslverify$/i.test(name) ? 'true' : ''}`
      )
    options.push('-c', 'core.askPass=')
    options.push('-c', 'http.sslVerify=true')
    await run(['check-ref-format', `refs/heads/${context.branch}`])
    const inspect = async (): Promise<GithubCheckout> => {
      const top = await realpath(await run(['rev-parse', '--show-toplevel']))
      if (top.toLowerCase() !== root.toLowerCase())
        throw new Error('Choose the checkout root folder.')
      const remote = await run(['config', '--get', 'remote.origin.url'])
      const match = remote.match(
        /^(?:https:\/\/github\.com\/|git@github\.com:)([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/i
      )
      if (!match || match[1].toLowerCase() !== context.repository.toLowerCase())
        throw new Error(
          `This checkout must have origin set to ${context.repository}. Choose the matching folder.`
        )
      const branch = await run(['symbolic-ref', '--short', 'HEAD'])
      if (branch !== context.branch)
        throw new Error(
          `This checkout is on ${branch}. Switch it to ${context.branch}, or choose that branch in the card.`
        )
      return { path: root, branch, head: await run(['rev-parse', 'HEAD']) }
    }
    const before = await inspect()
    if (action === 'link') {
      store(context, before)
      return before
    }
    if (action === 'pull' && (await run(['status', '--porcelain=v1', '--untracked-files=normal'])))
      throw new Error('This checkout has local changes. Commit or stash them before pulling.')
    await run(
      [
        'fetch',
        '--no-tags',
        '--no-recurse-submodules',
        '--no-auto-maintenance',
        '--',
        `https://github.com/${context.repository}.git`,
        `+refs/heads/${context.branch}:refs/remotes/origin/${context.branch}`
      ],
      true
    )
    if (action === 'pull') {
      const checked = await inspect()
      if (
        checked.head !== before.head ||
        (await run(['status', '--porcelain=v1', '--untracked-files=normal']))
      )
        throw new Error('The checkout changed while fetching. Review its changes and retry Pull.')
      const [ahead, behind] = (
        await run(['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'])
      )
        .split(/\s+/)
        .map(Number)
      if (ahead > 0 && behind > 0)
        throw new Error(
          'Local and remote history have diverged. Resolve this in your Git client; Pull only accepts a fast-forward.'
        )
      if (behind > 0) await run(['merge', '--ff-only', '--no-edit', 'FETCH_HEAD'])
    }
    const result = await inspect()
    store(context, result)
    return result
  } finally {
    working = false
  }
}
