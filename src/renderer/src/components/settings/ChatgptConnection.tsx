import { useEffect, useState } from 'react'
import { Row, PillButton, SelectField, Notice } from './controls'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction
} from '@/components/ui/alert-dialog'

export function ChatgptConnection({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<ChatgptStatus | null>(null)
  const [operation, setOperation] = useState<'signIn' | 'select' | 'signOut' | null>(null)
  const busy = operation !== null || Boolean(status?.pending)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.api.chatgpt
      .status()
      .then((value) => {
        if (alive) setStatus(value)
      })
      .catch((reason) => {
        if (alive) setError(reason.message)
      })
    return () => {
      alive = false
    }
  }, [])
  const update = (next: ChatgptStatus): void => {
    setStatus(next)
    onChanged()
  }
  const signIn = (accountId?: string): void => {
    setOperation('signIn')
    setError('')
    void window.api.chatgpt
      .signIn(accountId)
      .then(update)
      .catch((reason) => setError(reason.message))
      .finally(() => setOperation(null))
  }
  const active = status?.accounts.find((account) => account.id === status.activeId)
  return (
    <>
      <Row
        label="ChatGPT account"
        hint={
          active?.planEnabled
            ? 'Your ChatGPT plan is connected.'
            : 'Use your eligible ChatGPT Plus or Pro plan. Sign-in opens your browser; no API key is needed.'
        }
        stack
      >
        <div className="flex flex-wrap items-center gap-2">
          {Boolean(status?.accounts.length) && (
            <SelectField
              value={status?.activeId ?? ''}
              options={[
                { value: '', label: 'Choose a saved connection' },
                ...status!.accounts.map((account) => ({
                  value: account.id,
                  label: `${account.email || 'ChatGPT account'} · ${account.label}`
                }))
              ]}
              onChange={(id) => {
                if (!id || busy) return
                setOperation('select')
                setError('')
                void window.api.chatgpt
                  .select(id)
                  .then(update)
                  .catch((reason) => setError(reason.message))
                  .finally(() => setOperation(null))
              }}
            />
          )}
          {!active?.planEnabled && (
            <PillButton disabled={busy || !status} onClick={() => signIn(active?.id)}>
              {operation === 'signIn'
                ? 'Waiting for sign-in…'
                : active
                  ? 'Reconnect with ChatGPT'
                  : 'Continue with ChatGPT'}
            </PillButton>
          )}
          {!status && !error && (
            <span role="status" className="text-xs text-muted-foreground">
              Checking connection…
            </span>
          )}
          {active?.signedIn && (
            <PillButton
              disabled={busy}
              onClick={() => {
                setOperation('signOut')
                setError('')
                void window.api.chatgpt
                  .signOut()
                  .then((result) => {
                    update(result.status)
                    if (!result.revoked)
                      setError(
                        'Signed out locally. Remote revocation could not be confirmed; disconnect Sophon in ChatGPT settings if needed.'
                      )
                  })
                  .catch((reason) => setError(reason.message))
                  .finally(() => setOperation(null))
              }}
            >
              Sign out
            </PillButton>
          )}
          {(operation === 'signIn' || status?.pending) && (
            <PillButton
              onClick={() => {
                void window.api.chatgpt
                  .cancel()
                  .then(() => window.api.chatgpt.status())
                  .then(update)
                  .catch((reason) => setError(reason.message))
              }}
            >
              Cancel sign-in
            </PillButton>
          )}
        </div>
        {active?.planEnabled ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Using ChatGPT plan · {active.email || active.label}
          </p>
        ) : active?.signedIn ? (
          <Notice>
            Signed in, but ChatGPT plan usage is not enabled. Reconnect with ChatGPT to authorize
            it.
          </Notice>
        ) : null}
        {active?.planEnabled && (
          <div className="mt-2">
            <PillButton
              onClick={() => {
                void window.api.chatgpt.manageUsage().catch((reason) => setError(reason.message))
              }}
            >
              Manage usage
            </PillButton>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Usage counts toward your ChatGPT plan or credits and shares its limits. Your Codex login
          and ChatGPT conversations stay separate.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </Row>
      <AlertDialog open={Boolean(status?.welcome)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You’re using your ChatGPT plan</AlertDialogTitle>
            <AlertDialogDescription>
              Eligible requests in Sophon use your ChatGPT plan or credits. Review usage and app
              limits in ChatGPT settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                void window.api.chatgpt
                  .acknowledgeWelcome()
                  .then(() =>
                    setStatus((current) => (current ? { ...current, welcome: false } : current))
                  )
                  .catch((reason) => setError(reason.message))
              }}
            >
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
