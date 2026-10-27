import { Spinner } from '@/components/ui/spinner'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { useState } from 'react'
import { ActionChip } from '../ActionChip'
import { AttachmentView } from './AttachmentView'
import { actionActivity } from '@/lib/activity'

export function ActionHistory({
  actions,
  attachments = []
}: {
  actions: ToolAction[]
  attachments?: ChatAttachment[]
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const running = actions.some((action) => action.status === 'running')
  const failed = actions.filter((action) => action.status === 'failed').length
  return (
    <div className="flex max-w-full flex-col gap-2">
      <Collapsible
        className="group min-w-0 text-xs text-muted-foreground"
        onOpenChange={(open) => setExpanded(open)}
      >
        <CollapsibleTrigger className="w-fit rounded-lg px-2 py-1.5">
          {running && <Spinner aria-hidden="true" className="size-3.5" />}
          <span>Actions ({actions.length})</span>
          <span className="text-[11px]" role="status">
            {actionActivity(actions) ?? (failed ? 'Finished with errors' : 'Complete')}
          </span>
          {failed > 0 && <span className="text-red-300">{failed} failed</span>}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {expanded && (
            <div className="mt-2 space-y-2 pl-2">
              <div className="flex flex-wrap gap-1.5">
                {actions
                  .filter((action) => action.status !== 'waiting')
                  .map((action) => (
                    <ActionChip key={action.id} action={action} />
                  ))}
              </div>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <AttachmentView key={attachment.id} attachment={attachment} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
