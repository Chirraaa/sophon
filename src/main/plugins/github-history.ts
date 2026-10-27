import type { GithubHistoryAction, GithubHistorySnapshot } from '../../shared/github-history'
import { githubHistoryKey } from '../../shared/github-history'

type Call = (id: string, tool: string, raw: string) => Promise<unknown>
function rows(value: unknown): Record<string, unknown>[] {
  const result = value as { content?: { text?: string }[] }
  const data = JSON.parse(result.content?.map((item) => item.text ?? '').join('\n') ?? '')
  if (!Array.isArray(data)) throw new Error('Could not read branch history. Fetch again to retry.')
  return data
}
export function createGithubHistoryCache(
  call: Call,
  authorize: (context: GithubContext) => void
): (context: GithubContext, action: GithubHistoryAction) => Promise<GithubHistorySnapshot> {
  const cache = new Map<string, GithubHistorySnapshot>()
  const pending = new Map<string, Promise<GithubHistorySnapshot>>()
  return async (
    context: GithubContext,
    action: GithubHistoryAction
  ): Promise<GithubHistorySnapshot> => {
    authorize(context)
    const key = githubHistoryKey(context)
    const previous = cache.get(key)
    if (action === 'get' && previous) return previous
    if (action === 'older' && previous && !previous.more) return previous
    if (pending.has(key)) return pending.get(key)!
    const load = (async (): Promise<GithubHistorySnapshot> => {
      const [owner, repo] = context.repository.split('/')
      const request = async (
        tool: string,
        args: Record<string, unknown>
      ): Promise<Record<string, unknown>[]> =>
        rows(await call(context.serverId, tool, JSON.stringify({ owner, repo, ...args })))
      const page = action === 'older' && previous ? previous.page + 1 : 1
      let heads = previous?.heads ?? []
      if (page === 1) {
        heads = []
        for (let branchPage = 1; ; branchPage++) {
          const batch = await request('list_branches', { perPage: 100, page: branchPage })
          heads.push(...batch)
          if (batch.length < 100) break
        }
      }
      const batch = await request('list_commits', { sha: context.branch, perPage: 20, page })
      authorize(context)
      const snapshot = {
        commits:
          page === 1
            ? batch
            : [
                ...previous!.commits,
                ...batch.filter(
                  (commit) => !previous!.commits.some((old) => old.sha === commit.sha)
                )
              ],
        heads,
        page,
        more: batch.length === 20,
        fetchedAt: page === 1 ? Date.now() : previous!.fetchedAt
      }
      cache.delete(key)
      cache.set(key, snapshot)
      while (cache.size > 30) cache.delete(cache.keys().next().value!)
      return snapshot
    })()
    pending.set(key, load)
    try {
      return await load
    } finally {
      pending.delete(key)
    }
  }
}
