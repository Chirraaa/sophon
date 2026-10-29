import { useState } from 'react'
import { Bot, Check, ChevronRight, X } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { AssistantText } from '../AssistantText'

const LABELS: Record<SpecialistId, string> = {
  simple: 'Agent',
  researcher: 'Researcher',
  visual_explainer: 'Visual Explainer',
  tutor: 'Tutor',
  reviewer: 'Reviewer'
}

const STATUS_TEXT: Record<SpecialistRun['status'], string> = {
  running: 'Working…',
  done: 'Returned findings',
  failed: 'Stopped'
}

function StatusIcon({ status }: { status: SpecialistRun['status'] }): React.JSX.Element {
  if (status === 'running') return <Spinner className="size-3 shrink-0" aria-hidden="true" />
  if (status === 'done')
    return <Check className="size-3 shrink-0 text-success" aria-hidden="true" />
  return <X className="size-3 shrink-0 text-destructive" aria-hidden="true" />
}

function AgentRow({ agent }: { agent: SpecialistRun }): React.JSX.Element {
  return (
    <Collapsible className="rounded-lg">
      <CollapsibleTrigger
        showIndicator={false}
        className="group/row w-full min-w-0 gap-2 px-2 py-1.5"
        aria-label={`${LABELS[agent.profile]} subagent: ${STATUS_TEXT[agent.status]}. ${agent.task}`}
      >
        <StatusIcon status={agent.status} />
        <span className="shrink-0 font-medium text-foreground">{LABELS[agent.profile]}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{agent.task}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {agent.modelCalls} {agent.modelCalls === 1 ? 'call' : 'calls'}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/row:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mx-2 mb-2 space-y-3 border-t border-border pt-2 text-muted-foreground">
          <div>
            <p className="mb-1 font-medium text-foreground">Assignment</p>
            <p className="whitespace-pre-wrap">{agent.task}</p>
          </div>
          {agent.summary ? (
            <div className="selectable">
              <p className="mb-1 font-medium text-foreground">
                {agent.status === 'failed' ? 'Why it stopped' : 'Findings for the main assistant'}
              </p>
              <AssistantText text={agent.summary} />
            </div>
          ) : (
            <p>Findings will appear here when the subagent returns.</p>
          )}
          <p>
            Peak input: about {agent.estimatedInputTokens.toLocaleString()} tokens. Findings use the
            same model and may need verification.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SubagentPanel({ agents }: { agents: SpecialistRun[] }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const finished = agents.filter((agent) => agent.status !== 'running').length
  const failed = agents.filter((agent) => agent.status === 'failed').length
  const working = finished < agents.length
  const rows = agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)
  const shell = 'w-full rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground'
  if (agents.length === 1)
    return (
      <div className={shell} aria-label="Subagents" aria-live="polite">
        {rows}
      </div>
    )
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={shell}>
      <div aria-label="Subagents" aria-live="polite">
        <CollapsibleTrigger className="w-full min-w-0 gap-2 px-3 py-2">
          <Bot className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="font-medium text-foreground">Subagents</span>
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {working
              ? `${finished} of ${agents.length} done`
              : `${agents.length} returned${failed ? ` · ${failed} stopped` : ''}`}
          </span>
          {working && (
            <Progress
              value={(finished / agents.length) * 100}
              aria-label="Subagents finished"
              className="w-16 shrink-0"
              trackClassName="h-1"
            />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea
            className="max-h-64 border-t border-border"
            viewportClassName="overscroll-contain"
          >
            <div className="flex flex-col p-1">{rows}</div>
          </ScrollArea>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
