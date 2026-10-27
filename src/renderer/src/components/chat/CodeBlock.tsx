import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CodeBlock({
  source,
  language,
  children
}: {
  source: string
  language?: string
  children: ReactNode
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    try {
      await window.api.copyText(source)
      setError(false)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(true)
    }
  }
  return (
    <div
      data-code-block
      className="my-4 min-w-0 overflow-hidden rounded-xl border border-border bg-card text-left"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{language || 'text'}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={copied ? 'Code copied' : 'Copy code'}
          onClick={() => void copy()}
          className="h-6 gap-1.5 px-1.5 text-[10px] font-normal text-muted-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span role="status">{copied ? 'Copied' : error ? 'Retry copy' : 'Copy'}</span>
        </Button>
      </div>
      <ScrollArea className="max-h-[32rem] max-w-full" orientation="both">
        <pre
          tabIndex={0}
          aria-label={`${language || 'Plain text'} code`}
          className="selectable p-4 font-mono text-xs leading-6 whitespace-pre"
        >
          {children}
        </pre>
      </ScrollArea>
    </div>
  )
}
