import { Kbd } from '@/components/ui/kbd'
import { useState } from 'react'
import {
  ArrowUpRight,
  GitFork as Github,
  Keyboard,
  MessageSquare,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X
} from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ConversationList } from './chat/ConversationList'
import { useStoredBoolean } from '@/hooks/useStoredBoolean'
import { Hint } from '@/components/ui/tooltip'
import { BrandIcon } from './BrandIcon'
export type View = 'chat' | 'github' | 'settings'
type Props = {
  view: View
  onView: (view: View) => void
  status: LlmStatus | null
  hotkey?: string
  onOpenModel: () => void
}
export function Sidebar({ view, onView, status, hotkey, onOpenModel }: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useStoredBoolean('sophon.sidebarCollapsed')
  const [hideReminder, setHideReminder] = useStoredBoolean('sophon.hideShortcutReminder')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const createChat = async (): Promise<void> => {
    setCreating(true)
    setError('')
    try {
      await window.api.chats.create()
      setCollapsed(false)
      onView('chat')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a chat. Try again.')
      setCollapsed(false)
    } finally {
      setCreating(false)
    }
  }
  return (
    <aside
      aria-label="Workspace sidebar"
      className={cn(
        'flex shrink-0 flex-col px-2 pt-4 pb-2',
        collapsed ? 'w-14' : 'w-[216px] max-[850px]:w-[192px]'
      )}
    >
      <div
        className={cn(
          'mb-6 flex items-center gap-2',
          collapsed ? 'justify-center' : 'justify-between px-2'
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <BrandIcon />
            <div>
              <div className="text-[17px] font-semibold tracking-[-0.04em]">
                sophon<span className="text-tint">.</span>
              </div>
              <p className="mt-0.5 text-[10px] whitespace-nowrap text-muted-foreground">
                Desktop assistant
              </p>
            </div>
          </div>
        )}
        <Hint text={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </Hint>
      </div>
      {!collapsed && (
        <p className="mb-3 px-3 text-xs font-medium tracking-[0.12em] text-muted-foreground">
          WORKSPACE
        </p>
      )}
      <nav aria-label="Main navigation" className="flex flex-col gap-1">
        {[
          { id: 'chat' as const, label: 'Assistant', icon: MessageSquare },
          { id: 'github' as const, label: 'GitHub', icon: Github },
          { id: 'settings' as const, label: 'Settings', icon: Settings2 }
        ].map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            onClick={() => onView(id)}
            aria-current={view === id ? 'page' : undefined}
            aria-label={label}
            title={collapsed ? label : undefined}
            className={cn(
              'relative h-10 justify-start gap-3 rounded-xl px-3 text-[13px] font-normal hover:bg-muted/50',
              view === id ? 'text-foreground' : 'text-muted-foreground',
              collapsed && 'justify-center px-0'
            )}
          >
            {view === id && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 rounded-xl border border-border bg-muted shadow-[0_2px_8px_#00000012]"
                transition={spring}
              />
            )}
            <Icon className="relative size-4" strokeWidth={1.6} />
            {!collapsed && <span className="relative">{label}</span>}
          </Button>
        ))}
      </nav>
      {collapsed ? (
        <div className="mt-4 flex flex-1 flex-col items-center border-t border-border pt-3">
          <Hint text="New chat">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              disabled={creating}
              onClick={() => void createChat()}
            >
              <Plus className="size-4" />
            </Button>
          </Hint>
        </div>
      ) : (
        <ConversationList onSelect={() => onView('chat')} />
      )}
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 shrink-0">
        {hotkey && !collapsed && !hideReminder && (
          <div className="relative mb-5 rounded-xl border border-border bg-muted/40 p-3">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss shortcut reminder"
              className="absolute top-2 right-2"
              onClick={() => setHideReminder(true)}
            >
              <X className="size-3" />
            </Button>
            <Keyboard className="mb-3 size-4 text-muted-foreground/60" strokeWidth={1.5} />
            <p className="text-xs text-foreground/80">A shortcut to a little help.</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Sophon, from anywhere.</p>
            <div className="mt-3 flex flex-wrap gap-1" aria-label={hotkey}>
              {hotkey
                .replace(/Control/g, 'Ctrl')
                .split('+')
                .map((key, index) => (
                  <Kbd key={key + index} className="h-6 min-w-6">
                    {key}
                  </Kbd>
                ))}
            </div>
          </div>
        )}
        <Separator className="mb-3 bg-muted" />
        <Button
          variant="ghost"
          onClick={onOpenModel}
          className={cn(
            'group h-auto w-full justify-start gap-2.5 rounded-xl px-3 py-3 text-left font-normal',
            collapsed && 'justify-center px-0'
          )}
          aria-label="Open model connection settings"
          title={
            collapsed
              ? status?.online
                ? 'Model connected'
                : 'Model connection settings'
              : undefined
          }
        >
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              status === null
                ? 'bg-muted-foreground'
                : status.online
                  ? 'bg-emerald-400'
                  : 'bg-amber-400/80'
            )}
          />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block text-[11px]">
                {status === null
                  ? 'Checking connection'
                  : status.online
                    ? 'Model connected'
                    : 'Model offline'}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {status?.model || 'Model connection'}
              </span>
            </span>
          )}
          {!collapsed && (
            <ArrowUpRight className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          )}
        </Button>
      </div>
    </aside>
  )
}
