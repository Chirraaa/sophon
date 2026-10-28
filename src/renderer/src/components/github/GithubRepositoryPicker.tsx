import { GitFork as Github, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GithubForm } from './GithubFeedback'
import { label, rows, type Row } from './data'

export function GithubRepositoryPicker({
  account,
  query,
  setQuery,
  repos,
  setRepos,
  reposLoaded,
  setReposLoaded,
  repository,
  repositoryInput,
  setRepositoryInput,
  perform,
  call,
  open
}: {
  account: string
  query: string
  setQuery: (query: string) => void
  repos: Row[]
  setRepos: (repos: Row[]) => void
  reposLoaded: boolean
  setReposLoaded: (loaded: boolean) => void
  repository: string
  repositoryInput: string
  setRepositoryInput: (value: string) => void
  perform: (action: () => Promise<void>) => Promise<void>
  call: (tool: string, args?: Row) => Promise<unknown>
  open: (name: string, defaultBranch: string) => Promise<void>
}): React.JSX.Element {
  return (
    <>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Repositories</h2>
        <p className="text-xs text-muted-foreground">
          Only repositories owned by {account ? `@${account}` : 'the selected account'} appear here.
          Search by repository name.
        </p>
      </div>
      <GithubForm
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void perform(async () => {
            setReposLoaded(false)
            setRepos(
              rows(
                await call('search_repositories', {
                  query: query.trim(),
                  perPage: 20,
                  minimal_output: true
                })
              )
            )
            setReposLoaded(true)
          })
        }}
      >
        <Input
          aria-label="Search repositories"
          className="min-w-48 flex-1"
          placeholder="Find a repository in this account"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" /> Search
        </Button>
      </GithubForm>
      {reposLoaded && repos.length === 0 && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No repositories found. Try another search or switch accounts.
        </p>
      )}
      {repos.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {repos.map((r) => (
            <Button
              key={label(r.full_name)}
              variant={repository === r.full_name ? 'secondary' : 'outline'}
              className="h-auto justify-start py-3 text-left"
              onClick={() => void perform(() => open(label(r.full_name), label(r.default_branch)))}
            >
              <Github className="size-4 shrink-0" />
              <span className="truncate">{label(r.full_name)}</span>
              {r.private === true && <Badge variant="outline">Private</Badge>}
            </Button>
          ))}
        </div>
      )}
      <GithubForm
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void perform(async () => {
            const name = repositoryInput.trim()
            if (name.split('/')[0]?.toLowerCase() !== account.toLowerCase())
              throw new Error(
                `Choose a repository owned by @${account}. Switch accounts to open another account's repositories.`
              )
            const defaultBranch = label(
              repos.find((repo) => label(repo.full_name).toLowerCase() === name.toLowerCase())
                ?.default_branch
            )
            await open(name, defaultBranch)
          })
        }}
      >
        <Input
          aria-label="Repository owner/name"
          className="min-w-48 flex-1"
          placeholder={account ? `${account}/repository` : 'owner/repository'}
          value={repositoryInput}
          pattern="[^/\s]+/[^/\s]+"
          onChange={(e) => {
            setRepositoryInput(e.target.value)
          }}
          required
        />
        <Button variant="outline" type="submit">
          Open repository
        </Button>
      </GithubForm>
    </>
  )
}
