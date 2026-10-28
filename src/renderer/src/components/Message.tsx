import { Spinner } from '@/components/ui/spinner'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'
import { ActionHistory } from './chat/ActionHistory'
import { DesktopResults } from './chat/DesktopCards'
import { AssistantText } from './AssistantText'
import { AttachmentView } from './chat/AttachmentView'
import { useState } from 'react'
import { useSession } from '@/hooks/useSession'
import { useSettings } from '@/hooks/useSettings'
import { VISUAL_FENCE } from '../../../shared/visuals'
import { TaskEvidence } from './chat/TaskEvidence'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Pencil, RotateCw } from 'lucide-react'
import { CopyButton } from './chat/CopyButton'
import { useStreamingText } from '@/hooks/useStreamingText'
import { PageLink } from './chat/PageLink'
import { replyActivity } from '@/lib/activity'
import { ResearchActivity } from './chat/ResearchActivity'
import { Bot, Check } from 'lucide-react'
import { questionsFromReply } from '../../../shared/questions'
import { CodingRun } from './chat/CodingRun'
import { Hint } from './ui/tooltip'
import { ContextDetails } from './chat/ContextDetails'
import { contextSummary } from '@/lib/context'
import { UsageDetails } from './chat/UsageDetails'
export function Message({
  item,
  dockQuestions = false,
  hideCoding = false
}: {
  item: ChatItem
  dockQuestions?: boolean
  hideCoding?: boolean
}): React.JSX.Element {
  const { busy, items, chatId } = useSession()
  const showDiagnostics = useSettings()?.showResponseDiagnostics === true
  const visibleText = useStreamingText(item.text, Boolean(item.pending))
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const [saving, setSaving] = useState(false)
  const repeat = async (text: string): Promise<void> => {
    const wasEditing = editing
    setError(null)
    setSaving(true)
    try {
      await window.api.rerun(chatId, item.id, text)
      setEditing(false)
    } catch (error) {
      setEditing(wasEditing)
      setError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const ask = (question: string): void => {
    setError(null)
    void window.api.send(question).catch((error: Error) => setError(error.message))
  }
  const you = item.from === 'you'
  const isQuestion = !you && dockQuestions && !!questionsFromReply(item.text)
  const showBubble = !isQuestion && (Boolean(item.text) || item.pending)
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className={cn('min-w-0 flex flex-col gap-2', you ? 'items-end' : 'items-start')}
    >
      {!you && !hideCoding && item.workflow?.codingSession && (
        <CodingRun
          item={item}
          onResume={
            !busy &&
            items.at(-1)?.id === item.id &&
            ['needs_review', 'interrupted'].includes(item.workflow.outcome)
              ? () => ask('Continue the previous task.')
              : undefined
          }
        />
      )}
      {!you && (item.actions.length > 0 || !!item.attachments?.length) && (
        <ActionHistory actions={item.actions} attachments={item.attachments} />
      )}
      {!you && <DesktopResults actions={item.actions} />}
      {!you && <ResearchActivity item={item} />}
      {!!item.specialists?.length && (
        <div
          className="flex w-full flex-col gap-2"
          aria-label="Specialist consultations"
          aria-live="polite"
        >
          {item.specialists.map((agent) => (
            <Collapsible
              key={agent.id}
              className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            >
              <CollapsibleTrigger className="flex cursor-pointer items-center gap-2">
                <Bot className="size-4 text-primary" aria-hidden="true" />
                {agent.status === 'running' ? (
                  <Spinner className="size-3" aria-hidden="true" />
                ) : agent.status === 'done' ? (
                  <Check className="size-3 text-emerald-400" aria-hidden="true" />
                ) : null}
                <span className="font-medium text-foreground">
                  {
                    {
                      researcher: 'Researcher',
                      visual_explainer: 'Visual Explainer',
                      tutor: 'Tutor',
                      reviewer: 'Reviewer'
                    }[agent.profile]
                  }
                </span>{' '}
                ·{' '}
                {agent.status === 'running'
                  ? 'Working…'
                  : agent.status === 'done'
                    ? 'Returned findings'
                    : 'Stopped'}{' '}
                · {agent.modelCalls} model {agent.modelCalls === 1 ? 'call' : 'calls'}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1 font-medium text-foreground">Assignment</p>
                  <p className="whitespace-pre-wrap">{agent.task}</p>
                </div>
                {agent.summary ? (
                  <div className="selectable mt-3">
                    <p className="mb-1 font-medium text-foreground">
                      Findings for the main assistant
                    </p>
                    <AssistantText text={agent.summary} />
                  </div>
                ) : (
                  <p className="mt-3">Findings will appear here when the subagent returns.</p>
                )}
                <p className="mt-2">
                  Peak input: about {agent.estimatedInputTokens.toLocaleString()} tokens. Findings
                  use the same model and may need verification.
                </p>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
      {you && !!item.attachments?.length && (
        <div className="flex max-w-[90%] flex-wrap gap-2">
          {item.attachments.map((attachment) => (
            <AttachmentView key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      {you && editing ? (
        <div className="w-full max-w-[88%] space-y-2 rounded-[18px] rounded-br-md border border-border bg-white/8 p-3">
          <Textarea
            aria-label="Edit prompt"
            aria-describedby={`edit-help-${item.id}`}
            maxLength={32000}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape' && !saving) setEditing(false)
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                if (!busy && !saving && (draft.trim() || item.attachments?.length))
                  void repeat(draft)
              }
            }}
            autoFocus
          />
          <p id={`edit-help-${item.id}`} className="text-xs text-muted-foreground">
            Saving reruns this prompt and replaces later messages. Requested actions may run again.
          </p>
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || saving || (!draft.trim() && !item.attachments?.length)}
              onClick={() => void repeat(draft)}
            >
              {saving ? 'Saving…' : 'Save and rerun'}
            </Button>
          </div>
        </div>
      ) : (
        showBubble && (
          <div
            className={cn(
              'selectable min-w-0 max-w-[88%] break-words rounded-[18px] px-4 py-3 text-[13px] leading-6',
              you
                ? 'whitespace-pre-wrap rounded-br-md border border-white/8 bg-white/8 text-foreground'
                : 'w-full max-w-full rounded-bl-md border border-border bg-muted/10',
              !you &&
                VISUAL_FENCE.test(item.text) &&
                'w-full max-w-full border-0 bg-transparent px-0'
            )}
          >
            {item.text ? (
              you ? (
                item.text
              ) : (
                <AssistantText
                  text={visibleText}
                  questionsEnabled={items.at(-1)?.id === item.id}
                  streaming={item.pending || visibleText !== item.text}
                  onAsk={busy ? undefined : ask}
                />
              )
            ) : (
              <div className="flex items-center gap-2">
                <Spinner className="my-1.5 text-muted-foreground" />
                <span role="status" className="text-xs text-muted-foreground">
                  {replyActivity(item)}
                </span>
              </div>
            )}
          </div>
        )
      )}
      {!you && item.text && !isQuestion && !(item.pending && VISUAL_FENCE.test(item.text)) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CopyButton text={item.text} />
          {item.pending && <span role="status">{replyActivity(item)}</span>}
        </div>
      )}
      {!you && !item.pending && item.quality === 'reviewed' && (
        <Hint text="A second pass checked the draft against the request and available evidence. It uses the same model and does not guarantee correctness.">
          <p className="text-xs text-muted-foreground">Answer reviewed · same model</p>
        </Hint>
      )}
      {you && !editing && (
        <div className="flex items-center gap-1">
          <CopyButton text={item.text} label="Copy message" />
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy || saving}
            aria-label="Edit prompt"
            title="Edit prompt"
            onClick={() => {
              setDraft(item.text)
              setEditing(true)
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy || saving}
            aria-label="Rerun prompt"
            title="Rerun in this chat, replacing the response and later messages"
            onClick={() => void repeat(item.text)}
          >
            <RotateCw />
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {showDiagnostics && item.context && !you && (
        <Collapsible className="max-w-[88%] text-xs text-muted-foreground">
          <CollapsibleTrigger>Context used · {contextSummary(item.context)}</CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3">
              <ContextDetails report={item.context} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {showDiagnostics && item.usage && !you && (
        <Collapsible className="max-w-[88%] text-xs text-muted-foreground">
          <CollapsibleTrigger>
            Usage ·{' '}
            {item.usage.reportedCalls
              ? `${item.usage.totalTokens.toLocaleString()} tokens reported`
              : 'counts unavailable'}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3">
              <UsageDetails usage={item.usage} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {showDiagnostics && item.workflow && !you && (
        <TaskEvidence
          state={item.workflow}
          onResume={
            !busy &&
            items.at(-1)?.id === item.id &&
            ['needs_review', 'interrupted'].includes(item.workflow.outcome)
              ? () => ask('Continue the previous task.')
              : undefined
          }
        />
      )}
      {!!item.sources?.length && (
        <Collapsible className="selectable max-w-[88%] text-xs text-muted-foreground">
          <CollapsibleTrigger>Search sources ({item.sources.length})</CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-2">
              {item.sources.map((source) => (
                <li key={source.id}>
                  <PageLink url={source.url}>{source.title}</PageLink>
                  <br />
                  <span className="break-all">{source.url}</span>
                  <br />
                  <span>Retrieved {source.fetchedAt} · untrusted web content</span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </motion.div>
  )
}
