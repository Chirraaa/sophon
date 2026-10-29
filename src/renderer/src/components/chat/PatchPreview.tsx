import { ScrollArea } from '@/components/ui/scroll-area'
import { FileCode2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { patchEdits, patchLines } from '@/lib/coding'
import { cn } from '@/lib/utils'

export function PatchPreview({ args }: { args: Record<string, unknown> }): React.JSX.Element {
  const edits = patchEdits(args)
  const hunks = edits.map((edit) => patchLines(edit.old_text, edit.new_text))
  const added = hunks.flat().filter((line) => line.kind === 'add').length
  const removed = hunks.flat().filter((line) => line.kind === 'remove').length
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border" data-patch-preview>
      <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-3 py-2 text-xs">
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="selectable min-w-0 flex-1 break-all font-mono">
          {String(args.path ?? 'File patch')}
        </span>
        <span className="text-success" aria-label={`${added} added lines`}>
          +{added}
        </span>
        <span className="text-destructive" aria-label={`${removed} removed lines`}>
          −{removed}
        </span>
      </div>
      <ScrollArea
        className="max-h-64 bg-background/40"
        orientation="both"
        contentClassName="text-[11px] leading-5"
      >
        {hunks.map((lines, index) => (
          <div key={index}>
            <div className="border-y border-border/50 bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
              Patch {index + 1} of {hunks.length}
            </div>
            <pre className="selectable w-max min-w-full py-1 font-mono">
              {lines.map((line, number) => (
                <div
                  key={number}
                  className={cn(
                    'flex px-3',
                    line.kind === 'add' && 'bg-success/8 text-success',
                    line.kind === 'remove' && 'bg-destructive/8 text-destructive'
                  )}
                >
                  <span aria-hidden="true" className="w-5 shrink-0 opacity-60">
                    {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
                  </span>
                  <span>{line.text || ' '}</span>
                </div>
              ))}
            </pre>
          </div>
        ))}
      </ScrollArea>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        <Badge variant="secondary" className="text-[9px]">
          Focused patch
        </Badge>
        {edits.length} {edits.length === 1 ? 'replacement' : 'replacements'} · Surrounding code is
        preserved
      </div>
    </div>
  )
}
