import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Code2,
  GitBranch,
  GripHorizontal,
  Maximize2,
  Minimize2,
  X
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useSettings } from '@/hooks/useSettings'
import { useVoice } from '@/hooks/useVoice'
import { GithubContextCard } from '@/components/github/GithubContextCard'
import { Composer } from '@/components/Composer'
import { Message } from '@/components/Message'
import { Button } from '@/components/ui/button'
import { VoiceActivity } from '@/components/compact/VoiceActivity'
import { ApprovalRequests } from '@/components/chat/ApprovalCard'
import { CodingRun } from '@/components/chat/CodingRun'
import { shortcutCodingItem } from '@/lib/coding'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useCompactBackdrop } from '@/hooks/useCompactBackdrop'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BrandIcon } from '@/components/BrandIcon'
export default function CompactApp(): React.JSX.Element {
  useSettings()
  useCompactBackdrop()
  const { items, busy, chatId, githubContext } = useSession()
  const voice = useVoice()
  const [presentation, setPresentation] = useState<CompactPresentation>({
    mode: 'command',
    token: 0
  })
  const [start, setStart] = useState({ chatId, index: 0 })
  const [sizeChoice, setSizeChoice] = useState<'auto' | 'small' | 'large'>('auto')
  const [designGuideOpen, setDesignGuideOpen] = useState(false)
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(() => new Set())
  const [taskCollapsed, setTaskCollapsed] = useState<boolean | null>(null)
  const [githubVisibility, setGithubVisibility] = useState<Record<string, boolean>>({})
  const [workArea, setWorkArea] = useState({
    width: window.screen.availWidth,
    height: window.screen.availHeight
  })
  const [resumeError, setResumeError] = useState<{
    taskKey: string | null
    message: string
  } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const lastSize = useRef('')
  const coding = shortcutCodingItem(items)
  const taskKey = coding ? `${chatId}:${coding.id}` : null
  const taskVisible = !!coding && !hiddenTasks.has(taskKey!)
  const voiceActive = ['starting', 'listening', 'transcribing'].includes(voice.phase)
  const waiting = items.some(
    (item) => item.pending && item.actions.some((action) => action.status === 'waiting')
  )
  const collapsed = presentation.mode === 'voice' && voiceActive && !waiting
  const visible = items.slice(start.chatId === chatId ? Math.min(start.index, items.length) : 0)
  const roomy =
    !collapsed &&
    (designGuideOpen ||
      sizeChoice === 'large' ||
      (sizeChoice === 'auto' && !!coding && visible.includes(coding)))
  const latestPrompt = items.findLast((item) => item.from === 'you')?.text ?? ''
  const githubSuggested = /github\.com\/[\w-]+\/[\w.-]+|\bgithub\b/i.test(latestPrompt)
  const githubVisible = githubVisibility[chatId] ?? (!!githubContext || githubSuggested)
  const sideVisible = githubVisible || taskVisible
  const mainWidth = collapsed ? 320 : roomy ? 880 : 640
  // Reserve the side gutter whenever the display has room. Changing native
  // window width and position when a card opens races the renderer's viewport
  // update, briefly shifting the command panel on transparent Windows windows.
  const sideBySide = workArea.width >= mainWidth + 320 + 16 + 40
  const mainOffset = sideBySide ? 336 : 0
  const popupWidth = mainWidth + 40 + mainOffset

  const visibleOffset = `clamp(0px, calc(100vw - ${mainWidth + 40}px), 336px)`
  const maxHeight = Math.max(0, Math.min(roomy ? 840 : 640, workArea.height - 40))
  const sideHeight = Math.min(300, maxHeight * 0.4)
  const commandHeight =
    sideVisible && !sideBySide ? Math.max(0, maxHeight - sideHeight - 16) : maxHeight
  const folded = taskCollapsed ?? (collapsed || maxHeight < 600 || (waiting && maxHeight < 760))
  const contentRef = useChatScroll(
    `${chatId}:${presentation.token}:${collapsed}:${visible.length > 0}`
  )
  const count = useRef({ total: 0, busy: false, chatId })
  useEffect(() => {
    count.current = { total: items.length, busy, chatId }
  }, [items.length, busy, chatId])
  useEffect(() => {
    let current = true
    const update = (area: { width: number; height: number }): void => {
      if (current)
        setWorkArea((previous) =>
          previous.width === area.width && previous.height === area.height ? previous : area
        )
    }
    const detach = window.api.compact.onWorkArea(update)
    void window.api.compact.workArea().then(update)
    return () => {
      current = false
      detach()
    }
  }, [])
  useEffect(() => {
    window.api.compact.setTaskVisible(taskVisible)
    return () => window.api.compact.setTaskVisible(false)
  }, [taskVisible])
  useEffect(() => {
    const shown = (next: CompactPresentation): void => {
      setStart({
        chatId: count.current.chatId,
        index: Math.max(0, count.current.total - (count.current.busy ? 2 : 0))
      })
      setPresentation(next)
      setSizeChoice('auto')
    }
    void window.api.compact.presentation().then(setPresentation)
    return window.api.compact.onShown(shown)
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector(
          'dialog:modal, [role="dialog"], [role="alertdialog"], [role="listbox"]'
        )
      )
        window.api.compact.hide()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    let frame = 0
    const resize = (): void => {
      const modal = document.querySelector('[role="dialog"], [role="alertdialog"]')
      const height = Math.min(
        workArea.height,
        Math.max(Math.ceil(element.offsetHeight) + 40, modal ? 640 : 0)
      )
      const size = `${height}:${popupWidth}:${mainOffset}`

      document.documentElement.style.setProperty(
        '--popup-max-height',
        `${Math.max(0, height - 48)}px`
      )
      if (size === lastSize.current) return
      lastSize.current = size
      window.api.compact.resize(height, popupWidth, mainOffset)
    }
    const report = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(resize)
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)

    const popups = new MutationObserver(resize)
    popups.observe(document.body, { childList: true, subtree: true })
    resize()
    return () => {
      observer.disconnect()
      popups.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [presentation.token, roomy, popupWidth, mainOffset, workArea.width, workArea.height])
  return (
    <div className="flex justify-center p-5">
      <div
        ref={card}
        className="grid w-full min-w-0 grid-cols-1 items-start gap-4"
        style={{
          maxHeight,
          height: roomy ? maxHeight : undefined
        }}
      >
        {sideVisible && (
          <aside
            aria-label="Chat workspace"
            aria-hidden={!sideVisible}
            data-compact-context
            className={`flex min-h-0 flex-col ${sideBySide ? 'w-80' : 'w-full'}`}
            style={{
              maxHeight: sideBySide ? maxHeight : sideHeight,
              gridArea: sideBySide ? '1 / 1' : undefined,
              transform: sideBySide ? `translateX(calc(${visibleOffset} - 336px))` : undefined
            }}
          >
            <ScrollArea className="min-h-0" viewportClassName="overscroll-contain">
              {githubVisible && <GithubContextCard key={`github:${chatId}`} compact />}
              <div className={githubVisible ? 'mt-3' : undefined}>
                {coding && taskVisible && (
                  <section
                    aria-label="Shortcut coding task"
                    data-compact-task
                    className="w-full shrink-0"
                  >
                    <CodingRun
                      key={taskKey}
                      item={coding}
                      collapsed={folded}
                      controls={
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={folded ? 'Expand coding task' : 'Collapse coding task'}
                            title={folded ? 'Expand coding task' : 'Collapse coding task'}
                            aria-expanded={!folded}
                            onClick={() => setTaskCollapsed(!folded)}
                          >
                            {folded ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronUp className="size-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Hide coding task"
                            title="Hide coding task (work keeps running)"
                            onClick={() =>
                              setHiddenTasks((previous) => new Set(previous).add(taskKey!))
                            }
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      }
                      onResume={
                        !busy &&
                        items.at(-1)?.id === coding.id &&
                        ['needs_review', 'interrupted'].includes(coding.workflow!.outcome)
                          ? () => {
                              setResumeError(null)
                              void window.api
                                .send('Continue the previous task.')
                                .catch((error: Error) =>
                                  setResumeError({ taskKey, message: error.message })
                                )
                            }
                          : undefined
                      }
                    />
                    {resumeError?.taskKey === taskKey && (
                      <p
                        role="alert"
                        className="glass-solid mt-1 rounded-lg p-2 text-xs text-destructive"
                      >
                        {resumeError.message}
                      </p>
                    )}
                  </section>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}
        <div
          className={
            'glass-solid flex min-h-0 flex-col overflow-hidden rounded-[22px] ' +
            (collapsed ? 'w-[320px] shrink-0' : 'w-full min-w-0 flex-1')
          }
          style={{
            maxHeight: commandHeight,
            width: `min(100%, ${mainWidth}px)`,
            marginLeft: visibleOffset,
            gridArea: sideBySide || !sideVisible ? '1 / 1' : undefined,
            height: roomy ? commandHeight : undefined
          }}
          data-compact-size={roomy ? 'expanded' : 'small'}
        >
          <header
            className="flex h-9 shrink-0 cursor-grab items-center justify-between px-3 active:cursor-grabbing"
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as HTMLElement).closest('.no-drag')) return
              const from = { x: event.screenX, y: event.screenY }
              const target = event.currentTarget
              target.setPointerCapture(event.pointerId)
              window.api.compact.drag()
              let frame = 0
              let last = from
              const move = (e: PointerEvent): void => {
                last = { x: e.screenX, y: e.screenY }
                if (frame) return
                frame = requestAnimationFrame(() => {
                  frame = 0
                  window.api.compact.drag(last.x - from.x, last.y - from.y)
                })
              }
              const end = (): void => {
                cancelAnimationFrame(frame)
                window.api.compact.drag(last.x - from.x, last.y - from.y)
                target.removeEventListener('pointermove', move)
                target.removeEventListener('pointerup', end)
                target.removeEventListener('pointercancel', end)
              }
              target.addEventListener('pointermove', move)
              target.addEventListener('pointerup', end)
              target.addEventListener('pointercancel', end)
            }}
          >
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <BrandIcon className="size-4" />
              sophon{coding ? ' / coding' : ''}
            </span>
            <GripHorizontal className="size-4 text-muted-foreground/40" aria-label="Drag to move" />
            <div className="no-drag flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon-xs" />}
                  aria-label={githubVisible ? 'Hide GitHub context' : 'Show GitHub context'}
                  aria-expanded={githubVisible}
                  onClick={() =>
                    setGithubVisibility((previous) => ({ ...previous, [chatId]: !githubVisible }))
                  }
                >
                  <GitBranch className="size-3" />
                </TooltipTrigger>
                <TooltipContent>
                  {githubVisible ? 'Hide GitHub context' : 'Choose a repository and branch'}
                </TooltipContent>
              </Tooltip>
              {coding && !taskVisible && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Show coding task"
                  title="Show coding task"
                  onClick={() =>
                    setHiddenTasks((previous) => {
                      const next = new Set(previous)
                      next.delete(taskKey!)
                      return next
                    })
                  }
                >
                  <Code2 className="size-3" />
                </Button>
              )}
              {!collapsed && (
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon-xs" />}
                    aria-label={roomy ? 'Use smaller window' : 'Expand quick command'}
                    onClick={() => setSizeChoice(roomy ? 'small' : 'large')}
                  >
                    {roomy ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
                  </TooltipTrigger>
                  <TooltipContent>
                    {roomy ? 'Use smaller window' : 'More room to work'}
                  </TooltipContent>
                </Tooltip>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Close quick command"
                onClick={() => window.api.compact.hide()}
                className="no-drag text-muted-foreground"
              >
                <X className="size-3" />
              </Button>
            </div>
          </header>
          {collapsed ? (
            <VoiceActivity voice={voice} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5">
              {visible.length > 0 && (
                <ScrollArea
                  viewportProps={{ render: <div data-chat-viewport /> }}
                  className={`mb-3 min-h-0 ${roomy ? 'flex-1' : 'max-h-[380px]'}`}
                  viewportClassName="overscroll-contain"
                  contentClassName="px-1 pt-1"
                >
                  <div ref={contentRef} className="flex flex-col gap-3">
                    {visible.map((item) => (
                      <Message
                        key={`${chatId}:${item.id}`}
                        item={item}
                        hideCoding={item.id === coding?.id}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
              <ScrollArea className="min-h-0 shrink" viewportClassName="overscroll-contain">
                <ApprovalRequests items={items} />
              </ScrollArea>
              <div className="shrink-0">
                <Composer
                  key={chatId}
                  chatId={chatId}
                  variant="bar"
                  onDesignGuideChange={setDesignGuideOpen}
                  busy={busy}
                  focusToken={presentation.token}
                  autoFocus={presentation.mode === 'command'}
                  placeholder={busy ? 'Working on it…' : 'What should I do?'}
                  onSend={(text, attachments) => window.api.send(text, attachments)}
                />
                <div className="mt-2 flex items-center justify-between px-2 text-[10px] text-muted-foreground">
                  <span>Esc to hide{busy ? ' · Task keeps running' : ' · Drag to move'}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.api.compact.openMain()}
                    className="h-6 gap-1 px-1 text-[10px] font-normal text-muted-foreground"
                  >
                    Open chat <ArrowUpRight className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
