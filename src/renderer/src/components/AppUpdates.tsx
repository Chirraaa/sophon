import { useState } from 'react'
import { ArrowDownToLine, CircleCheck, RefreshCw, Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppRelease } from '../../../shared/updates'
import { useUpdates } from '@/hooks/useUpdates'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Progress } from './ui/progress'
import { Alert, AlertDescription } from './ui/alert'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import { ScrollArea } from './ui/scroll-area'

function bytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function ReleaseNotes({ release }: { release: AppRelease }): React.JSX.Element {
  const { openLink } = useUpdates()
  return (
    <div className="release-notes chat-markdown selectable text-sm leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          // Public release descriptions are untrusted content. No raw HTML,
          // embedded images or remote resources are loaded into the renderer.
          img: ({ alt }) => <span className="text-muted-foreground">{alt}</span>,
          a: ({ href, children }) =>
            href?.startsWith('https://') ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  openLink(href)
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            )
        }}
      >
        {release.notes ||
          'This version is ready to use. See the full release on GitHub for more details.'}
      </ReactMarkdown>
    </div>
  )
}

function UpdateError(): React.JSX.Element | null {
  const { state, error } = useUpdates()
  const message = error || state?.error
  return message ? (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null
}

function UpdateControls(): React.JSX.Element | null {
  const { state, run } = useUpdates()
  if (!state) return null
  if (state.status === 'downloading')
    return (
      <div className="w-full space-y-2" role="status">
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>
            {state.progress
              ? `${bytes(state.progress.transferred)} of ${bytes(state.progress.total)} · ${bytes(state.progress.bytesPerSecond)}/s`
              : 'Preparing download…'}
          </span>
          <span className="tabular-nums">{Math.floor(state.progress?.percent ?? 0)}%</span>
        </div>
        <Progress value={state.progress?.percent ?? null} aria-label="Update download progress" />
        <p className="text-xs text-muted-foreground">
          You can keep using Sophon while the update downloads.
        </p>
      </div>
    )
  if (state.status === 'ready' || state.status === 'installing')
    return (
      <Button
        size="sm"
        disabled={state.status === 'installing'}
        onClick={() => void run('install')}
      >
        <RefreshCw className={state.status === 'installing' ? 'animate-spin' : ''} />
        {state.status === 'installing' ? 'Restarting…' : 'Restart & install'}
      </Button>
    )
  if (state.release && ['available', 'error'].includes(state.status))
    return (
      <Button size="sm" onClick={() => void run('download')}>
        <ArrowDownToLine />
        {state.status === 'error' ? 'Retry download' : 'Download update'}
      </Button>
    )
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={['disabled', 'checking'].includes(state.status)}
      onClick={() => void run('check')}
    >
      <RefreshCw className={state.status === 'checking' ? 'animate-spin' : ''} />
      {state.status === 'checking'
        ? 'Checking…'
        : state.status === 'error'
          ? 'Try again'
          : 'Check for updates'}
    </Button>
  )
}

export function UpdatesSettings(): React.JSX.Element {
  const { state, openLink } = useUpdates()
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card/40 p-5"
      aria-label="App updates"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Sophon updates</h3>
          <p className="text-xs text-muted-foreground">
            {state ? `Version ${state.currentVersion}` : 'Loading update status…'}
          </p>
        </div>
        <UpdateControls />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground" role="status">
        {state?.status === 'disabled'
          ? 'Automatic updates are available in the installed Windows app. This build does not install updates.'
          : state?.status === 'ready'
            ? `Version ${state.release?.version} is ready. Restart when you are ready to install it.`
            : state?.status === 'available'
              ? `Version ${state.release?.version} is available.`
              : state?.status === 'idle' && state.checkedAt
                ? 'You’re up to date.'
                : 'Sophon checks public GitHub releases at startup and every six hours. You choose when to download and restart.'}
      </p>
      <UpdateError />
      <Button
        variant="link"
        size="sm"
        className="px-0"
        onClick={() => openLink('https://github.com/Chirraaa/sophon/releases')}
      >
        View releases on GitHub
      </Button>
    </section>
  )
}

export function AppUpdates({ canShowNotes }: { canShowNotes: boolean }): React.JSX.Element | null {
  const { state, run, openLink } = useUpdates()
  const [hiddenVersion, setHiddenVersion] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  if (!state) return null
  const installed = canShowNotes ? state.installedRelease : null
  const release = installed ?? (showPreview ? state.release : null)
  const showBanner =
    state.release &&
    (hiddenVersion !== state.release.version ||
      ['downloading', 'ready', 'installing', 'error'].includes(state.status))
  return (
    <>
      {showBanner && (
        <div
          className="mx-3 mb-2 space-y-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
          aria-label="App update"
        >
          <div className="flex flex-wrap items-center gap-3">
            {state.status === 'ready' ? (
              <CircleCheck className="size-4 text-primary" />
            ) : (
              <Sparkles className="size-4 text-primary" />
            )}
            <div className="min-w-0 flex-1" role="status">
              <p className="text-sm font-medium">
                {state.status === 'ready'
                  ? 'Your update is ready'
                  : state.status === 'downloading'
                    ? 'Downloading Sophon'
                    : 'A new version of Sophon is available'}
              </p>
              <p className="text-xs text-muted-foreground">
                Version {state.release?.version}
                {state.status === 'ready' ? ' · Restart when it suits you.' : ''}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(true)}>
              What’s new
            </Button>
            {state.status !== 'downloading' && <UpdateControls />}
            {state.status === 'available' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remind me later"
                onClick={() => setHiddenVersion(state.release!.version)}
              >
                <X />
              </Button>
            )}
          </div>
          {state.status === 'downloading' && <UpdateControls />}
          <UpdateError />
        </div>
      )}
      <Dialog
        open={Boolean(release)}
        onOpenChange={(open) => {
          if (!open) {
            if (installed) void run('acknowledge')
            else setShowPreview(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl gap-5" closeLabel="Close release notes">
          {release && (
            <>
              <div className="space-y-3 pr-7">
                <Badge variant="secondary">
                  <Sparkles className="mr-1 size-3" />
                  {installed ? 'Update installed' : 'What’s new'} · {release.version}
                </Badge>
                <DialogTitle className="text-xl font-medium tracking-tight">
                  {release.title || `Sophon ${release.version}`}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {installed
                    ? 'You’re on the latest installed version. Here’s what changed.'
                    : 'Here’s what’s included in this update.'}
                </DialogDescription>
              </div>
              <ScrollArea className="min-h-0 flex-1" contentClassName="pr-3 pb-1">
                <ReleaseNotes release={release} />
              </ScrollArea>
              <UpdateError />
              <div className="flex justify-between gap-3 border-t border-border pt-4">
                <Button variant="ghost" onClick={() => openLink(release.url)}>
                  View on GitHub
                </Button>
                <Button
                  onClick={() => {
                    if (installed) void run('acknowledge')
                    else setShowPreview(false)
                  }}
                >
                  {installed ? 'Let’s go' : 'Done'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
