import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CopyButton({
  text,
  label = 'Copy response'
}: {
  text: string
  label?: string
}): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    try {
      await window.api.copyText(text)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 2000)
  }
  const title =
    status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed. Try again' : label
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={title}
        title={title}
        onClick={() => void copy()}
      >
        {status === 'copied' ? <Check /> : <Copy />}
      </Button>
      <span className="sr-only" role="status">
        {status === 'idle' ? '' : title}
      </span>
    </>
  )
}
