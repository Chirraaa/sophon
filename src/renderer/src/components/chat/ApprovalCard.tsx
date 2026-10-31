import { Kbd } from '@/components/ui/kbd'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionPreview } from './ActionPreview'
import { useSession } from '@/hooks/useSession'
import { AgentDot } from './Agents'

function actionTitle(action: ToolAction): string {
  const verbs = {
    edit_file: 'edit',
    write_file: 'write',
    read_file: 'read',
    create_directory: 'create'
  }
  if (Object.hasOwn(verbs, action.name)) {
    try {
      const preview = action.preview ?? ''
      const path = JSON.parse(preview.slice(preview.indexOf('{'))).arguments?.path
      if (typeof path === 'string' && path)
        return `${verbs[action.name as keyof typeof verbs]} ${path.split(/[\\/]/).pop()}`
    } catch {
      /* Legacy previews can be plain text. */
    }
  }
  return action.label.charAt(0).toLowerCase() + action.label.slice(1)
}

export function ApprovalCard({ action }: { action: ToolAction }): React.JSX.Element {
  const titleId = useId()
  const [reviewAlways, setReviewAlways] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const card = useRef<HTMLElement>(null)
  const decide = useCallback(
    async (decision: ApprovalDecision): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setSubmitting(true)
      setError('')
      try {
        await window.api.approve(action.id, decision)
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Could not send your decision. Try again.'
        )
      } finally {
        inFlight.current = false
        setSubmitting(false)
      }
    },
    [action.id]
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing || !document.hasFocus())
        return
      if (
        document.querySelector(
          'dialog:modal, [role="dialog"], [role="alertdialog"], [role="listbox"]'
        )
      )
        return
      if (document.querySelector('[data-approval-card]') !== card.current) return
      const target = event.target as HTMLElement | null
      const typing = target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
      )
      if (typing) return
      if (
        event.key === 'Enter' &&
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey
      ) {
        event.preventDefault()
        if (!reviewAlways) void decide('once')
      } else if (!typing && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        if (event.key === '1') {
          event.preventDefault()
          void decide('deny')
        } else if (!reviewAlways && event.key === '2' && action.canAlwaysAllow) {
          event.preventDefault()
          setReviewAlways(true)
        } else if (!reviewAlways && event.key === '3') {
          event.preventDefault()
          void decide('once')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [action.canAlwaysAllow, decide, reviewAlways])
  const buttonClass = 'no-drag h-7 rounded-md px-2.5 text-xs font-normal'
  return (
    <section
      ref={card}
      data-approval-card
      aria-labelledby={titleId}
      aria-busy={submitting}
      className="no-drag min-w-0 overflow-hidden rounded-xl border border-border bg-popover p-3.5 text-foreground shadow-sm"
    >
      <h3
        id={titleId}
        className="text-[13px] font-semibold leading-5 [overflow-wrap:anywhere]"
        role="status"
      >
        Allow Sophon to {actionTitle(action)}?
      </h3>
      <ScrollArea
        className="mt-2 max-h-[min(32vh,240px)]"
        contentClassName="text-xs text-foreground/70"
      >
        <ActionPreview preview={action.preview} />
      </ScrollArea>
      {reviewAlways ? (
        <div className="mt-3 space-y-3 text-xs">
          <p className="text-foreground/75">
            Always allow “{action.label}” in every chat without asking again. This applies to all
            targets this tool can access, including private data or changes to your work. You can
            change it in Settings &gt; Permissions.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              className={buttonClass}
              variant="secondary"
              disabled={submitting}
              onClick={() => setReviewAlways(false)}
            >
              Back
            </Button>
            <Button
              className={buttonClass}
              disabled={submitting}
              onClick={() => void decide('always')}
            >
              Always allow this tool
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            className={buttonClass}
            variant="secondary"
            disabled={submitting}
            onClick={() => void decide('deny')}
          >
            Deny <Kbd className="font-sans opacity-45">1</Kbd>
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            {action.canAlwaysAllow && (
              <Button
                className={buttonClass}
                variant="secondary"
                disabled={submitting}
                onClick={() => setReviewAlways(true)}
              >
                Always allow <Kbd className="font-sans opacity-45">2</Kbd>
              </Button>
            )}
            <Button
              className={buttonClass}
              disabled={submitting}
              onClick={() => void decide('once')}
            >
              Allow once <Kbd className="font-sans opacity-45">3</Kbd>
              <Kbd className="ml-1 font-sans text-[10px] opacity-50">Ctrl+Enter</Kbd>
            </Button>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        One-use approval expires after 90 seconds or when stopped.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

// One approval at a time, since each card answers keyboard shortcuts: this thread's own
// first, then those waiting in the chat's other threads (its agents, or the main task).
export function ApprovalRequests({ items }: { items: ChatItem[] }): React.JSX.Element | null {
  const { approvals = [] } = useSession()
  const action = items
    .flatMap((item) => (item.pending ? item.actions : []))
    .find((candidate) => candidate.status === 'waiting')
  if (action)
    return (
      <div className="mb-2">
        <ApprovalCard key={action.id} action={action} />
      </div>
    )
  const other = approvals[0]
  if (!other) return null
  return (
    <div className="mb-2">
      <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <AgentDot color={other.color} />
        {other.handle === 'main' ? 'The main task' : `Agent ${other.handle} · ${other.title}`} is
        asking
        {approvals.length > 1 && <span>· {approvals.length - 1} more waiting</span>}
      </p>
      <ApprovalCard key={other.action.id} action={other.action} />
    </div>
  )
}
