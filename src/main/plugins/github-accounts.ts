import { callGithubApi } from './github-api'
import { serverRecord, serverSummaries, setGithubIdentity } from './store'

export async function identifyGithubAccounts(): Promise<void> {
  await Promise.allSettled(
    serverSummaries()
      .filter(
        (server) =>
          server.configuration.url === 'https://api.githubcopilot.com/mcp/' && !server.githubLogin
      )
      .map(async (server) => {
        const saved = serverRecord(server.id, false)
        const identity = (await callGithubApi(
          saved.config,
          'get_me',
          {},
          AbortSignal.timeout(10000)
        )) as { login: string }
        setGithubIdentity(server.id, identity.login, saved.config)
      })
  )
}
