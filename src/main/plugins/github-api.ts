import type { McpConfig } from '../../shared/plugins'

type Args = Record<string, unknown>
interface Repository {
  full_name: string
  default_branch: string
  private: boolean
  description: string
}
interface User {
  login: string
  id: number
  avatar_url: string
  html_url: string
}
interface Commit {
  sha: string
  parents?: { sha: string }[]
  commit: { message: string; author: Record<string, unknown> }
  files?: { filename: string; status: string; additions: number; deletions: number }[]
}
interface Pull {
  number: number
  title: string
  user: User
  state: string
  html_url: string
}
interface Comment {
  id: number
  body: string
  user: User
}
interface Ref {
  ref: string
  object: { sha: string }
}
export class GithubApiError extends Error {}

/** GitHub's MCP gateway requires broader scopes than public_repo for repository tools.
 * The dedicated workspace uses REST with the user's existing token instead. */
export async function callGithubApi(
  config: McpConfig,
  tool: string,
  args: Args,
  signal: AbortSignal
): Promise<unknown> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(config.headers?.Authorization ? { Authorization: config.headers.Authorization } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])
    })
    if (!response.ok) {
      if (response.status === 401)
        throw new GithubApiError(
          'Your GitHub sign-in has expired. Sign in again to reconnect your account.'
        )
      if (
        response.status === 429 ||
        (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
      )
        throw new GithubApiError('GitHub rate limit reached. Wait a few minutes, then try again.')
      if (response.status === 403)
        throw new GithubApiError(
          'This account does not have permission for this action. Review its repository access on GitHub.'
        )
      if (response.status === 404)
        throw new GithubApiError(
          'GitHub could not find this repository, branch or item. Check the name and selected account.'
        )
      if (response.status === 409 || response.status === 422)
        throw new GithubApiError(
          'GitHub could not apply this change. Refresh the repository and check that branch names, file paths and pull request details are valid.'
        )
      throw new Error(`GitHub request failed (HTTP ${response.status}).`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('GitHub returned an empty response.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 4 * 1024 * 1024)
          throw new Error('GitHub response is too large. Request a smaller page.')
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  const segment = (value: unknown): string => encodeURIComponent(String(value ?? ''))
  const root = `/repos/${segment(args.owner)}/${segment(args.repo)}`
  const pagination = new URLSearchParams({
    per_page: String(args.perPage ?? 20),
    page: String(args.page ?? 1)
  })

  const account = await request<User>('/user')
  if (args.owner !== undefined && String(args.owner).toLowerCase() !== account.login.toLowerCase())
    throw new GithubApiError(
      `Choose a repository owned by @${account.login}. Switch accounts to work with another account's repositories.`
    )
  switch (tool) {
    case 'get_me': {
      const me = account
      return { login: me.login, id: me.id, avatar_url: me.avatar_url, profile_url: me.html_url }
    }
    case 'search_repositories': {
      const query = String(args.query ?? '')
        .trim()
        .toLowerCase()
      const matches: Repository[] = []
      for (let page = 1; ; page++) {
        const repositories = await request<Repository[]>(
          `/user/repos?type=owner&sort=full_name&per_page=100&page=${page}`
        )
        matches.push(
          ...repositories
            .filter((repo) => {
              const [owner, name] = repo.full_name.split('/')
              return (
                owner.toLowerCase() === account.login.toLowerCase() &&
                (!query || name.toLowerCase().includes(query))
              )
            })
            .map((repo) => ({
              full_name: repo.full_name,
              default_branch: repo.default_branch,
              private: repo.private,
              description: repo.description
            }))
        )
        if (repositories.length < 100) break
        if (page >= 100)
          throw new GithubApiError('This account has too many repositories to load at once.')
      }
      const pageSize = Math.min(100, Math.max(1, Number(args.perPage) || 20))
      const offset = (Math.max(1, Number(args.page) || 1) - 1) * pageSize
      return {
        total_count: matches.length,
        items: matches.slice(offset, offset + pageSize)
      }
    }
    case 'list_branches':
      return request(`${root}/branches?${pagination}`)
    case 'list_commits': {
      if (args.sha) pagination.set('sha', String(args.sha))
      const commits = await request<Commit[]>(`${root}/commits?${pagination}`)
      return commits.map((commit) => ({
        sha: commit.sha,
        parents: (commit.parents ?? []).map((parent) => ({ sha: parent.sha })),
        commit: { message: commit.commit.message, author: commit.commit.author }
      }))
    }
    case 'get_commit': {
      const commit = await request<Commit>(`${root}/commits/${segment(args.sha)}`)
      return {
        sha: commit.sha,
        commit: commit.commit,
        files: commit.files?.map((file) => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions
        }))
      }
    }
    case 'list_pull_requests': {
      pagination.set('state', String(args.state ?? 'open'))
      const pulls = await request<Pull[]>(`${root}/pulls?${pagination}`)
      return pulls.map((pull) => ({
        number: pull.number,
        title: pull.title,
        user: { login: pull.user?.login },
        state: pull.state
      }))
    }
    case 'pull_request_read': {
      if (args.method !== 'get_comments')
        throw new GithubApiError('This pull request action is not available in the workspace.')
      const comments = await request<Comment[]>(
        `${root}/issues/${segment(args.pullNumber)}/comments?${pagination}`
      )
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        user: { login: comment.user?.login }
      }))
    }
    case 'create_branch': {
      const from = args.from_branch || (await request<Repository>(root)).default_branch
      const ref = await request<Ref>(`${root}/git/ref/heads/${segment(from)}`)
      const created = await request<Ref>(`${root}/git/refs`, 'POST', {
        ref: `refs/heads/${args.branch}`,
        sha: ref.object.sha
      })
      return { ref: created.ref }
    }
    case 'add_issue_comment': {
      const comment = await request<Comment>(
        `${root}/issues/${segment(args.issue_number)}/comments`,
        'POST',
        { body: args.body }
      )
      return { id: comment.id }
    }
    case 'create_pull_request': {
      const pull = await request<Pull>(`${root}/pulls`, 'POST', {
        title: args.title,
        head: args.head,
        base: args.base,
        ...(args.body ? { body: args.body } : {})
      })
      return { number: pull.number, html_url: pull.html_url }
    }
    case 'push_files': {
      const refPath = `${root}/git/ref/heads/${segment(args.branch)}`
      const ref = await request<Ref>(refPath)
      const parent = await request<{ tree: { sha: string } }>(
        `${root}/git/commits/${segment(ref.object.sha)}`
      )
      const files = args.files as { path: string; content: string }[]
      const tree = await request<{ sha: string }>(`${root}/git/trees`, 'POST', {
        base_tree: parent.tree.sha,
        tree: files.map((file) => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: file.content
        }))
      })
      const commit = await request<{ sha: string }>(`${root}/git/commits`, 'POST', {
        message: args.message,
        tree: tree.sha,
        parents: [ref.object.sha]
      })
      await request(`${root}/git/refs/heads/${segment(args.branch)}`, 'PATCH', {
        sha: commit.sha,
        force: false
      })
      return { sha: commit.sha }
    }
    default:
      throw new GithubApiError('This GitHub action is not available in the workspace.')
  }
}
