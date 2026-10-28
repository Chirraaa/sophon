import { useEffect, useId, useState } from 'react'
import { CircleAlert, Plus, RefreshCw, Trash2, UserRound } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Account = MicrosoftStatus['accounts'][number]

export function MicrosoftConnection(): React.JSX.Element {
  const [status, setStatus] = useState<MicrosoftStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'client' | 'sign-in' | 'select' | null>(null)
  const [removing, setRemoving] = useState<Account | null>(null)
  const fieldId = useId()
  const errorId = useId()
  const hintId = useId()
  const pending = busy === 'sign-in' || Boolean(status?.pending)
  const locked = Boolean(status?.accounts.length)

  const apply = (next: MicrosoftStatus): void => {
    setStatus(next)
    setClientId(next.clientId)
  }
  useEffect(() => {
    let alive = true
    window.api.microsoft
      .status()
      .then((next) => {
        if (alive) apply(next)
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message)
      })
    return () => {
      alive = false
    }
  }, [])

  const run = (kind: NonNullable<typeof busy>, work: () => Promise<MicrosoftStatus>): void => {
    setBusy(kind)
    setError('')
    work()
      .then(apply)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setBusy(null))
  }
  const saveClient = (event: React.FormEvent): void => {
    event.preventDefault()
    const value = clientId.trim()
    if (value && !GUID.test(value)) {
      setFieldError(
        'Enter the Application (client) ID from your Azure app registration, like 00000000-0000-0000-0000-000000000000.'
      )
      return
    }
    setFieldError('')
    run('client', () => window.api.microsoft.setClientId(value))
  }
  const configured = Boolean(status?.clientId)

  return (
    <section className="space-y-4" aria-label="Microsoft accounts">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Microsoft accounts</h3>
        <p className="text-xs text-muted-foreground">
          Connect Outlook and Microsoft 365 accounts so Sophon can read and change your calendar.
          Sign-in happens in your browser; Sophon never sees your password.
        </p>
      </div>

      <form noValidate onSubmit={saveClient} className="space-y-2">
        <label htmlFor={fieldId} className="text-xs font-medium">
          Application (client) ID
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 basis-72">
            <Input
              id={fieldId}
              value={clientId}
              disabled={locked || busy === 'client' || !status}
              spellCheck={false}
              autoComplete="off"
              placeholder="00000000-0000-0000-0000-000000000000"
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? `${errorId} ${hintId}` : hintId}
              className="font-mono text-[11px]"
              onChange={(event) => {
                setClientId(event.target.value)
                setFieldError('')
              }}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={locked || busy !== null || !status || clientId.trim() === status.clientId}
          >
            {busy === 'client' ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {fieldError && (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {fieldError}
          </p>
        )}
        <p id={hintId} className="text-xs text-muted-foreground">
          {locked
            ? 'Remove the connected accounts to change this ID.'
            : 'Register a free app in Azure (Mobile and desktop, redirect http://localhost, personal and work accounts). It has no secret. See docs/MICROSOFT_ACCOUNTS.md.'}
        </p>
      </form>

      {error && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!!status?.accounts.length && (
        <ul className="space-y-2" aria-label="Connected Microsoft accounts">
          {status.accounts.map((account) => {
            const active = account.id === status.activeId
            const ready = account.signedIn && account.calendar
            return (
              <li
                key={account.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4"
              >
                <UserRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">{account.name || account.email}</p>
                  {account.name && account.email && (
                    <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {active && <Badge variant="secondary">Active</Badge>}
                  {!account.signedIn ? (
                    <Badge variant="destructive">Signed out</Badge>
                  ) : !account.calendar ? (
                    <Badge variant="outline">Calendar not allowed</Badge>
                  ) : (
                    <Badge variant="outline">Calendar</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {!active && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || pending}
                      onClick={() => run('select', () => window.api.microsoft.select(account.id))}
                    >
                      Use this account
                    </Button>
                  )}
                  {!ready && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || pending}
                      onClick={() => run('sign-in', () => window.api.microsoft.signIn(account.id))}
                    >
                      <RefreshCw className="size-3.5" /> Reconnect
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null || pending}
                    aria-label={`Remove ${account.email || account.name}`}
                    onClick={() => setRemoving(account)}
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!configured || busy !== null || pending}
          onClick={() => run('sign-in', () => window.api.microsoft.signIn())}
        >
          {pending ? <Spinner className="size-3.5" /> : <Plus className="size-3.5" />}
          {pending
            ? 'Waiting for sign-in in your browser…'
            : status?.accounts.length
              ? 'Add another account'
              : 'Connect a Microsoft account'}
        </Button>
        {pending && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void window.api.microsoft
                .cancel()
                .then(() => window.api.microsoft.status())
                .then(apply)
                .catch((reason: Error) => setError(reason.message))
            }}
          >
            Cancel sign-in
          </Button>
        )}
        {!configured && status && (
          <span className="text-xs text-muted-foreground">Save an application ID first.</span>
        )}
        {!status && !error && (
          <span role="status" className="text-xs text-muted-foreground">
            Checking connections…
          </span>
        )}
      </div>

      <ConfirmationDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.email || removing?.name || 'this account'}?`}
        description="Removes this account's sign-in from Sophon on this computer. Your Microsoft account and its data are not changed. To revoke Sophon's access completely, remove the app under Microsoft account > Privacy > Apps and services."
        confirmLabel="Remove account"
        cancelLabel="Keep account"
        pendingLabel="Removing…"
        onConfirm={async () => {
          if (removing) apply(await window.api.microsoft.remove(removing.id))
        }}
      />
    </section>
  )
}
