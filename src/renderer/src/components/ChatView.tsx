import { Kbd } from '@/components/ui/kbd'
import { useCallback, useEffect, useState } from 'react'
import { GithubContextCard } from './github/GithubContextCard'
import { ChatHistoryPages } from './chat/ChatHistoryPages'
import { AnimatePresence } from 'motion/react'
import { ArrowUpRight, GitBranch } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { useSession } from '@/hooks/useSession'
import { useChatScroll } from '@/hooks/useChatScroll'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer } from './Composer'
import { Message } from './Message'
import { QuestionCard } from './chat/QuestionCard'
import { questionsFromReply } from '../../../shared/questions'
import { ApprovalRequests } from './chat/ApprovalCard'
import { CodingRun } from './chat/CodingRun'
import { latestCodingItem } from '@/lib/coding'
const WELCOME_PROMPTS = [
  'What would you like to work on?',
  'Where shall we begin?',
  "What's on your mind?",
  'Have an idea you want to try?',
  'Ready when you are.',
  'What are we cooking today?',
  'Which rabbit hole are we exploring?',
  'Tiny task or mildly ambitious master plan?'
]
function EmptyState(): React.JSX.Element {
  const settings = useSettings()
  const [variant] = useState(() => Math.floor(Math.random() * 3))
  const [prompt] = useState(
    () => WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)]
  )
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const timer = setInterval(() => setHour(new Date().getHours()), 60000)
    return () => clearInterval(timer)
  }, [])
  const period = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const name = settings?.profile.name
  const greeting = {
    night: ['A quiet moment', 'Still up', 'Hello tonight'],
    morning: ['Good morning', 'A fresh start', 'Hello this morning'],
    afternoon: ['Good afternoon', 'Welcome back', 'Hello this afternoon'],
    evening: ['Good evening', 'Welcome back', 'Hello this evening']
  }[period][variant]
  return (
    <div className="welcome-state mx-auto flex w-full max-w-[680px] flex-col items-center justify-center px-7 py-8 text-center">
      <h2 className="max-w-full break-words text-[clamp(26px,3.4vw,34px)] font-medium leading-tight tracking-[-0.05em]">
        {greeting}
        {name ? `, ${name}` : ''}.
      </h2>
      <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{prompt}</p>
    </div>
  )
}
export function ChatView({
  status,
  onOpenModel,
  usingChatgpt = false
}: {
  status: LlmStatus | null
  onOpenModel: () => void
  usingChatgpt?: boolean
}): React.JSX.Element {
  const { items, busy, chatId, chats, runningChatId, totalItems = items.length } = useSession()
  const latest = items.at(-1)
  const coding = latestCodingItem(items)
  const questions =
    latest?.from === 'agent' && !latest.pending ? questionsFromReply(latest.text) : undefined
  const contentRef = useChatScroll(chatId)
  const [questionError, setQuestionError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    setActionError('')
    setActionPending(true)
    try {
      await action()
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Could not complete the action. Try again.'
      )
    } finally {
      setActionPending(false)
    }
  }
  const [githubVisibility, setGithubVisibility] = useState<Record<string, boolean>>({})
  const [draftActive, setDraftActive] = useState<Record<string, boolean>>({})
  const onDraftChange = useCallback(
    (active: boolean) => {
      setDraftActive((previous) =>
        previous[chatId] === active ? previous : { ...previous, [chatId]: active }
      )
    },
    [chatId]
  )
  const welcomeCentered = items.length === 0 && !draftActive[chatId] && !busy
  const githubVisible = githubVisibility[chatId] ?? false
  const send = (text: string, attachments: string[] = []): Promise<void> =>
    window.api.send(text, attachments)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-white/5 px-7">
        <div className="flex items-center gap-2.5">
          <h1 className="max-w-72 truncate text-[13px] font-medium">
            {chats.find((chat) => chat.id === chatId)?.title || 'Assistant'}
          </h1>
          <Badge
            variant="outline"
            className="rounded-md border-white/7 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground"
          >
            Personal workspace
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={githubVisible ? 'Hide GitHub context' : 'Show GitHub context'}
          aria-expanded={githubVisible}
          onClick={() =>
            setGithubVisibility((previous) => ({ ...previous, [chatId]: !githubVisible }))
          }
        >
          <GitBranch className="size-4" /> Repository
        </Button>
      </header>
      {runningChatId && runningChatId !== chatId && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-white/5 px-7 py-2 text-xs text-muted-foreground"
        >
          <span>
            Working in {chats.find((chat) => chat.id === runningChatId)?.title ?? 'another chat'}.
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={actionPending}
            onClick={() => void perform(() => window.api.chats.select(runningChatId))}
          >
            Return to request
          </Button>
        </div>
      )}
      <p role="status" className="sr-only">
        {latest?.from === 'agent'
          ? latest.pending
            ? 'Sophon is replying.'
            : 'Sophon replied.'
          : ''}
      </p>
      <div
        className={`flex min-h-0 flex-1 flex-col ${welcomeCentered ? 'justify-center overflow-y-auto' : ''}`}
      >
        {items.length === 0 && (
          <div className={welcomeCentered ? 'shrink-0' : 'flex min-h-0 flex-1 items-center'}>
            <EmptyState />
          </div>
        )}
        <ScrollArea
          className={`min-h-0 flex-1 ${items.length === 0 ? 'hidden' : ''}`}
          contentClassName="min-h-full"
        >
          <div ref={contentRef} className="flex min-h-full flex-col px-7">
            {items.length > 0 && (
              <div
                role="log"
                aria-label="Conversation"
                aria-live="off"
                className={`mx-auto flex w-full ${coding ? 'max-w-[860px]' : 'max-w-[680px]'} flex-col gap-6 py-7`}
              >
                <AnimatePresence initial={false}>
                  {totalItems > items.length && (
                    <ChatHistoryPages
                      key={`${chatId}:${totalItems}`}
                      chatId={chatId}
                      before={totalItems - items.length}
                    />
                  )}
                  {items.map((item) => (
                    <Message key={`${chatId}:${item.id}`} item={item} dockQuestions />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="composer-dock shrink-0 px-7 pt-3 pb-4">
          <div className={`mx-auto ${coding ? 'max-w-[860px]' : 'max-w-[680px]'}`}>
            {coding?.pending && <CodingRun key={coding.id} item={coding} dock />}
            <ApprovalRequests items={items} />
            {questions && (
              <ScrollArea className="mb-2 max-h-[min(50vh,420px)]">
                <QuestionCard
                  key={`${chatId}:${latest!.id}`}
                  questions={questions}
                  onAsk={
                    busy
                      ? undefined
                      : (text) => {
                          setQuestionError('')
                          void send(text).catch((error: Error) => setQuestionError(error.message))
                        }
                  }
                />
              </ScrollArea>
            )}
            {questionError && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {questionError}
              </p>
            )}
            {githubVisible && <GithubContextCard key={`github:${chatId}`} />}
            <Composer
              key={chatId}
              chatId={chatId}
              onSend={send}
              busy={busy}
              onDraftChange={onDraftChange}
            />
            <div className="mt-3 flex min-h-4 items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
              {status?.online === false ? (
                <Button
                  variant="link"
                  onClick={onOpenModel}
                  className="h-auto p-0 text-[10px] font-normal text-muted-foreground"
                >
                  Connect a model to get started <ArrowUpRight className="size-3" />
                </Button>
              ) : (
                <span>
                  {busy ? 'Sophon is working on it…' : 'A little help, right where you need it.'}
                </span>
              )}
              {usingChatgpt && (
                <Button
                  variant="link"
                  className="h-auto p-0 text-[10px] font-normal text-muted-foreground"
                  disabled={actionPending}
                  onClick={() => void perform(() => window.api.chatgpt.manageUsage())}
                >
                  Using ChatGPT plan · Manage usage
                </Button>
              )}
              <span className="shrink-0">
                <Kbd aria-label="Enter">↵</Kbd> to send <span className="mx-1.5 opacity-40">·</span>{' '}
                <Kbd>Shift</Kbd> + <Kbd aria-label="Enter">↵</Kbd> for a new line
              </span>
            </div>
            {actionError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {actionError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
