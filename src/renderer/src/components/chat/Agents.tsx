import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, Bot, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { AssistantText } from '../AssistantText'

// Parallel agents in the chat UI: a strip to move between the chat and its agents' threads,
// a live card for each agent in the chat, and messages agents send each other.

const MAIN_COLOR = '#7c6cf2'
const STATUS: Record<AgentStatus, string> = {
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped'
}

export function AgentDot({
  color,
  live = false,
  className
}: {
  color: string
  live?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span aria-hidden className={cn('relative inline-flex size-2 shrink-0', className)}>
      {live && (
        <span
          className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="relative size-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

function statusLabel(agent: AgentInfo): string {
  if (agent.status === 'running' && agent.waiting) return 'Needs approval'
  return STATUS[agent.status]
}

// The chat and its agents, to switch between their threads. Shown once a chat has agents.
// compact: the shortcut window's narrower layout, without the header rule.
export function AgentBar({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const { agents = [], agent, rootChatId, chatId, chats, runningChatIds = [] } = useSession()
  const [error, setError] = useState('')
  if (!agents.length && !agent) return null
  const select = (id: string): void => {
    setError('')
    void window.api.chats.select(id).catch((cause: Error) => setError(cause.message))
  }
  const rootTitle = chats.find((chat) => chat.id === rootChatId)?.title ?? 'Chat'
  const finished = agents.filter((item) => item.status !== 'running')
  const closeFinished = (): void => {
    setError('')
    void Promise.all(finished.map((item) => window.api.chats.delete(item.chatId))).catch(
      (cause: Error) => setError(cause.message)
    )
  }
  const mainLive = !!rootChatId && runningChatIds.includes(rootChatId)
  return (
    <div className={compact ? 'shrink-0 px-1 pb-2' : 'border-b border-border px-7 py-2'}>
      <ScrollArea className="w-full" viewportClassName="overscroll-contain">
        <div role="tablist" aria-label="Chat and its agents" className="flex items-center gap-1">
          <Button
            role="tab"
            aria-selected={chatId === rootChatId}
            variant={chatId === rootChatId ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
            title={rootTitle}
            onClick={() => rootChatId && select(rootChatId)}
          >
            <AgentDot color={MAIN_COLOR} live={mainLive} />
            Main
          </Button>
          {agents.map((item) => (
            <Button
              key={item.chatId}
              role="tab"
              aria-selected={chatId === item.chatId}
              aria-label={`Agent ${item.handle}, ${item.title}: ${statusLabel(item)}`}
              variant={chatId === item.chatId ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 max-w-56 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
              title={`${item.title} · ${statusLabel(item)}`}
              onClick={() => select(item.chatId)}
            >
              <AgentDot color={item.color} live={item.status === 'running'} />
              <span className="truncate">{item.title}</span>
              {item.waiting && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-warning">
                  Approval
                </Badge>
              )}
              {!item.waiting && item.status === 'failed' && <span className="sr-only">failed</span>}
            </Button>
          ))}
          {finished.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs text-muted-foreground"
              title="Close the threads of agents that have finished. Their answers stay in the chat."
              onClick={closeFinished}
            >
              <X className="size-3" aria-hidden /> Close finished
            </Button>
          )}
        </div>
      </ScrollArea>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// Heading of an agent's own thread: what it was asked, its state, and the way back.
export function AgentThreadHeader({ agent }: { agent: AgentInfo }): React.JSX.Element {
  const { rootChatId, chats } = useSession()
  const [error, setError] = useState('')
  const rootTitle = chats.find((chat) => chat.id === rootChatId)?.title ?? 'the chat'
  const run = (action: Promise<unknown>): void => {
    setError('')
    void action.catch((cause: Error) => setError(cause.message))
  }
  return (
    <div className="border-b border-border px-7 py-3">
      <div className="mx-auto flex max-w-[680px] items-start gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Back to ${rootTitle}`}
          title={`Back to ${rootTitle}`}
          onClick={() => rootChatId && run(window.api.chats.select(rootChatId))}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <AgentDot color={agent.color} live={agent.status === 'running'} />
            <span className="truncate">{agent.title}</span>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {agent.kind === 'router' ? 'Follow-up agent' : 'Agent'} {agent.handle}
            </Badge>
            <Badge
              variant={agent.status === 'failed' ? 'destructive' : 'secondary'}
              className="font-normal"
            >
              {statusLabel(agent)}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={agent.task}>
            {agent.task}
          </p>
        </div>
        {agent.status === 'running' ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => run(window.api.stop(agent.chatId))}
          >
            <Square className="size-3" fill="currentColor" /> Stop agent
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            title="Close this thread. The agent's answer stays in the chat."
            onClick={() => run(window.api.chats.delete(agent.chatId))}
          >
            <X className="size-3" aria-hidden /> Close thread
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mx-auto mt-2 max-w-[680px] text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// An agent's card in its chat: live progress while it works, its answer when done.
export function AgentCard({ item }: { item: ChatItem }): React.JSX.Element {
  const { agents = [] } = useSession()
  const [error, setError] = useState('')
  const agent = agents.find((candidate) => candidate.chatId === item.agentRef)
  const live = item.pending && agent?.status === 'running'
  const color = agent?.color ?? 'var(--muted-foreground)'
  const open = (): void => {
    if (!item.agentRef) return
    setError('')
    void window.api.chats.select(item.agentRef).catch((cause: Error) => setError(cause.message))
  }
  return (
    <div
      className="w-full rounded-xl border border-border bg-muted/20 text-[13px]"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      aria-label={agent ? `Agent ${agent.handle}: ${agent.title}` : 'Agent'}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        {agent ? <AgentDot color={color} live={live} /> : <Bot className="size-3.5" aria-hidden />}
        <span className="min-w-0 truncate font-medium">{agent?.title ?? 'Agent'}</span>
        {agent && (
          <Badge
            variant={agent.status === 'failed' ? 'destructive' : 'secondary'}
            className="font-normal"
          >
            {agent.kind === 'router' && agent.status === 'running'
              ? 'Following up'
              : statusLabel(agent)}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 shrink-0 text-xs"
          disabled={!agent}
          onClick={open}
        >
          Open thread <ArrowUpRight className="size-3" />
        </Button>
      </div>
      {live && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          <span role="status" className="min-w-0 truncate">
            {agent?.activity ?? 'Working…'}
          </span>
        </div>
      )}
      {!item.pending && item.text && (
        <div className="selectable border-t border-border px-4 py-3">
          <AssistantText text={item.text} />
        </div>
      )}
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// A message one agent sent another, shown in the receiving thread.
export function PeerMessage({ item }: { item: ChatItem }): React.JSX.Element {
  const sender = item.sender!
  return (
    <div
      className="selectable w-full max-w-[88%] self-start rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2 text-xs"
      style={{ borderLeftColor: sender.color, borderLeftStyle: 'solid', borderLeftWidth: 3 }}
    >
      <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
        <AgentDot color={sender.color} />
        {sender.handle === 'main' ? 'Main task' : `Agent ${sender.handle} · ${sender.title}`}
        {item.followUp === 'queued' && <span className="font-normal">· not read yet</span>}
        {item.followUp === 'unsent' && (
          <span className="font-normal">· arrived after it finished</span>
        )}
      </p>
      <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{item.text}</p>
    </div>
  )
}
