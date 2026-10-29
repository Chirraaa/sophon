import { Spinner } from '@/components/ui/spinner'
import { PanelsTopLeft } from 'lucide-react'
import { Skeleton } from '../ui/skeleton'

export function VisualLoading(): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-visual-loading className="my-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
          <PanelsTopLeft className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="!m-0 text-sm font-medium">Building visual…</p>
          <p className="!m-0 !mt-1 text-xs text-muted-foreground">
            Your interactive preview will appear here.
          </p>
        </div>
        <Spinner className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-14 rounded-xl bg-muted/40" />
        ))}
      </div>
    </div>
  )
}
