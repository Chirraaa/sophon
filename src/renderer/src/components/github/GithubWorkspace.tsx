import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCallback, useEffect, useState } from 'react'
import { GithubError, GithubForm } from './GithubFeedback'
import { GithubSignIn } from './GithubSignIn'
import { connectAccount } from './connection'
import { useSession } from '@/hooks/useSession'
import {
  GitFork as Github,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Search,
  Upload,
  RefreshCw,
  Plus,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { PluginState } from '../../../../shared/plugins'
import { object, label, rows, unpack, type Row } from './data'

const endpoint = 'https://api.githubcopilot.com/mcp/'

type Tab = 'branches' | 'commits' | 'pulls' | 'push'
export function GithubWorkspace(): React.JSX.Element {
  const { chatId } = useSession()
  const [state, setState] = useState<PluginState>({ plugins: [], servers: [] })
  const [serverId, setServerId] = useState('')
  const [token, setToken] = useState('')
  const [account, setAccount] = useState('')
  const [identities, setIdentities] = useState<Record<string, string>>({})
  const [addingAccount, setAddingAccount] = useState(false)
  const [removingAccount, setRemovingAccount] = useState(false)
  const [reposLoaded, setReposLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<Row[]>([])
  const [repository, setRepository] = useState('')
  const [repositoryInput, setRepositoryInput] = useState('')
  const [branch, setBranch] = useState('')
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('branches')
  const [items, setItems] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(1)
  const [newBranch, setNewBranch] = useState('')
  const [selectedPr, setSelectedPr] = useState<number | null>(null)
  const [comments, setComments] = useState<Row[]>([])
  const [comment, setComment] = useState('')
  const [title, setTitle] = useState('')
  const [base, setBase] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([{ path: '', content: '' }])
  const signedIn = useCallback(async (id: string): Promise<void> => {
    setState(await window.api.plugins.list())
    setServerId(id)
    setToken('')
    setAddingAccount(false)
    setAccount('')
    setRepository('')
    setRepositoryInput('')
    setRepos([])
    setItems([])
    setLoaded(false)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setState(await connectAccount(id))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      try {
        setState(await window.api.plugins.list())
      } catch {
        /* Keep the last known connection state. */
      }
      setBusy(false)
    }
  }, [])
  const servers = state.servers.filter((s) => s.configuration.url === endpoint)
  const server = servers.find((s) => s.id === serverId)
  const ready = server?.status === 'connected'
  const accountLabels = new Map(
    servers.map((s) => {
      const login = identities[s.id] || s.githubLogin
      const matches = servers.filter((other) =>
        login
          ? (identities[other.id] || other.githubLogin) === login
          : other.name === s.name && !(identities[other.id] || other.githubLogin)
      )
      const name = login ? `@${login}` : s.name
      return [s.id, matches.length > 1 ? `${name} (${matches.indexOf(s) + 1})` : name]
    })
  )
  const [owner, repo] = repository.split('/')
  useEffect(() => {
    let active = true
    window.api.plugins
      .githubAccounts()
      .then((next) => {
        if (!active) return
        setState(next)
        const accounts = next.servers.filter((s) => s.configuration.url === endpoint)
        setServerId(
          (
            accounts.find((s) => s.status === 'connected') ??
            accounts.find((s) => s.enabled) ??
            accounts[0]
          )?.id ?? ''
        )
      })
      .catch((e: Error) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!ready || !serverId) return
    let active = true
    async function discover(): Promise<void> {
      try {
        const next = await window.api.plugins.list()
        if (!active) return
        setBusy(true)
        setError('')
        setReposLoaded(false)
        let login = ''
        for (const saved of next.servers.filter(
          (s) => s.configuration.url === endpoint && s.status === 'connected'
        )) {
          try {
            const me = object(unpack(await window.api.plugins.githubCall(saved.id, 'get_me', '{}')))
            const name = label(me.login) || label(object(me.details).login)
            if (!active) return
            if (name) setIdentities((previous) => ({ ...previous, [saved.id]: name }))
            if (saved.id === serverId) login = name
          } catch (reason) {
            if (saved.id === serverId) throw reason
          }
        }
        if (!active) return
        setAccount(login)
        if (!login)
          throw new Error('Could not identify this GitHub account. Reconnect and try again.')
        const result = unpack(
          await window.api.plugins.githubCall(
            serverId,
            'search_repositories',
            JSON.stringify({ query: '', perPage: 20, minimal_output: true })
          )
        )
        if (active) {
          setRepos(rows(result))
          setReposLoaded(true)
          setNotice('Repositories are ready.')
        }
      } catch (reason) {
        if (active) {
          setNotice('')
          setError((reason as Error).message)
          try {
            const next = await window.api.plugins.list()
            if (active) setState(next)
          } catch {
            /* Keep the last known state. */
          }
        }
      } finally {
        if (active) setBusy(false)
      }
    }
    void discover()
    return () => {
      active = false
    }
  }, [serverId, ready])
  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      try {
        setState(await window.api.plugins.list())
      } catch {
        /* Preserve operation result. */
      }
      setBusy(false)
    }
  }
  async function call(tool: string, args: Row = {}, id = serverId): Promise<unknown> {
    return unpack(await window.api.plugins.githubCall(id, tool, JSON.stringify(args)))
  }
  function reset(): void {
    setItems([])
    setLoaded(false)
    setPage(1)
    setSelectedPr(null)
    setComments([])
  }
  async function load(
    target = tab,
    nextPage = page,
    selectedBranch = branch,
    selectedRepository = repository
  ): Promise<void> {
    setLoaded(false)
    setItems([])
    const [selectedOwner, selectedRepo] = selectedRepository.split('/')
    const args = { owner: selectedOwner, repo: selectedRepo, perPage: 20, page: nextPage }
    const data = await call(
      target === 'branches'
        ? 'list_branches'
        : target === 'commits'
          ? 'list_commits'
          : 'list_pull_requests',
      target === 'commits'
        ? { ...args, ...(selectedBranch ? { sha: selectedBranch } : {}) }
        : target === 'pulls'
          ? { ...args, state: 'open' }
          : args
    )
    const results = rows(data)
    setItems(results)
    if (target === 'branches') {
      const names = results.map((item) => label(item.name)).filter(Boolean)
      setBranchNames((previous) => [...new Set([...(nextPage === 1 ? [] : previous), ...names])])
    }
    setLoaded(true)
    setPage(nextPage)
  }
  async function connect(savedId?: string): Promise<void> {
    let id = savedId ?? serverId
    if (!savedId && token.trim()) {
      if (!token.trim().startsWith('github_pat_'))
        throw new Error(
          'Use a fine-grained GitHub token restricted to selected repositories. Classic tokens grant broader access.'
        )
      const next = await window.api.plugins.addServer(
        'GitHub · fine-grained token',
        JSON.stringify({
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${token.trim()}` }
        })
      )
      id = next.servers.find((s) => !state.servers.some((old) => old.id === s.id))!.id
      setToken('')
      setState(next)
      setServerId(id)
    }
    if (!id) throw new Error('Enter a personal access token first.')
    const connected = await connectAccount(id)
    setState(connected)
  }
  return (
    <ScrollArea className="h-full" orientation="both" contentClassName="p-6 lg:p-9">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-border p-3">
              <Github className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">GitHub</h1>
              <p className="text-xs text-muted-foreground">Your repositories. Your workflow.</p>
            </div>
          </div>
          <Badge variant={ready ? 'secondary' : 'outline'}>
            {ready
              ? account || 'Connected'
              : busy || server?.status === 'connecting'
                ? 'Connecting…'
                : server?.status === 'error'
                  ? 'Connection failed'
                  : server
                    ? 'Account saved'
                    : 'Not connected'}
          </Badge>
        </header>
        {error && <GithubError error={error} />}
        {!error && server?.status === 'error' && (
          <GithubError error="Could not restore this GitHub connection. Check your network and use Connect saved account to retry. If the token has expired or been revoked, remove this account and add it again." />
        )}
        {(busy || notice) && (
          <p role="status" className="text-sm text-muted-foreground">
            {busy ? 'Working with GitHub…' : notice}
          </p>
        )}
        <fieldset disabled={busy} className="min-w-0 space-y-6 disabled:opacity-70">
          <section
            className="space-y-3 rounded-xl border border-border p-4"
            aria-label="GitHub account"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">GitHub accounts</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Switch between saved accounts or add another GitHub login.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAddingAccount(!addingAccount)}>
                <Plus className="size-4" /> {addingAccount ? 'Close sign-in' : 'Add GitHub account'}
              </Button>
            </div>
            {(!ready || addingAccount) && (
              <GithubSignIn disabled={busy} onConnected={signedIn} hasSavedAccount={!!server} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              {servers.length > 0 && (
                <Select
                  disabled={busy}
                  value={serverId}
                  onValueChange={(value) => {
                    setServerId(value ?? '')
                    setError('')
                    setNotice('')
                    setAccount('')
                    setQuery('')
                    setRepository('')
                    setRepositoryInput('')
                    setRepos([])
                    reset()
                  }}
                >
                  <SelectTrigger
                    aria-label="GitHub account connection"
                    className="w-full max-w-full shrink-0 sm:w-80"
                  >
                    <SelectValue>{accountLabels.get(serverId) ?? 'Select account'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-(--anchor-width)">
                    {servers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="min-w-0 truncate" title={accountLabels.get(s.id)}>
                          {accountLabels.get(s.id)}
                        </span>
                        {s.status === 'connected' && (
                          <span className="shrink-0 text-xs text-muted-foreground">Connected</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {ready ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void perform(async () => {
                        const me = object(await call('get_me'))
                        setAccount(
                          label(me.login) || label(object(me.details).login) || 'Connected'
                        )
                      })
                    }
                  >
                    Refresh account
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void perform(async () => {
                        setState(await window.api.plugins.disconnect(serverId))
                        setAccount('')
                        reset()
                      })
                    }
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <div className="min-w-0 flex-1 basis-80 space-y-3">
                  {serverId && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void perform(async () => {
                          setToken('')
                          await connect(serverId)
                        })
                      }
                    >
                      Connect saved account
                    </Button>
                  )}
                  <Collapsible className="text-xs text-muted-foreground">
                    <CollapsibleTrigger className="w-fit cursor-pointer">
                      Access selected private repositories
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="mt-3 leading-relaxed">
                        In GitHub Settings → Developer settings → Personal access tokens →
                        Fine-grained tokens, create a token with “Only select repositories” and
                        choose the repositories you want Sophon to access. Enable Contents, Pull
                        requests and Issues as needed (read and write for pushes and comments).
                        Leave Administration and other unrelated permissions disabled. This
                        connection uses exactly the access you grant on GitHub; Sophon cannot narrow
                        an existing token’s permissions.
                      </p>
                      <GithubForm
                        className="mt-3 flex min-w-0 flex-wrap gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void perform(connect)
                        }}
                      >
                        <Input
                          className="min-w-48 flex-1"
                          aria-label="GitHub personal access token"
                          type="password"
                          autoComplete="off"
                          maxLength={4096}
                          placeholder="Personal access token"
                          required
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                        />
                        <Button type="submit">Connect with token</Button>
                      </GithubForm>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
            </div>
            {server && (
              <Button variant="ghost" size="sm" onClick={() => setRemovingAccount(true)}>
                <Trash2 className="size-4" /> Remove account
              </Button>
            )}
            <ConfirmationDialog
              open={removingAccount}
              onOpenChange={setRemovingAccount}
              title={`Remove ${accountLabels.get(serverId) || 'this GitHub account'}?`}
              description="Removes this saved connection and its credentials from Sophon on this computer. Your GitHub account and repositories are kept. You can add the account again anytime."
              confirmLabel="Remove account"
              cancelLabel="Keep account"
              pendingLabel="Removing…"
              onConfirm={async () => {
                const next = await window.api.plugins.removeServer(serverId)
                setState(next)
                const remaining = next.servers.filter(
                  (saved) => saved.configuration.url === endpoint
                )
                setServerId(
                  (remaining.find((saved) => saved.status === 'connected') ?? remaining[0])?.id ??
                    ''
                )
                setAccount('')
                setRepos([])
                setReposLoaded(false)
                setRepository('')
                setRepositoryInput('')
                setQuery('')
                setAddingAccount(false)
                reset()
                setNotice('Account removed from Sophon.')
                setError('')
              }}
            />
            <p className="text-xs text-muted-foreground">
              Accounts are saved securely on this computer. Actions use the selected account’s
              GitHub permissions and run when you click their button.
            </p>
          </section>
          {ready && (
            <>
              <div className="space-y-1">
                <h2 className="text-sm font-medium">Repositories</h2>
                <p className="text-xs text-muted-foreground">
                  Only repositories owned by {account ? `@${account}` : 'the selected account'}{' '}
                  appear here. Search by repository name.
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
                      onClick={() =>
                        void perform(async () => {
                          const name = label(r.full_name)
                          const defaultBranch = label(r.default_branch)
                          setRepository(name)
                          setRepositoryInput(name)
                          setBranch(defaultBranch)
                          setBranchNames([])
                          setBase(defaultBranch)
                          setTab('branches')
                          reset()
                          await load('branches', 1, defaultBranch, name)
                        })
                      }
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
                      repos.find(
                        (repo) => label(repo.full_name).toLowerCase() === name.toLowerCase()
                      )?.default_branch
                    )
                    setRepository(name)
                    setBranch(defaultBranch)
                    setBranchNames([])
                    setBase(defaultBranch)
                    setTab('branches')
                    reset()
                    await load('branches', 1, defaultBranch, name)
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
              {owner && repo && owner.toLowerCase() === account.toLowerCase() && (
                <section className="space-y-5 rounded-xl border border-border p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-medium">{repository}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !branch}
                      onClick={() =>
                        void perform(async () => {
                          await window.api.setGithubContext(chatId, {
                            serverId,
                            account,
                            repository,
                            branch
                          })
                          setNotice(
                            `Working context set to ${repository} · ${branch} for the current chat.`
                          )
                        })
                      }
                    >
                      <GitBranch className="size-3" /> Use in current chat
                    </Button>
                    <div className="flex items-center gap-2">
                      <GitBranch className="size-4 text-muted-foreground" />
                      <Select
                        value={branch}
                        disabled={busy}
                        onValueChange={(value) => {
                          if (!value) return
                          void perform(async () => {
                            setBranch(value)
                            if (tab === 'commits') {
                              reset()
                              await load('commits', 1, value)
                            }
                          })
                        }}
                      >
                        <SelectTrigger
                          className="w-48 font-mono text-xs"
                          aria-label="Active branch"
                        >
                          <SelectValue placeholder="Choose a branch" />
                        </SelectTrigger>
                        <SelectContent>
                          {[...new Set([branch, ...branchNames])].filter(Boolean).map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Tabs
                    value={tab}
                    onValueChange={(value) => {
                      void perform(async () => {
                        setTab(value as Tab)
                        reset()
                        if (value !== 'push') await load(value as Tab, 1)
                      })
                    }}
                  >
                    <TabsList
                      variant="line"
                      className="w-full max-w-full flex-wrap justify-start gap-y-3 group-data-horizontal/tabs:h-auto"
                    >
                      {(
                        [
                          ['branches', GitBranch, 'Branches'],
                          ['commits', GitCommitHorizontal, 'Commits'],
                          ['pulls', GitPullRequest, 'Pull requests'],
                          ['push', Upload, 'Commit & push']
                        ] as const
                      ).map(([key, Icon, text]) => (
                        <TabsTrigger key={key} value={key} className="h-8 flex-none">
                          <Icon />
                          {text}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  {tab !== 'push' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void perform(() => load(tab, 1))}
                      >
                        <RefreshCw className="size-3.5" />
                        {error && !loaded ? 'Try again' : 'Refresh'}
                      </Button>
                      <div className="divide-y divide-border rounded-lg border border-border">
                        {!loaded && (
                          <p className="p-6 text-center text-sm text-muted-foreground">
                            {busy
                              ? `Loading ${tab === 'pulls' ? 'pull requests' : tab}…`
                              : 'Could not load this view. Try again.'}
                          </p>
                        )}
                        {loaded && !items.length && (
                          <p className="p-6 text-center text-sm text-muted-foreground">
                            No results on this page.
                          </p>
                        )}
                        {items.map((item, i) => (
                          <div
                            key={label(item.sha) || label(item.name) || String(item.number ?? i)}
                            className="flex items-start justify-between gap-3 p-4"
                          >
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">
                                {tab === 'branches'
                                  ? label(item.name)
                                  : tab === 'commits'
                                    ? label(object(item.commit).message).split('\n')[0]
                                    : `#${item.number} ${label(item.title)}`}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {tab === 'commits'
                                  ? `${label(item.sha).slice(0, 7)} · ${label(object(object(item.commit).author).name)}`
                                  : tab === 'branches'
                                    ? label(object(item.commit).sha).slice(0, 7)
                                    : label(object(item.user).login)}
                              </p>
                            </div>
                            {tab === 'branches' && (
                              <div className="flex items-center gap-2">
                                {item.protected === true && (
                                  <Badge variant="outline">Protected</Badge>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void perform(async () => {
                                      const selectedBranch = label(item.name)
                                      setBranch(selectedBranch)
                                      setTab('commits')
                                      reset()
                                      await load('commits', 1, selectedBranch)
                                    })
                                  }
                                >
                                  Select
                                </Button>
                              </div>
                            )}
                            {tab === 'pulls' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void perform(async () => {
                                    setSelectedPr(null)
                                    setComments([])
                                    const result = await call('pull_request_read', {
                                      method: 'get_comments',
                                      owner,
                                      repo,
                                      pullNumber: item.number,
                                      perPage: 20
                                    })
                                    setComments(rows(result))
                                    setSelectedPr(Number(item.number))
                                  })
                                }
                              >
                                Comments
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      {loaded && (
                        <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={page === 1}
                            onClick={() => void perform(() => load(tab, page - 1))}
                          >
                            Previous
                          </Button>
                          Page {page}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={items.length < 20}
                            onClick={() => void perform(() => load(tab, page + 1))}
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {tab === 'branches' && (
                    <GithubForm
                      className="flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void perform(async () => {
                          await call('create_branch', {
                            owner,
                            repo,
                            branch: newBranch.trim(),
                            ...(branch ? { from_branch: branch } : {})
                          })
                          setNotice(`Created ${newBranch}.`)
                          setNewBranch('')
                          await load('branches', 1)
                        })
                      }}
                    >
                      <Input
                        className="min-w-48 flex-1"
                        aria-label="New branch name"
                        placeholder="feature/your-next-idea"
                        value={newBranch}
                        onChange={(e) => setNewBranch(e.target.value)}
                        required
                      />
                      <Button type="submit" variant="outline">
                        <Plus className="size-4" />
                        Create branch{branch ? ` from ${branch}` : ''}
                      </Button>
                    </GithubForm>
                  )}
                  {tab === 'pulls' && (
                    <>
                      {selectedPr !== null && (
                        <div className="space-y-3 rounded-lg bg-muted/30 p-4">
                          <h3 className="text-sm font-medium">
                            Comments on #{selectedPr} · first page (up to 20)
                          </h3>
                          {comments.map((c, i) => (
                            <div
                              key={String(c.id ?? i)}
                              className="rounded-lg border border-border p-3"
                            >
                              <p className="text-xs text-muted-foreground">
                                {label(object(c.user).login)}
                              </p>
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                                {label(c.body)}
                              </p>
                            </div>
                          ))}
                          {!comments.length && (
                            <p className="text-sm text-muted-foreground">No comments yet.</p>
                          )}
                          <GithubForm
                            className="space-y-2"
                            onSubmit={(e) => {
                              e.preventDefault()
                              void perform(async () => {
                                await call('add_issue_comment', {
                                  owner,
                                  repo,
                                  issue_number: selectedPr,
                                  body: comment
                                })
                                setComment('')
                                setComments(
                                  rows(
                                    await call('pull_request_read', {
                                      method: 'get_comments',
                                      owner,
                                      repo,
                                      pullNumber: selectedPr,
                                      perPage: 20
                                    })
                                  )
                                )
                                setNotice('Comment posted.')
                              })
                            }}
                          >
                            <Textarea
                              aria-label="Comment"
                              placeholder="Leave a comment…"
                              value={comment}
                              onChange={(e) => setComment(e.target.value)}
                              required
                              maxLength={12000}
                            />
                            <Button type="submit" size="sm">
                              Post comment
                            </Button>
                          </GithubForm>
                        </div>
                      )}
                      <GithubForm
                        className="space-y-3 border-t border-border pt-4"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void perform(async () => {
                            await call('create_pull_request', {
                              owner,
                              repo,
                              head: branch,
                              base,
                              title
                            })
                            setTitle('')
                            setNotice('Pull request created.')
                            await load('pulls', 1)
                          })
                        }}
                      >
                        <h3 className="text-sm font-medium">Open a pull request</h3>
                        <Input
                          aria-label="Pull request title"
                          placeholder="Pull request title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          required
                        />
                        <Input
                          aria-label="Base branch"
                          placeholder="Base branch, e.g. main"
                          value={base}
                          onChange={(e) => setBase(e.target.value)}
                          required
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={!branch || branch === base}
                        >
                          Create pull request from {branch || 'selected branch'}
                        </Button>
                      </GithubForm>
                    </>
                  )}
                  {tab === 'push' && (
                    <GithubForm
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void perform(async () => {
                          const paths = files.map((f) => f.path.trim())
                          if (
                            new Set(paths).size !== paths.length ||
                            paths.some((p) => p.startsWith('/') || p.split('/').includes('..'))
                          )
                            throw new Error('Use unique repository-relative file paths.')
                          await call('push_files', {
                            owner,
                            repo,
                            branch,
                            message,
                            files: files.map((f) => ({ ...f, path: f.path.trim() }))
                          })
                          setMessage('')
                          setFiles([{ path: '', content: '' }])
                          setNotice(`Commit pushed to ${repository}:${branch}.`)
                        })
                      }}
                    >
                      <p className="text-sm text-muted-foreground">
                        Create or replace text files on GitHub in one commit. Review the contents
                        and selected branch below before publishing.
                      </p>
                      {files.map((file, i) => (
                        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                          <div className="flex flex-wrap gap-2">
                            <Input
                              aria-label={`File ${i + 1} path`}
                              placeholder="src/example.ts"
                              value={file.path}
                              onChange={(e) =>
                                setFiles(
                                  files.map((f, n) =>
                                    n === i ? { ...f, path: e.target.value } : f
                                  )
                                )
                              }
                              required
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove file ${i + 1}`}
                              disabled={files.length === 1}
                              onClick={() => setFiles(files.filter((_, n) => n !== i))}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                          <Textarea
                            className="min-h-40 font-mono text-xs"
                            aria-label={`File ${i + 1} contents`}
                            placeholder="Full file contents"
                            value={file.content}
                            onChange={(e) =>
                              setFiles(
                                files.map((f, n) =>
                                  n === i ? { ...f, content: e.target.value } : f
                                )
                              )
                            }
                            maxLength={24000}
                          />
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        disabled={files.length >= 10}
                        onClick={() => setFiles([...files, { path: '', content: '' }])}
                      >
                        <Plus className="size-4" />
                        Add file
                      </Button>
                      <Input
                        aria-label="Commit message"
                        placeholder="Commit message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        required
                        maxLength={1000}
                      />
                      <Button type="submit" disabled={!branch}>
                        <Upload className="size-4" />
                        Commit & push to {branch || 'a branch'}
                      </Button>
                    </GithubForm>
                  )}
                </section>
              )}
            </>
          )}
        </fieldset>
      </div>
    </ScrollArea>
  )
}
