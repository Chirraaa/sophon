import type { SecureIpc } from '../security/ipc'
import { currentRun } from '../security/run-manager'
import { settingsRecovery } from '../settings'
import { bindPluginAction } from './tools'
import { connected, disconnect, safeResult } from './runtime'
import { serverRecord, setGithubIdentity } from './store'
import { callGithubApi, GithubApiError } from './github-api'
import { createGithubHistoryCache } from './github-history'
import type { GithubHistoryAction, GithubHistorySnapshot } from '../../shared/github-history'

const operations = new Set([
  'get_me',
  'search_repositories',
  'list_branches',
  'list_commits',
  'get_commit',
  'list_pull_requests',
  'pull_request_read',
  'create_branch',
  'push_files',
  'add_issue_comment',
  'create_pull_request'
])

export function registerGithubIpc(
  ipc: SecureIpc,
  publishHistory?: (context: GithubContext, snapshot: GithubHistorySnapshot) => void
): void {
  let busy = false
  const call = async (id: string, tool: string, raw: string): Promise<unknown> => {
    if (busy) throw new Error('A GitHub operation is already in progress.')
    if (currentRun()) throw new Error('Finish or stop the current task before using GitHub.')
    if (settingsRecovery().required) throw new Error('Review recovered settings first.')
    const server = serverRecord(id)
    if (server.config.type !== 'http' || server.config.url !== 'https://api.githubcopilot.com/mcp/')
      throw new Error('Select the official GitHub MCP connection.')
    if (!operations.has(tool)) throw new Error('Unsupported GitHub operation.')
    const binding = bindPluginAction('mcp_call', { server: id, tool, arguments_json: raw })
    busy = true
    try {
      binding.revalidate()
      if (currentRun()) throw new Error('Finish or stop the current task first.')
      const connection = connected(id)
      let result: unknown
      try {
        const data = await callGithubApi(
          server.config,
          tool,
          JSON.parse(raw),
          connection.controller.signal
        )
        if (tool === 'get_me')
          setGithubIdentity(id, (data as { login: string }).login, server.config)
        result = { content: [{ type: 'text', text: JSON.stringify(data) }] }
      } catch (error) {
        if (error instanceof GithubApiError) throw error
        await disconnect(id)
        const writing = [
          'create_branch',
          'push_files',
          'add_issue_comment',
          'create_pull_request'
        ].includes(tool)
        throw new Error(
          writing
            ? 'GitHub did not confirm the result. Reconnect and inspect the repository before retrying; a write may have completed.'
            : 'Could not reach GitHub. Check your connection, reconnect your account and try again.',
          { cause: error }
        )
      }
      const sanitized = safeResult(id, result)
      try {
        return JSON.parse(sanitized)
      } catch {
        throw new Error(
          'GitHub returned too much data. Narrow the request or use a smaller page. A write may have completed.'
        )
      }
    } finally {
      busy = false
    }
  }
  const history = createGithubHistoryCache(
    async (id, tool, raw) => {
      if (busy)
        throw new Error('A GitHub operation is already in progress. Retry Fetch when it finishes.')
      if (currentRun()) throw new Error('Finish or stop the current task before fetching history.')
      const server = serverRecord(id)
      busy = true
      try {
        const data = await callGithubApi(
          server.config,
          tool,
          JSON.parse(raw),
          AbortSignal.timeout(30000)
        )
        return { content: [{ type: 'text', text: JSON.stringify(data) }] }
      } finally {
        busy = false
      }
    },
    (context) => {
      const server = serverRecord(context.serverId)
      if (settingsRecovery().required) throw new Error('Review recovered settings first.')
      if (
        server.config.type !== 'http' ||
        server.config.url !== 'https://api.githubcopilot.com/mcp/' ||
        server.githubLogin?.toLowerCase() !== context.account.toLowerCase()
      )
        throw new Error('Reload the selected GitHub account before opening its history.')
    }
  )
  ipc.handle('github:call', (_event, id: string, tool: string, raw: string) => call(id, tool, raw))
  ipc.handle(
    'github:history',
    async (_event, context: GithubContext, action: GithubHistoryAction) => {
      const snapshot = await history(context, action)
      publishHistory?.(context, snapshot)
      return snapshot
    }
  )
}
