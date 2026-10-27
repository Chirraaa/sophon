import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '../ui/switch'
import { useRef, useState } from 'react'
import { Button } from '../ui/button'
import { Hint } from '../ui/tooltip'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export function PageLink({
  url,
  children
}: {
  url: string
  children: React.ReactNode
}): React.JSX.Element {
  const [choosing, setChoosing] = useState(false)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PagePreview | null>(null)
  const inFlight = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (): void => {
    if (inFlight.current) return
    setChoosing(false)
    setPreview(null)
    setError('')
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const open = async (destination: PageDestination, save = remember): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      setPreview(await window.api.pages.open(url, destination, save))
      setChoosing(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const choose = async (): Promise<void> => {
    setError('')
    try {
      if (/\.pdf(?:[?#]|$)/i.test(url)) {
        await open('reader', false)
        return
      }
      const preference = await window.api.pages.preference()
      if (preference) await open(preference, false)
      else setChoosing(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  if (!/^https:\/\//i.test(url)) return <span>{children}</span>
  return (
    <span>
      <Hint text={url}>
        <Button
          ref={trigger}
          variant="link"
          type="button"
          disabled={busy}
          onClick={() => void choose()}
          className="h-auto cursor-pointer p-0 whitespace-normal break-words text-tint underline underline-offset-2"
        >
          {busy ? 'Opening…' : children}
        </Button>
      </Hint>
      <Dialog
        open={!!(choosing || preview || error)}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <DialogContent
          aria-label="Open web page"
          finalFocus={trigger}
          showCloseButton={false}
          className="h-[85vh] w-[90vw] max-w-[900px] gap-3"
        >
          <span className="flex items-center justify-between gap-3">
            <DialogTitle className="font-semibold">
              {preview?.title || 'Where would you like to open this page?'}
            </DialogTitle>
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              Close
            </Button>
          </span>
          <span className="break-all text-xs text-muted-foreground">{preview?.url || url}</span>
          {choosing && (
            <span className="flex flex-wrap items-center gap-3">
              <Button disabled={busy} onClick={() => void open('reader')}>
                Read in Sophon
              </Button>
              <Button disabled={busy} onClick={() => void open('browser')}>
                Open in browser
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  aria-label="Remember my choice"
                  checked={remember}
                  onCheckedChange={setRemember}
                />
                Remember my choice
              </label>
            </span>
          )}
          {preview && (
            <>
              <span className="text-xs text-muted-foreground">
                {preview.pages ? 'PDF preview' : 'Text reader'}
                {preview.truncated ? ' · shortened page' : ''}
              </span>
              <ScrollArea className="min-h-0 flex-1">
                <span className="whitespace-pre-wrap text-sm leading-relaxed">
                  {preview.pages
                    ? preview.pages.map((page, index) => (
                        <img
                          key={index}
                          src={page}
                          alt={'PDF page ' + (index + 1)}
                          className="mb-3 w-full"
                        />
                      ))
                    : preview.text || 'No readable text found.'}
                </span>
              </ScrollArea>
              <Button variant="outline" disabled={busy} onClick={() => void open('browser', false)}>
                Open original in browser
              </Button>
            </>
          )}
          {error && (
            <span role="alert" className="text-sm text-destructive">
              {error}
            </span>
          )}
        </DialogContent>
      </Dialog>
    </span>
  )
}
