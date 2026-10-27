export type GithubHistoryAction = 'get' | 'fetch' | 'older'
export interface GithubHistorySnapshot {
  commits: Record<string, unknown>[]
  heads: Record<string, unknown>[]
  page: number
  more: boolean
  fetchedAt: number
}
export interface GithubCheckout {
  path: string
  branch: string
  head: string
}
export type GithubCheckoutAction = 'status' | 'link' | 'fetch' | 'pull' | 'unlink'
export const githubHistoryKey = (context: GithubContext): string =>
  `${context.serverId}:${context.repository.toLowerCase()}:${context.branch}`
