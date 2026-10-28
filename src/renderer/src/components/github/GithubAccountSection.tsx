import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { PluginState } from '../../../../shared/plugins'
import { GithubForm } from './GithubFeedback'
import { GithubSignIn } from './GithubSignIn'

type Server = PluginState['servers'][number]

export function GithubAccountSection({
  busy,
  ready,
  server,
  servers,
  serverId,
  accountLabels,
  token,
  setToken,
  addingAccount,
  setAddingAccount,
  perform,
  connect,
  refreshAccount,
  disconnect,
  onSignedIn,
  onSelect,
  onRemoved
}: {
  busy: boolean
  ready: boolean
  server: Server | undefined
  servers: Server[]
  serverId: string
  accountLabels: Map<string, string>
  token: string
  setToken: (token: string) => void
  addingAccount: boolean
  setAddingAccount: (adding: boolean) => void
  perform: (action: () => Promise<void>) => Promise<void>
  connect: (savedId?: string) => Promise<void>
  refreshAccount: () => Promise<void>
  disconnect: () => Promise<void>
  onSignedIn: (id: string) => Promise<void>
  onSelect: (id: string) => void
  onRemoved: (next: PluginState) => void
}): React.JSX.Element {
  const [removingAccount, setRemovingAccount] = useState(false)
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-label="GitHub account">
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
        <GithubSignIn disabled={busy} onConnected={onSignedIn} hasSavedAccount={!!server} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {servers.length > 0 && (
          <Select disabled={busy} value={serverId} onValueChange={(value) => onSelect(value ?? '')}>
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
            <Button variant="outline" size="sm" onClick={() => void perform(refreshAccount)}>
              Refresh account
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void perform(disconnect)}>
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
                  In GitHub Settings → Developer settings → Personal access tokens → Fine-grained
                  tokens, create a token with “Only select repositories” and choose the repositories
                  you want Sophon to access. Enable Contents, Pull requests and Issues as needed
                  (read and write for pushes and comments). Leave Administration and other unrelated
                  permissions disabled. This connection uses exactly the access you grant on GitHub;
                  Sophon cannot narrow an existing token’s permissions.
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
        onConfirm={async () => onRemoved(await window.api.plugins.removeServer(serverId))}
      />
      <p className="text-xs text-muted-foreground">
        Accounts are saved securely on this computer. Actions use the selected account’s GitHub
        permissions and run when you click their button.
      </p>
    </section>
  )
}
