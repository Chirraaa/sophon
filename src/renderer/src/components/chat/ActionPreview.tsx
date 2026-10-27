import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PatchPreview } from './PatchPreview'
import { patchEdits } from '@/lib/coding'
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
export function ActionPreview({ preview }: { preview?: string }): React.JSX.Element {
  let data: Record<string, unknown> | undefined
  try {
    data = record(JSON.parse((preview ?? '').slice((preview ?? '').indexOf('{'))))
  } catch {
    /* Older actions may have plain text previews. */
  }
  const window = record(data?.window)
  const control = record(data?.control)
  const args = record(data?.arguments)
  if (args && patchEdits(args).length)
    return (
      <div className="space-y-2">
        <PatchPreview args={args} />
        <Collapsible>
          <CollapsibleTrigger className="cursor-pointer text-[10px] text-muted-foreground">
            Exact action details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="selectable mt-2 whitespace-pre-wrap break-all text-[11px]">
              {preview}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const plugin = record(data?.plugin)
  if (plugin)
    return (
      <div className="space-y-2">
        <p className="font-medium [overflow-wrap:anywhere]">
          {text(plugin.server)} · {text(plugin.operation)}
        </p>
        <p className="selectable break-all text-xs">{text(plugin.destination)}</p>
        <p className="text-xs text-muted-foreground">{text(plugin.access)}</p>
        <ScrollArea className="max-h-64 rounded-md bg-white/5" orientation="both">
          <pre className="selectable whitespace-pre-wrap break-words p-2.5 font-mono text-[11px] leading-5">
            {JSON.stringify(plugin.arguments ?? args, null, 2)}
          </pre>
        </ScrollArea>
        <Collapsible>
          <CollapsibleTrigger className="cursor-pointer text-[10px] opacity-65">
            Exact action details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="selectable mt-2 whitespace-pre-wrap break-all text-[11px]">
              {preview}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  if (!window)
    return (
      <div className="space-y-2">
        {data ? (
          <>
            {(text(data.destination) || text(record(data.app)?.name) || text(data.provider)) && (
              <p className="selectable break-all">
                {text(data.destination) || text(record(data.app)?.name) || text(data.provider)}
              </p>
            )}
            <ScrollArea className="rounded-md bg-white/5" orientation="both">
              <pre className="selectable whitespace-pre-wrap break-words p-2.5 font-mono text-[11px] leading-5">
                {JSON.stringify(
                  {
                    ...record(data.arguments),
                    ...(data.device ? { device: data.device } : {}),
                    ...(data.effect ? { effect: data.effect } : {}),
                    ...(data.execution ? { execution: data.execution } : {}),
                    ...(data.network ? { network: data.network } : {})
                  },
                  null,
                  2
                )}
              </pre>
            </ScrollArea>
            <Collapsible>
              <CollapsibleTrigger className="cursor-pointer text-[10px] opacity-65">
                Exact action details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="selectable mt-2 whitespace-pre-wrap break-all text-[11px]">
                  {preview}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : (
          <pre className="selectable whitespace-pre-wrap break-all text-[11px]">{preview}</pre>
        )}
      </div>
    )
  return (
    <div className="mt-2 space-y-2">
      <div className="break-words">
        <span className="opacity-60">App: </span>
        {text(window.title)} <span className="opacity-60">({text(window.exe)})</span>
      </div>
      {!control && (
        <pre className="selectable whitespace-pre-wrap break-words rounded-md bg-white/5 p-2.5 font-mono text-[11px] leading-5">
          {JSON.stringify(data?.arguments, null, 2)}
        </pre>
      )}
      {control && (
        <>
          <div className="break-words">
            <span className="opacity-60">Control: </span>
            {text(control.control)} <span className="opacity-60">· {text(control.role)}</span>
          </div>
          <div>
            <span className="opacity-60">Action: </span>
            {text(control.action).replace(/_/g, ' ')}
          </div>
          {control.action === 'set_value' && (
            <>
              <div className="opacity-70">Replace the field with:</div>
              <ScrollArea className="max-h-32 rounded-md bg-black/20" orientation="both">
                <pre className="selectable whitespace-pre-wrap break-words p-2">
                  {text(control.replacement) || '(empty — clear this field)'}
                </pre>
              </ScrollArea>
              <div className="opacity-70">
                Replaces the whole field. No Enter key or submit click is sent.
              </div>
            </>
          )}
          {control.action === 'invoke' && (
            <div className="opacity-70">
              Activates this control. Check its purpose before approving.
            </div>
          )}
        </>
      )}
      <Collapsible className="opacity-70">
        <CollapsibleTrigger className="cursor-pointer">Exact action details</CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea className="mt-1 max-h-64" orientation="both">
            <pre className="selectable whitespace-pre-wrap break-all text-[11px]">{preview}</pre>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
