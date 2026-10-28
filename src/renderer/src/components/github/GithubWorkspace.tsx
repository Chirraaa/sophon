import { ScrollArea } from '@/components/ui/scroll-area'
import { useCallback, useEffect, useState } from 'react'
import { GithubError, GithubForm } from './GithubFeedback'
import { GithubAccountSection } from './GithubAccountSection'
import { GithubRepositoryPicker } from './GithubRepositoryPicker'
import { GithubItemList, type GithubTab as Tab } from './GithubItemList'
import { GithubPullRequestPanel } from './GithubPullRequestPanel'
import { GithubPushForm } from './GithubPushForm'
import { connectAccount } from './connection'
import { useSession } from '@/hooks/useSession'
import {
  GitFork as Github,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Plus,
  Upload
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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

export function GithubWorkspace(): React.JSX.Element {
  const { chatId } = useSession()
  const [state, setState] = useState<PluginState>({ plugins: [], servers: [] })
  const [serverId, setServerId] = useState('')
  const [token, setToken] = useState('')
  const [account, setAccount] = useState('')
  const [identities, setIdentities] = useState<Record<string, string>>({})
  const [addingAccount, setAddingAccount] = useState(false)
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
  const [base, setBase] = useState('')
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
  function selectAccount(id: string): void {
    setServerId(id)
    setError('')
    setNotice('')
    setAccount('')
    setQuery('')
    setRepository('')
    setRepositoryInput('')
    setRepos([])
    reset()
  }
  function removedAccount(next: PluginState): void {
    setState(next)
    const remaining = next.servers.filter((saved) => saved.configuration.url === endpoint)
    setServerId((remaining.find((saved) => saved.status === 'connected') ?? remaining[0])?.id ?? '')
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
  }
  async function refreshAccount(): Promise<void> {
    const me = object(await call('get_me'))
    setAccount(label(me.login) || label(object(me.details).login) || 'Connected')
  }
  async function disconnect(): Promise<void> {
    setState(await window.api.plugins.disconnect(serverId))
    setAccount('')
    reset()
  }
  async function openRepository(name: string, defaultBranch: string): Promise<void> {
    setRepository(name)
    setRepositoryInput(name)
    setBranch(defaultBranch)
    setBranchNames([])
    setBase(defaultBranch)
    setTab('branches')
    reset()
    await load('branches', 1, defaultBranch, name)
  }
  async function selectBranch(name: string): Promise<void> {
    setBranch(name)
    setTab('commits')
    reset()
    await load('commits', 1, name)
  }
  async function showComments(number: number): Promise<void> {
    setSelectedPr(null)
    setComments([])
    const result = await call('pull_request_read', {
      method: 'get_comments',
      owner,
      repo,
      pullNumber: number,
      perPage: 20
    })
    setComments(rows(result))
    setSelectedPr(number)
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
          <GithubAccountSection
            busy={busy}
            ready={ready}
            server={server}
            servers={servers}
            serverId={serverId}
            accountLabels={accountLabels}
            token={token}
            setToken={setToken}
            addingAccount={addingAccount}
            setAddingAccount={setAddingAccount}
            perform={perform}
            connect={connect}
            refreshAccount={refreshAccount}
            disconnect={disconnect}
            onSignedIn={signedIn}
            onSelect={selectAccount}
            onRemoved={removedAccount}
          />
          {ready && (
            <>
              <GithubRepositoryPicker
                account={account}
                query={query}
                setQuery={setQuery}
                repos={repos}
                setRepos={setRepos}
                reposLoaded={reposLoaded}
                setReposLoaded={setReposLoaded}
                repository={repository}
                repositoryInput={repositoryInput}
                setRepositoryInput={setRepositoryInput}
                perform={perform}
                call={call}
                open={openRepository}
              />
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
                    <GithubItemList
                      tab={tab}
                      items={items}
                      loaded={loaded}
                      busy={busy}
                      error={error}
                      page={page}
                      perform={perform}
                      reload={(nextPage) => load(tab, nextPage)}
                      selectBranch={selectBranch}
                      showComments={showComments}
                    />
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
                    <GithubPullRequestPanel
                      owner={owner}
                      repo={repo}
                      branch={branch}
                      base={base}
                      setBase={setBase}
                      selectedPr={selectedPr}
                      comments={comments}
                      setComments={setComments}
                      perform={perform}
                      call={call}
                      setNotice={setNotice}
                      reload={() => load('pulls', 1)}
                    />
                  )}
                  {tab === 'push' && (
                    <GithubPushForm
                      owner={owner}
                      repo={repo}
                      repository={repository}
                      branch={branch}
                      perform={perform}
                      call={call}
                      setNotice={setNotice}
                    />
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
