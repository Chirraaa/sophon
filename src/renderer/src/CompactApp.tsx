import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  GitBranch,
  GripHorizontal,
  Maximize2,
  Minimize2,
  PanelTopClose,
  PanelTopOpen,
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
import { codingView, shortcutCodingItem } from '@/lib/coding'
import { replyActivity } from '@/lib/activity'
import { Spinner } from '@/components/ui/spinner'
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
  const [docked, setDocked] = useState(false)
  const [notice, setNotice] = useState<'finished' | null>(null)
  const [wasBusy, setWasBusy] = useState(busy)
  if (wasBusy !== busy) {
    setWasBusy(busy)
    setNotice(!busy && docked ? 'finished' : null)
  }
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // A docked window rests as a slim bar and opens fully on hover, focus, or
  // whenever something needs the user's attention.
  const barMode = docked && !hovered && !focused && !waiting
  const pending = items.findLast((item) => item.pending)
  const status = coding
    ? codingView(coding)
    : {
        label: busy ? (pending ? replyActivity(pending) : 'Working on it…') : 'Ready',
        attention: false
      }
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
  const mainOffset = sideBySide && !barMode ? 336 : 0
  const popupWidth = barMode ? 360 : mainWidth + 40 + mainOffset

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
  const noticeRef = useRef(notice)
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
    window.api.compact.setDocked(docked)
  }, [docked])
  useEffect(() => {
    noticeRef.current = notice
  }, [notice])
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    },
    []
  )
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
      setDocked(next.docked === true)
      setNotice(next.notice ?? null)
      setHovered(false)
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
        Math.max(Math.ceil(element.offsetHeight) + (docked ? 20 : 40), modal ? 640 : 0)
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
  }, [
    presentation.token,
    roomy,
    docked,
    barMode,
    popupWidth,
    mainOffset,
    workArea.width,
    workArea.height
  ])
  const enter = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    setHovered(true)
  }
  const leave = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => {
      // Keep the layout open while a menu or dialog it owns is showing.
      if (
        document.querySelector(
          'dialog:modal, [role="dialog"], [role="alertdialog"], [role="listbox"]'
        )
      )
        return leave()
      setHovered(false)
      // The finished sign has been seen: put the bar away unless it is in use.
      if (noticeRef.current && !count.current.busy && !document.hasFocus()) {
        setNotice(null)
        window.api.compact.hide()
      }
    }, 450)
  }
  const toggleDock = (): void => {
    if (!docked) (document.activeElement as HTMLElement | null)?.blur()
    setDocked(!docked)
  }
  return (
    <div className={`flex justify-center p-5 ${docked ? 'pt-0' : ''}`}>
      <div
        ref={card}
        className="grid w-full min-w-0 grid-cols-1 items-start gap-4"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          maxHeight,
          height: roomy && !barMode ? maxHeight : undefined
        }}
      >
        {barMode && (
          <Button
            variant="ghost"
            aria-label={`Sophon: ${notice ? 'Task finished' : status.label}. Show full window`}
            aria-expanded={false}
            onClick={enter}
            className={`glass-solid mx-auto flex h-8 w-[320px] max-w-full items-center justify-start gap-2 rounded-t-none rounded-b-[14px] px-3 text-[11px] font-normal ${notice ? 'ring-1 ring-success/60' : ''}`}
          >
            {notice ? (
              <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <BrandIcon className="size-3.5 shrink-0" />
            )}
            <span
              className={`truncate ${notice ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {notice ? 'Task finished' : status.label}
            </span>
            <span className="sr-only" role="status">
              {notice ? 'Task finished' : ''}
            </span>
            <span className="ml-auto flex shrink-0 items-center">
              {status.attention ? (
                <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
              ) : busy ? (
                <Spinner className="size-3 text-muted-foreground" />
              ) : null}
            </span>
          </Button>
        )}
        {!barMode && sideVisible && (
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
        {!barMode && (
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
            <header className="drag flex h-9 shrink-0 items-center justify-between px-3">
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                <BrandIcon className="size-4" />
                sophon{coding ? ' / coding' : ''}
              </span>
              <GripHorizontal
                className="size-4 text-muted-foreground/40"
                aria-label="Drag to move"
              />
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
                {(busy || coding || docked) && (
                  <Tooltip>
                    <TooltipTrigger
                      render={<Button variant="ghost" size="icon-xs" />}
                      aria-label={docked ? 'Undock from top' : 'Dock to top'}
                      aria-pressed={docked}
                      onClick={toggleDock}
                    >
                      {docked ? (
                        <PanelTopOpen className="size-3" />
                      ) : (
                        <PanelTopClose className="size-3" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      {docked ? 'Undock from top' : 'Collapse to a bar at the top'}
                    </TooltipContent>
                  </Tooltip>
                )}
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
        )}
      </div>
    </div>
  )
}
