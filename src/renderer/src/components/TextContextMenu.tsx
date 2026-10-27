import { useRef, useState, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import { Button } from './ui/button'

type TextField = HTMLInputElement | HTMLTextAreaElement
type Target = {
  element: HTMLElement | null
  field: TextField | null
  start: number | null
  end: number | null
  range: Range | null
  text: string
  editable: boolean
  secret: boolean
}

export function TextContextMenu({ children }: { children: ReactNode }): React.JSX.Element {
  const target = useRef<Target | null>(null)
  const [current, setCurrent] = useState<Target | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restore = (): void => {
    const saved = target.current
    if (!saved?.element?.isConnected) return
    saved.element.focus({ preventScroll: true })
    if (saved.field && saved.start !== null && saved.end !== null) {
      saved.field.setSelectionRange(saved.start, saved.end)
    } else if (saved.range) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(saved.range)
    }
  }

  const act = async (action: 'copy' | Parameters<Api['editText']>[0]): Promise<void> => {
    setError(null)
    setOpen(false)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      restore()
      if (action === 'copy') await window.api.copyText(target.current?.text ?? '')
      else await window.api.editText(action)
    } catch {
      setError(
        `Could not ${action === 'selectAll' ? 'select text' : action}. Try the keyboard shortcut or open the menu again.`
      )
    }
  }

  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger
        className="contents"
        onContextMenuCapture={(event) => {
          const node = event.target instanceof HTMLElement ? event.target : null
          const element =
            node?.closest<HTMLElement>('input, textarea, [contenteditable="true"]') ?? node
          const field =
            element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
              ? element
              : null
          const selection = window.getSelection()
          const start = field?.selectionStart ?? null
          const end = field?.selectionEnd ?? null
          const secret = field instanceof HTMLInputElement && field.type === 'password'
          const saved: Target = {
            element,
            field,
            start,
            end,
            secret,
            editable: field
              ? !field.disabled && !field.readOnly && start !== null
              : element?.isContentEditable === true,
            text: secret
              ? ''
              : field && start !== null && end !== null
                ? field.value.slice(start, end)
                : (selection?.toString() ?? ''),
            range: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
          }
          target.current = saved
          setCurrent(saved)
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label="Text actions"
        finalFocus={() => (target.current?.element?.isConnected ? target.current.element : false)}
      >
        {current?.editable && (
          <>
            <ContextMenuItem onClick={() => void act('undo')}>
              Undo <span className="text-xs text-muted-foreground">Ctrl+Z</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void act('redo')}>
              Redo <span className="text-xs text-muted-foreground">Ctrl+Y</span>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!current.text || current.secret}
              onClick={() => void act('cut')}
            >
              Cut <span className="text-xs text-muted-foreground">Ctrl+X</span>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem
          disabled={!current?.text || current.secret}
          onClick={() => void act('copy')}
        >
          Copy <span className="text-xs text-muted-foreground">Ctrl+C</span>
        </ContextMenuItem>
        {current?.editable && (
          <ContextMenuItem onClick={() => void act('paste')}>
            Paste <span className="text-xs text-muted-foreground">Ctrl+V</span>
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => void act('selectAll')}>
          Select all <span className="text-xs text-muted-foreground">Ctrl+A</span>
        </ContextMenuItem>
      </ContextMenuContent>
      {error && (
        <div
          role="alert"
          className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-2 rounded-lg border border-destructive/40 bg-background p-3 text-sm text-destructive shadow-lg"
        >
          {error}
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}
    </ContextMenu>
  )
}
