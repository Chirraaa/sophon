import { useEffect, useId, useState } from 'react'
import { GitBranch, Plus, Unlink2 } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GithubHistory } from './GithubHistory'
import { GithubSignIn } from './GithubSignIn'
import { connectAccount } from './connection'
import { label, object, rows, unpack, type Row } from './data'
import type { PluginState } from '../../../../shared/plugins'

const endpoint = 'https://api.githubcopilot.com/mcp/'
export function GithubContextCard({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { chatId, githubContext: context, busy } = useSession()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('context')
  const [adding, setAdding] = useState(false)
  const [accounts, setAccounts] = useState<PluginState['servers']>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [serverId, setServerId] = useState(context?.serverId ?? '')
  const [account, setAccount] = useState('')
  const [repos, setRepos] = useState<Row[]>([])
  const [repository, setRepository] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!open || busy) return
    let active = true
    void (async () => {
      await Promise.resolve()
      if (!active) return
      setLoading(true)
      setError('')
      const state = await window.api.plugins.githubAccounts()
      const saved = state.servers.filter((server) => server.configuration.url === endpoint)
      if (!active) return
      setAccounts(saved)
      setAccountsLoaded(true)
      const selected =
        saved.find((server) => server.id === serverId) ??
        saved.find((server) => server.status === 'connected') ??
        saved.find((server) => server.enabled)
      if (!selected) return
      if (serverId !== selected.id) {
        setServerId(selected.id)
        return
      }
      await connectAccount(selected.id)
      const me = object(unpack(await window.api.plugins.githubCall(selected.id, 'get_me', '{}')))
      const login = label(me.login) || label(object(me.details).login)
      if (!login) throw new Error('Reconnect your GitHub account to load its identity.')
      const repositories: Row[] = []
      for (let page = 1; ; page++) {
        const result = object(
          unpack(
            await window.api.plugins.githubCall(
              selected.id,
              'search_repositories',
              JSON.stringify({ query: '', perPage: 100, page })
            )
          )
        )
        const batch = rows(result)
        repositories.push(
          ...batch.filter(
            (repo) => label(repo.full_name).split('/')[0].toLowerCase() === login.toLowerCase()
          )
        )
        if (batch.length < 100 || repositories.length >= Number(result.total_count)) break
      }
      if (!active) return
      setServerId(selected.id)
      setAccount(login)
      setRepos(repositories)
    })()
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      setLoading(false)
    }
  }, [open, serverId, refresh, busy])

  async function chooseRepository(name: string): Promise<void> {
    setRepository(name)
    setBranch('')
    setBranches([])
    setLoading(true)
    setError('')
    try {
      const [owner, repo] = name.split('/')
      const names: string[] = []
      for (let page = 1; ; page++) {
        const batch = rows(
          unpack(
            await window.api.plugins.githubCall(
              serverId,
              'list_branches',
              JSON.stringify({ owner, repo, perPage: 100, page })
            )
          )
        )
        names.push(...batch.map((item) => label(item.name)))
        if (batch.length < 100) break
      }
      setBranches(names)
      const defaultBranch = label(
        repos.find((repo) => label(repo.full_name) === name)?.default_branch
      )
      setBranch(names.includes(defaultBranch) ? defaultBranch : (names[0] ?? ''))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }
  async function save(next: GithubContext | null): Promise<void> {
    setError('')
    try {
      await window.api.setGithubContext(chatId, next)
      setOpen(false)
      setNotice(next ? '' : 'Repository unlinked from this chat.')
      if (!next) {
        setRepository('')
        setBranch('')
        setBranches([])
        setFilter('')
        setTab('context')
      }
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  return (
    <section
      aria-label="GitHub working context"
      data-github-context
      className={
        compact
          ? 'glass-solid rounded-2xl p-3'
          : 'mb-2 rounded-xl border border-border bg-muted/20 p-3'
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <Button
          variant="ghost"
          disabled={busy || loading}
          aria-expanded={open}
          aria-controls={id}
          className="h-auto min-w-0 flex-1 justify-start rounded-sm p-0 text-left text-xs hover:bg-transparent hover:underline aria-expanded:bg-transparent dark:hover:bg-transparent underline-offset-4"
          onClick={() => setOpen(!open)}
        >
          <span className="min-w-0 truncate">
            {context ? context.repository : 'Work on a GitHub repository'}
            {context && (
              <span className="mt-1 block truncate font-mono text-[10px] font-normal text-muted-foreground">
                {context.branch} · @{context.account}
              </span>
            )}
          </span>
        </Button>
        {context && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground"
            disabled={busy || loading}
            aria-label="Unlink repository from chat"
            onClick={() => void save(null)}
          >
            <Unlink2 className="size-3" /> Unlink
          </Button>
        )}
      </div>
      {notice && !context && (
        <p role="status" className="mt-2 text-[10px] text-muted-foreground">
          {notice}
        </p>
      )}
      {context && !open && (
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="mt-3 gap-2">
          <TabsList className="h-7 w-full" aria-label="Repository card">
            <TabsTrigger value="context" className="text-[10px]">
              Context
            </TabsTrigger>
            <TabsTrigger value="history" className="text-[10px]">
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="context">
            <p className="text-[10px] text-muted-foreground">
              Working context for this chat · Click the repository to change
            </p>
          </TabsContent>
          <TabsContent value="history">
            <GithubHistory
              key={`${context.serverId}:${context.repository}:${context.branch}`}
              context={context}
              busy={busy}
            />
          </TabsContent>
        </Tabs>
      )}
      {open && (
        <div id={id} className="mt-3 space-y-3">
          {accounts.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Choose what you’re working on. Sophon will use this repo and branch in this chat.
              </p>
              <Select
                value={serverId || null}
                disabled={loading || busy}
                onValueChange={(value) => {
                  if (value === serverId) return
                  setRepository('')
                  setBranches([])
                  setBranch('')
                  setRepos([])
                  setAccount('')
                  setServerId(value ?? '')
                }}
              >
                <SelectTrigger className="w-full" aria-label="Working GitHub account">
                  <SelectValue placeholder="Choose an account">
                    {accounts.find((server) => server.id === serverId)?.githubLogin
                      ? `@${accounts.find((server) => server.id === serverId)?.githubLogin}`
                      : accounts.find((server) => server.id === serverId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.githubLogin ? `@${server.githubLogin}` : server.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading || busy}
                onClick={() => setAdding(!adding)}
              >
                <Plus className="size-3" />
                Add another account
              </Button>
            </>
          )}
          {((accountsLoaded && !accounts.length) || adding) && (
            <GithubSignIn
              disabled={busy || loading}
              hasSavedAccount={accounts.length > 0}
              onConnected={async (next) => {
                setAdding(false)
                setRepository('')
                setBranch('')
                setBranches([])
                setServerId(next)
                setRefresh((value) => value + 1)
              }}
            />
          )}
          {accounts.length > 0 && (
            <>
              <Input
                aria-label="Filter owned repositories"
                placeholder="Find a repository…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                disabled={loading || busy}
              />
              <Select
                value={repository || null}
                disabled={loading || busy || !account}
                onValueChange={(value) => {
                  if (value) void chooseRepository(value)
                }}
              >
                <SelectTrigger className="w-full" aria-label="Working repository">
                  <SelectValue placeholder="Choose your repository" />
                </SelectTrigger>
                <SelectContent>
                  {repos
                    .filter((repo) =>
                      label(repo.full_name).toLowerCase().includes(filter.toLowerCase())
                    )
                    .map((repo) => (
                      <SelectItem key={label(repo.full_name)} value={label(repo.full_name)}>
                        {label(repo.full_name)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select
                value={branch || null}
                disabled={loading || busy || !branches.length}
                onValueChange={(value) => setBranch(value ?? '')}
              >
                <SelectTrigger className="w-full" aria-label="Working branch">
                  <SelectValue placeholder="Choose a branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {loading && (
            <p role="status" className="text-xs text-muted-foreground">
              Loading GitHub context…
            </p>
          )}
          <div className="flex gap-2">
            {accounts.length > 0 && (
              <Button
                size="sm"
                disabled={busy || loading || !account || !repository || !branch}
                onClick={() => void save({ serverId, account, repository, branch })}
              >
                Use in this chat
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {error}{' '}
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={busy || loading}
            onClick={() => {
              setOpen(true)
              if (repository && account) void chooseRepository(repository)
              else setRefresh((value) => value + 1)
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </section>
  )
}
