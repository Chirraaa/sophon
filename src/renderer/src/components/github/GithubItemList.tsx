import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { object, label, type Row } from './data'

export type GithubTab = 'branches' | 'commits' | 'pulls' | 'push'

export function GithubItemList({
  tab,
  items,
  loaded,
  busy,
  error,
  page,
  perform,
  reload,
  selectBranch,
  showComments
}: {
  tab: GithubTab
  items: Row[]
  loaded: boolean
  busy: boolean
  error: string
  page: number
  perform: (action: () => Promise<void>) => Promise<void>
  reload: (page: number) => Promise<void>
  selectBranch: (name: string) => Promise<void>
  showComments: (number: number) => Promise<void>
}): React.JSX.Element {
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void perform(() => reload(1))}>
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
          <p className="p-6 text-center text-sm text-muted-foreground">No results on this page.</p>
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
                {item.protected === true && <Badge variant="outline">Protected</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void perform(() => selectBranch(label(item.name)))}
                >
                  Select
                </Button>
              </div>
            )}
            {tab === 'pulls' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void perform(() => showComments(Number(item.number)))}
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
            onClick={() => void perform(() => reload(page - 1))}
          >
            Previous
          </Button>
          Page {page}
          <Button
            size="sm"
            variant="ghost"
            disabled={items.length < 20}
            onClick={() => void perform(() => reload(page + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </>
  )
}
