import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { GitBranch, GitMerge, Download, ArrowDownToLine, FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { commitGraph, type GraphCommit } from '../../../../shared/commit-graph'
import type {
  GithubCheckout,
  GithubHistoryAction,
  GithubHistorySnapshot
} from '../../../../shared/github-history'
import { githubHistoryKey } from '../../../../shared/github-history'
import { friendlyError, label, object, type Row } from './data'

interface HistoryCommit extends GraphCommit {
  message: string
  author: string
  date: string
}
const colors = ['#60a5fa', '#c084fc', '#2dd4bf', '#fbbf24', '#fb7185']
function commitsFrom(data: Row[]): HistoryCommit[] {
  return data
    .map((item) => {
      const commit = object(item.commit)
      const author = object(commit.author)
      return {
        sha: label(item.sha),
        parents: Array.isArray(item.parents)
          ? item.parents.map((parent) => label(object(parent).sha)).filter(Boolean)
          : [],
        message: label(commit.message),
        author: label(author.name) || label(object(item.author).login) || 'Unknown author',
        date: label(author.date)
      }
    })
    .filter((commit) => commit.sha)
}
export function GithubHistory({
  context,
  busy
}: {
  context: GithubContext
  busy: boolean
}): React.JSX.Element {
  const id = useId()
  const [snapshot, setSnapshot] = useState<GithubHistorySnapshot | null>(null)
  const [checkout, setCheckout] = useState<GithubCheckout | null>(null)
  const [loading, setLoading] = useState(false)
  const [operation, setOperation] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const mounted = useRef(false)
  const request = useRef(0)
  const { serverId, account, repository, branch } = context
  const load = useCallback(
    async (action: GithubHistoryAction): Promise<void> => {
      await Promise.resolve()
      if (!mounted.current) return
      const token = ++request.current
      setLoading(true)
      setError('')
      try {
        const next = await window.api.plugins.githubHistory(
          { serverId, account, repository, branch },
          action
        )
        if (mounted.current && token === request.current) setSnapshot(next)
      } catch (reason) {
        if (mounted.current && token === request.current) setError(friendlyError(reason))
      } finally {
        if (mounted.current && token === request.current) setLoading(false)
      }
    },
    [serverId, account, repository, branch]
  )
  useEffect(() => {
    mounted.current = true
    const key = githubHistoryKey({ serverId, account, repository, branch })
    const detachHistory = window.api.plugins.onGithubHistory((update) => {
      if (githubHistoryKey(update.context) === key) setSnapshot(update.snapshot)
    })
    const detachCheckout = window.api.plugins.onGithubCheckout((update) => {
      if (
        update.context.serverId === serverId &&
        update.context.repository.toLowerCase() === repository.toLowerCase()
      )
        setCheckout(update.checkout)
    })
    void Promise.resolve().then(() => load('get'))
    void window.api.plugins
      .githubCheckout({ serverId, account, repository, branch }, 'status')
      .then((next) => {
        if (mounted.current) setCheckout(next)
      })
      .catch((reason) => {
        if (mounted.current) setError(friendlyError(reason))
      })
    return () => {
      mounted.current = false
      detachHistory()
      detachCheckout()
    }
  }, [load, serverId, account, repository, branch])
  async function action(kind: 'fetch' | 'pull' | 'link' | 'unlink'): Promise<void> {
    setOperation(kind)
    setNotice('')
    setError('')
    let completed = false
    try {
      if (kind !== 'fetch' || checkout) {
        const next = await window.api.plugins.githubCheckout(context, kind)
        if (!mounted.current) return
        setCheckout(next)
        if (kind === 'link' || kind === 'unlink') return
        completed = true
      }
      const next = await window.api.plugins.githubHistory(context, 'fetch')
      if (!mounted.current) return
      setSnapshot(next)
      setNotice(
        kind === 'pull'
          ? 'Pull complete (fast-forward only).'
          : 'Fetched the latest branch history.'
      )
    } catch (reason) {
      if (mounted.current)
        setError(
          (completed
            ? `${kind === 'pull' ? 'Pull' : 'Fetch'} completed, but history could not refresh. `
            : '') + friendlyError(reason)
        )
    } finally {
      if (mounted.current) setOperation('')
    }
  }
  const commits = commitsFrom(snapshot?.commits ?? [])
  const heads = snapshot?.heads ?? []
  const more = snapshot?.more ?? false
  const loaded = snapshot !== null
  const pending = loading || !!operation
  const graph = commitGraph(commits)
  const graphWidth = graph.lanes * 12 + 12
  const detail = commits.find((commit) => commit.sha === selected)
  return (
    <div data-github-history className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] text-muted-foreground">
          GitHub history · {branch}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px]"
            aria-label="Fetch branch history"
            disabled={busy || pending}
            onClick={() => void action('fetch')}
          >
            <Download className="size-3" />
            {operation === 'fetch' ? 'Fetching...' : 'Fetch'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px]"
            aria-label="Pull linked checkout"
            disabled={busy || pending || !checkout}
            onClick={() => void action('pull')}
          >
            <ArrowDownToLine className="size-3" />
            {operation === 'pull' ? 'Pulling...' : 'Pull'}
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-1 px-0 text-[10px] text-muted-foreground"
          disabled={busy || pending}
          onClick={() => void action('link')}
          aria-label="Link local checkout"
        >
          <FolderOpen className="size-3 shrink-0" />
          <span className="truncate" title={checkout?.path}>
            {checkout ? checkout.path : 'Link local checkout to enable Pull'}
          </span>
        </Button>
        {checkout && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Unlink local checkout"
            disabled={busy || pending}
            onClick={() => void action('unlink')}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
      {snapshot && (
        <p className="text-[9px] text-muted-foreground">
          Fetched {new Date(snapshot.fetchedAt).toLocaleTimeString()} · cached until you fetch again
        </p>
      )}
      {notice && (
        <p role="status" className="text-[10px] text-muted-foreground">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status" className="text-[10px] text-muted-foreground">
          Cached history · Fetch and Pull are available when the task finishes.
        </p>
      )}
      {loading && !loaded && (
        <p role="status" className="py-4 text-xs text-muted-foreground">
          Loading branch history…
        </p>
      )}
      {error && (
        <div role="alert" className="text-xs text-destructive">
          {error}{' '}
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={busy || pending}
            onClick={() => void load('fetch')}
          >
            Retry history
          </Button>
        </div>
      )}
      {loaded && !commits.length && !error && (
        <p className="py-4 text-xs text-muted-foreground">This branch has no commits yet.</p>
      )}
      {!!commits.length && (
        <ScrollArea className="h-64" aria-label="Branch commit history">
          <ol className="pr-2">
            {commits.map((commit, index) => {
              const row = graph.rows[index]
              const refs = heads
                .filter((head) => label(object(head.commit).sha) === commit.sha)
                .map((head) => label(head.name))
              if (index === 0 && !refs.includes(branch)) refs.unshift(branch)
              return (
                <li key={commit.sha} className="flex h-11 min-w-0" data-commit-sha={commit.sha}>
                  <svg
                    aria-hidden="true"
                    className="shrink-0"
                    width={Math.min(graphWidth, 108)}
                    height="44"
                    viewBox={`0 0 ${graphWidth} 44`}
                    preserveAspectRatio="none"
                  >
                    {row.edges.map((edge, edgeIndex) => {
                      const x1 = edge.from * 12 + 8,
                        x2 = edge.to * 12 + 8
                      return (
                        <path
                          key={edgeIndex}
                          d={
                            edge.half === 'top'
                              ? `M${x1} 0 L${x2} 22`
                              : `M${x1} 22 C${x1} 34 ${x2} 32 ${x2} 44`
                          }
                          fill="none"
                          stroke={colors[edge.color]}
                          strokeWidth="1.5"
                        />
                      )
                    })}
                    <circle
                      cx={row.lane * 12 + 8}
                      cy="22"
                      r={commit.parents.length > 1 ? 4 : 3}
                      fill="var(--background)"
                      stroke={colors[row.color]}
                      strokeWidth="2"
                    />
                  </svg>
                  <Button
                    variant="ghost"
                    className={`h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 px-1.5 text-left font-normal ${selected === commit.sha ? 'bg-accent' : ''}`}
                    aria-label={`Commit ${commit.sha.slice(0, 7)}: ${commit.message.split('\n')[0]}`}
                    aria-expanded={selected === commit.sha}
                    aria-controls={id}
                    onClick={() => setSelected(selected === commit.sha ? '' : commit.sha)}
                  >
                    <span className="flex w-full min-w-0 items-center gap-1">
                      <span className="truncate text-[11px]" title={commit.message}>
                        {commit.message.split('\n')[0] || 'Untitled commit'}
                      </span>
                      {commit.parents.length > 1 && (
                        <GitMerge className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      {refs.slice(0, 2).map((name) => (
                        <Badge
                          key={name}
                          variant="secondary"
                          title={name}
                          className="max-w-20 gap-0.5 rounded px-1 py-0 text-[9px]"
                        >
                          <GitBranch className="size-2.5 shrink-0" />
                          <span className="truncate">{name}</span>
                        </Badge>
                      ))}
                      {refs.length > 2 && (
                        <span
                          className="text-[9px] text-muted-foreground"
                          title={refs.slice(2).join(', ')}
                        >
                          +{refs.length - 2}
                        </span>
                      )}
                    </span>
                    <span className="flex w-full min-w-0 items-center justify-between gap-2 text-[9px] text-muted-foreground">
                      <span className="truncate">{commit.author}</span>
                      <span className="shrink-0 font-mono">{commit.sha.slice(0, 7)}</span>
                    </span>
                  </Button>
                </li>
              )
            })}
          </ol>
        </ScrollArea>
      )}
      {detail && (
        <div
          id={id}
          aria-label="Commit details"
          className="rounded-lg border border-border bg-muted/20 p-2 text-[10px]"
        >
          <ScrollArea className="max-h-28">
            <p className="whitespace-pre-wrap break-words">{detail.message}</p>
          </ScrollArea>
          <p className="mt-2 text-muted-foreground">
            {detail.author}
            {detail.date && ` · ${new Date(detail.date).toLocaleString()}`}
          </p>
          <p className="mt-1 break-all font-mono text-muted-foreground">{detail.sha}</p>
        </div>
      )}
      {more && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full text-[10px]"
          disabled={busy || pending}
          onClick={() => void load('older')}
        >
          {loading ? 'Loading…' : 'Load older commits'}
        </Button>
      )}
    </div>
  )
}
