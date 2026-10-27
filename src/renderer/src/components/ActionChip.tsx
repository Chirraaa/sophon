import { Spinner } from '@/components/ui/spinner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'
import { Check, Shield, X } from 'lucide-react'
import { Hint } from './ui/tooltip'
import { actionError, actionHint, actionLabel } from '@/lib/action-presentation'
import { StoredActionDetails } from './chat/StoredActionDetails'
const STYLES: Record<ToolActionStatus, string> = {
  running: 'border-white/8 bg-white/3 text-muted-foreground',
  waiting: 'border-amber-300/20 bg-amber-300/5 text-amber-100',
  done: 'border-white/8 bg-white/3 text-foreground/75 [&_svg]:text-emerald-400/80',
  failed: 'border-red-400/20 bg-red-400/5 text-red-200'
}
export function ActionChip({ action }: { action: ToolAction }): React.JSX.Element {
  return (
    <Hint text={actionHint(action)}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 6, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
        tabIndex={0}
        aria-label={actionHint(action)}
        className={cn(
          'flex min-w-0 max-w-full flex-col rounded-xl border px-3 py-2 text-[11px] [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          STYLES[action.status]
        )}
      >
        <span className="flex items-center gap-2">
          {action.status === 'running' && <Spinner className="size-3.5" />}
          {action.status === 'waiting' && <Shield className="size-3.5" />}
          {action.status === 'done' && <Check className="size-3.5" />}
          {action.status === 'failed' && <X className="size-3.5" />}
          <span className="min-w-0 truncate">{actionLabel(action)}</span>
        </span>

        {actionError(action) && (
          <span className="mt-0.5 line-clamp-2 break-words text-[11px] opacity-80">
            {actionError(action)}
          </span>
        )}
        {action.detailsStored && <StoredActionDetails action={action} />}
        {['run_npm', 'run_command'].includes(action.name) &&
          action.status === 'running' &&
          action.detail && (
            <ScrollArea className="mt-2 max-h-48 max-w-full" orientation="both">
              <pre
                className="selectable whitespace-pre-wrap break-words font-mono text-[11px]"
                aria-label="Live command output"
              >
                {action.detail}
              </pre>
            </ScrollArea>
          )}
      </motion.div>
    </Hint>
  )
}
