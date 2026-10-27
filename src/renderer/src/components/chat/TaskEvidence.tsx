import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
const OUTCOME: Record<WorkflowOutcome, string> = {
  running: 'In progress',
  answered: 'Answer delivered',
  actions_checked: 'Action checks passed',
  needs_review: 'Needs review',
  blocked: 'Stopped after denial',
  interrupted: 'Interrupted'
}
const STATUS: Record<EvidenceStatus, string> = {
  pending: 'Awaiting result',
  observed: 'Data received',
  reported: 'Reported by tool',
  verified: 'Checked',
  failed: 'Failed',
  denied: 'Denied',
  uncertain: 'Outcome uncertain'
}
export function TaskEvidence({
  state,
  onResume
}: {
  state: WorkflowState
  onResume?: () => void
}): React.JSX.Element {
  return (
    <Collapsible className="selectable min-w-0 max-w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">
      <CollapsibleTrigger>Task evidence · {OUTCOME[state.outcome]}</CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 whitespace-pre-wrap break-words">
          <span className="font-medium">Goal: </span>
          {state.goal}
        </p>
        <p className="mt-2">{state.nextStep}</p>
        {state.evidence.length > 0 ? (
          <ol className="mt-3 space-y-2">
            {state.evidence.map((e) => (
              <li key={e.actionId} className="rounded-lg border border-border p-2">
                <p>
                  {e.tool}
                  {e.target ? ` · ${e.target}` : ''} · {STATUS[e.status]}
                </p>
                <p className="mt-1 break-words">{e.summary}</p>
                <p className="mt-1 text-[10px]">
                  Observed {new Date(e.at).toLocaleString()} · action {e.actionId.slice(0, 8)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2">No tool action has a recorded result.</p>
        )}
        {state.omittedEvidence > 0 && (
          <p className="mt-2">
            {state.omittedEvidence} older entries omitted from this checkpoint; original action
            records remain in the conversation.
          </p>
        )}
        <p className="mt-2">
          Checks apply to the recorded action at that time, not to the whole task or the current
          state of your PC.
        </p>
        {onResume && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onResume}>
            Continue task
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
