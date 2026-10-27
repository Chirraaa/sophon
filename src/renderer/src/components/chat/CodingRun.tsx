import { Spinner } from '@/components/ui/spinner'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useState, type ReactNode } from 'react'
import { StoredActionDetails } from './StoredActionDetails'
import {
  ArrowUpRight,
  Check,
  Circle,
  CircleCheck,
  Code2,
  FileCode2,
  ListChecks,
  Terminal,
  TriangleAlert
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { codingChecks, codingFiles, codingView } from '@/lib/coding'
import { cn } from '@/lib/utils'
import { PatchPreview } from './PatchPreview'
import { Hint } from '../ui/tooltip'

export function CodingRun({
  item,
  dock = false,
  onResume,
  controls,
  collapsed = false
}: {
  item: ChatItem
  dock?: boolean
  onResume?: () => void
  controls?: ReactNode
  collapsed?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('tasks')
  const session = item.workflow?.codingSession
  if (!session) return null
  const view = codingView(item)
  const files = codingFiles(item)
  const checks = codingChecks(item)
  const fileCount = new Set(files.map((file) => file.path)).size
  const show = (value: string): void => {
    setTab(value)
    setOpen(true)
  }
  const statusIcon =
    view.label === 'Waiting for your input' ? (
      <Circle className="size-4 text-muted-foreground" />
    ) : view.attention ? (
      <TriangleAlert className="size-4 text-amber-300" />
    ) : item.pending ? (
      <Spinner className="size-4 text-primary" />
    ) : (
      <CircleCheck className="size-4 text-emerald-400" />
    )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {dock ? (
        <DialogTrigger
          render={<Button variant="ghost" />}
          aria-label="Open coding progress"
          className="mb-2 h-auto w-full justify-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs"
        >
          {statusIcon}
          <span>{view.label}</span>
          <span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground">
            {view.current}
          </span>
          <ArrowUpRight className="size-3.5" />
        </DialogTrigger>
      ) : (
        <Card
          className={cn(
            'w-full gap-0 overflow-hidden rounded-2xl border-white/8 bg-muted/20 py-0 shadow-none',
            controls && 'glass-solid rounded-[22px]'
          )}
          data-coding-run
        >
          <div className={cn('flex items-center gap-2.5 px-4 pt-4', collapsed && 'pb-4')}>
            <div className="rounded-lg border border-border bg-background/40 p-2">
              <Code2 className="size-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              {controls ? (
                <DialogTrigger
                  render={<Button type="button" variant="ghost" />}
                  aria-label="Open coding progress"
                  className="h-auto rounded-sm p-0 text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Coding task <ArrowUpRight className="ml-1 inline size-3" />
                </DialogTrigger>
              ) : (
                <p className="text-xs font-medium">Coding task</p>
              )}
              <p role="status" className="mt-0.5 text-[11px] text-muted-foreground">
                {view.label}
              </p>
            </div>
            {statusIcon}
            {controls}
          </div>
          {!collapsed && (
            <>
              <Hint text={view.current}>
                <p
                  className={cn(
                    'px-4 pt-3 text-[13px] leading-5',
                    controls && 'line-clamp-2 break-words'
                  )}
                >
                  {view.current}
                </p>
              </Hint>
              <div className="grid grid-cols-4 gap-2 px-4 pt-4" aria-label="Coding stages">
                {['Plan', 'Edit', 'Check', 'Review'].map((label, index) => (
                  <div key={label} className="space-y-1.5">
                    <div
                      className={cn(
                        'h-1 rounded-full bg-muted',
                        index <= view.stage && 'bg-primary/70',
                        view.attention && index === view.stage && 'bg-amber-300/70'
                      )}
                    />
                    <span
                      className={cn(
                        'text-[10px] text-muted-foreground',
                        index === view.stage && 'text-foreground'
                      )}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/60 px-2 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => show('tasks')}
                >
                  <ListChecks className="size-3.5" />
                  {session.tasks.length
                    ? `${view.completed}/${session.tasks.length} checked`
                    : 'Plan'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => show('files')}
                >
                  <FileCode2 className="size-3.5" />
                  {fileCount} {fileCount === 1 ? 'file' : 'files'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => show('checks')}
                >
                  <Terminal className="size-3.5" />
                  Checks {checks.length > 0 && `(${checks.length})`}
                </Button>
                {onResume && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 text-[11px]"
                    onClick={onResume}
                  >
                    Continue task
                  </Button>
                )}
              </div>
            </>
          )}
        </Card>
      )}
      <DialogContent className="h-[min(620px,calc(100dvh-3rem))]">
        <div className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <Code2 className="size-4 text-primary" />
            Coding task{' '}
            <Badge variant="secondary" className="text-[10px]">
              {view.label}
            </Badge>
          </DialogTitle>
          <DialogDescription className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {item.workflow!.goal}
          </DialogDescription>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="mt-4 min-h-0 flex-1 gap-3"
        >
          <TabsList className="w-full shrink-0" aria-label="Coding task details">
            <TabsTrigger value="tasks" className="text-xs">
              Tasks
            </TabsTrigger>
            <TabsTrigger value="files" className="text-xs">
              Files {fileCount > 0 && `(${fileCount})`}
            </TabsTrigger>
            <TabsTrigger value="checks" className="text-xs">
              Checks
            </TabsTrigger>
          </TabsList>
          <ScrollArea
            className="min-h-0"
            viewportClassName="overscroll-contain"
            contentClassName="pr-1"
          >
            <TabsContent value="tasks" className="space-y-4 pb-1">
              <p className="selectable whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                {session.plan || 'The project is being inspected. The plan will appear here.'}
              </p>
              <ol className="space-y-2">
                {session.tasks.map((task) => (
                  <li
                    key={task.id}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border border-border p-3',
                      task.status === 'active' && 'border-primary/25 bg-primary/5'
                    )}
                  >
                    {task.status === 'active' ? (
                      <Spinner className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : task.status === 'verified' ? (
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                    ) : task.status === 'implemented' ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                    )}
                    <div>
                      <p className="text-xs leading-5">{task.title}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {
                          {
                            pending: 'Upcoming',
                            active: 'In progress',
                            implemented: 'Awaiting checks',
                            verified: 'Checks passed'
                          }[task.status]
                        }
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {session.decisions && (
                <Collapsible className="text-xs text-muted-foreground">
                  <CollapsibleTrigger className="cursor-pointer">
                    Decisions and review
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="selectable mt-2 whitespace-pre-wrap leading-6">
                      {session.decisions}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </TabsContent>
            <TabsContent value="files" className="space-y-4 pb-1">
              {!files.length && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  File changes will appear here as they are proposed.
                </p>
              )}
              {files.map(({ action, args, path }) => (
                <div key={action.id} className="space-y-2">
                  <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="text-[9px]">
                      {action.status === 'done' &&
                      action.detail?.includes('Verified path is absent.')
                        ? 'Deleted'
                        : action.status === 'done' &&
                            action.detail?.includes('Verified by reading back identical bytes.')
                          ? action.name === 'edit_file'
                            ? 'Patched'
                            : args.overwrite
                              ? 'Replaced'
                              : 'Created'
                          : action.status === 'failed'
                            ? 'Not confirmed'
                            : action.status === 'done'
                              ? 'Reported'
                              : 'Proposed'}
                    </Badge>
                    {action.name === 'delete_file' || action.name === 'delete_directory'
                      ? 'Permanent deletion'
                      : action.name === 'edit_file'
                        ? 'Only the selected excerpts change'
                        : args.overwrite
                          ? 'File replacement'
                          : 'New file'}
                  </p>
                  {action.detailsStored ? (
                    <StoredActionDetails action={action} />
                  ) : action.name === 'delete_file' || action.name === 'delete_directory' ? (
                    <p className="selectable whitespace-pre-wrap break-all rounded-xl border border-border p-3 text-xs text-muted-foreground">
                      {action.preview}
                    </p>
                  ) : action.name === 'edit_file' ? (
                    <PatchPreview args={args} />
                  ) : (
                    <Collapsible className="rounded-xl border border-border p-3 text-xs">
                      <CollapsibleTrigger className="cursor-pointer break-all font-mono">
                        {path}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ScrollArea className="mt-3 max-h-64" orientation="both">
                          <pre className="selectable text-[11px]">{String(args.content ?? '')}</pre>
                        </ScrollArea>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              ))}
            </TabsContent>
            <TabsContent value="checks" className="space-y-3 pb-1">
              {!checks.length && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Checks have not run yet.
                </p>
              )}
              {checks.map(({ action, command, status, output, path, url }) => (
                <Collapsible
                  key={action.id}
                  defaultOpen={action.status === 'running' || undefined}
                  className="rounded-xl border border-border p-3 text-xs"
                >
                  <CollapsibleTrigger className="flex cursor-pointer items-center gap-2">
                    <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 break-all font-mono">{command}</span>
                    <span
                      className={cn(
                        'text-[10px]',
                        status === 'Passed'
                          ? 'text-emerald-400'
                          : status.startsWith('Failed') || status === 'Stopped'
                            ? 'text-amber-300'
                            : 'text-muted-foreground'
                      )}
                    >
                      {status}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="mt-2 text-[10px] text-muted-foreground">Project: {path}</p>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-primary underline"
                      >
                        Open preview: {url}
                      </a>
                    )}
                    <ScrollArea className="mt-3 max-h-52" orientation="both">
                      <pre className="selectable whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                        {output}
                      </pre>
                    </ScrollArea>
                    {action.detailsStored && <StoredActionDetails action={action} />}
                  </CollapsibleContent>
                </Collapsible>
              ))}
              {!!checks.length && (
                <p className="text-[10px] leading-5 text-muted-foreground">
                  Results belong to each command at the time it ran. Later edits require fresh
                  checks.
                </p>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
        {item.actions.some((action) => action.status === 'waiting') && (
          <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>A proposed action needs your approval.</span>
            <Button size="sm" onClick={() => setOpen(false)}>
              Review approval
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
