import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { GithubError } from './GithubFeedback'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GithubSignIn as Attempt } from '../../../../shared/plugins'

export function GithubSignIn({
  onConnected,
  disabled,
  hasSavedAccount = false
}: {
  onConnected: (id: string) => Promise<void>
  disabled: boolean
  hasSavedAccount?: boolean
}): React.JSX.Element {
  const [clientId, setClientId] = useState(() => {
    try {
      return localStorage.getItem('sophon.githubOAuthClientId') ?? ''
    } catch {
      return ''
    }
  })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const connected = useRef(onConnected)
  useEffect(() => {
    connected.current = onConnected
  }, [onConnected])
  useEffect(() => {
    mounted.current = true
    void window.api.plugins
      .githubSignInConfigured()
      .then((value) => {
        if (mounted.current) setConfigured(value)
      })
      .catch((e: Error) => {
        if (mounted.current) {
          setConfigured(false)
          setError(e.message)
        }
      })
    return () => {
      mounted.current = false
    }
  }, [])
  const validClientId = /^[A-Za-z0-9_.-]{6,200}$/.test(clientId.trim())
  const canSignIn = configured === true || (configured === false && validClientId)
  useEffect(() => {
    if (!attempt) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function poll(): Promise<void> {
      try {
        const result = await window.api.plugins.githubPollSignIn(attempt!.id)
        if (!active) return
        if (result.serverId) {
          await connected.current(result.serverId)
          if (active) setAttempt(null)
        } else timer = setTimeout(() => void poll(), result.pollAfterMs ?? 5000)
      } catch (reason) {
        if (active) {
          setError((reason as Error).message)
          setAttempt(null)
        }
      }
    }
    timer = setTimeout(() => void poll(), attempt.pollAfterMs)
    return () => {
      active = false
      clearTimeout(timer)
      void window.api.plugins.githubCancelSignIn(attempt.id).catch(() => {})
    }
  }, [attempt])
  return (
    <div className="space-y-3 border-b border-border pb-4">
      <div>
        <h2 className="text-sm font-medium">
          {hasSavedAccount ? 'Add another GitHub account' : 'Connect your GitHub account'}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasSavedAccount
            ? 'Sign in in your browser. To add a different account, switch to that account on GitHub before entering the code. Existing accounts stay saved.'
            : 'Sign in securely in your browser to work with public repositories. Private repository and private profile access are not requested.'}
        </p>
      </div>
      {attempt ? (
        <div className="space-y-3 rounded-lg bg-muted/40 p-4" role="status">
          <p className="text-sm">Enter this code on github.com/login/device:</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-md border border-border bg-background px-4 py-2 text-lg tracking-widest select-all">
              {attempt.userCode}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void window.api.copyText(attempt.userCode).catch((e: Error) => setError(e.message))
              }}
            >
              Copy code
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAttempt(null)}>
              Cancel sign-in
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Waiting for GitHub authorization. This code expires at{' '}
            {new Date(attempt.expiresAt).toLocaleTimeString()}.
          </p>
        </div>
      ) : (
        <Button
          disabled={disabled || starting || !canSignIn}
          onClick={() => {
            setStarting(true)
            setError('')
            try {
              if (validClientId) localStorage.setItem('sophon.githubOAuthClientId', clientId.trim())
            } catch {
              /* The public client ID can still be used without local persistence. */
            }
            void window.api.plugins
              .githubSignIn(configured ? '' : clientId)
              .then((next) => {
                if (mounted.current) setAttempt(next)
                else void window.api.plugins.githubCancelSignIn(next.id).catch(() => {})
              })
              .catch((e: Error) => {
                if (mounted.current) setError(e.message)
              })
              .finally(() => {
                if (mounted.current) setStarting(false)
              })
          }}
        >
          <ExternalLink className="size-4" />
          {starting ? 'Opening GitHub…' : 'Sign in with GitHub'}
        </Button>
      )}
      {error && <GithubError error={error} />}
      {!attempt && configured === false && (
        <Collapsible
          defaultOpen={configured === false ? true : undefined}
          className="text-xs text-muted-foreground"
        >
          <CollapsibleTrigger className="w-fit cursor-pointer">OAuth app setup</CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 max-w-md space-y-2">
              <p>
                {configured === false
                  ? 'Browser sign-in needs a GitHub OAuth app registered for Sophon. '
                  : ''}
                Register it in GitHub Settings → Developer settings → OAuth Apps, enable Device
                Flow, then paste the public client ID below. This is app setup, not your GitHub
                username or access token. No client secret is needed. The public ID is remembered on
                this computer. Developers can also set SOPHON_GITHUB_CLIENT_ID when launching
                Sophon.
              </p>
              <Input
                aria-label="GitHub OAuth client ID"
                placeholder="Public OAuth client ID"
                value={clientId}
                disabled={starting}
                onChange={(e) => setClientId(e.target.value)}
                maxLength={200}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
