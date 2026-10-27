import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef, useState } from 'react'
import { Download, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogTrigger
} from '@/components/ui/dialog'
export function AttachmentView({
  attachment,
  compact = false,
  onRemove,
  onPreviewError
}: {
  attachment: ChatAttachment
  compact?: boolean
  onRemove?: () => void
  onPreviewError?: () => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<{
    url?: string
    text?: string
  } | null>(null)
  const [image, setImage] = useState<{ id: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previewError = useRef(onPreviewError)
  useEffect(() => {
    previewError.current = onPreviewError
  }, [onPreviewError])
  useEffect(() => {
    let alive = true
    let imageId: string | undefined
    void window.api.attachments
      .preview(attachment.id)
      .then(async (data) => {
        if (alive) setPreview(data)
        if (data.url) {
          const resource = await window.api.visuals.image(data.url)
          imageId = resource.id
          if (alive) setImage(resource)
          else await window.api.visuals.release(resource.id)
        }
      })
      .catch((error: Error) => {
        if (alive) {
          setError(error.message)
          previewError.current?.()
        }
      })
    return () => {
      alive = false
      if (imageId) void window.api.visuals.release(imageId)
    }
  }, [attachment.id])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="relative min-w-0 max-w-full rounded-xl border border-white/10 bg-white/3">
        <DialogTrigger
          render={<Button variant="ghost" />}
          type="button"
          className="block h-auto max-w-full overflow-hidden p-0 rounded-xl text-left"
          aria-label={'Preview ' + attachment.name}
        >
          {image ? (
            <iframe
              src={image.url}
              title={attachment.name}
              sandbox=""
              referrerPolicy="no-referrer"
              style={{ pointerEvents: 'none' }}
              className={compact ? 'h-14 w-20 border-0' : 'h-72 w-80 max-w-full border-0'}
            />
          ) : (
            <span className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <FileText className="size-4 shrink-0" />
              <span className="max-w-44 truncate">{attachment.name}</span>
            </span>
          )}
        </DialogTrigger>
        {onRemove && (
          <Button
            size="icon-xs"
            variant="secondary"
            onClick={onRemove}
            aria-label={'Remove ' + attachment.name}
            className="absolute -top-2 -right-2 size-5 rounded-full"
          >
            <X className="size-3" />
          </Button>
        )}
        <DialogContent
          initialFocus={closeButton}
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[900px] p-0"
          showCloseButton={false}
        >
          <ScrollArea className="max-h-[calc(100dvh-2rem-2px)]" contentClassName="p-4">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
              <DialogTitle className="truncate text-sm">{attachment.name}</DialogTitle>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Save attachment"
                  onClick={() => {
                    void window.api.attachments
                      .save(attachment.id)
                      .catch((error: Error) => setError(error.message))
                  }}
                >
                  <Download className="size-4" />
                </Button>
                <DialogClose
                  ref={closeButton}
                  render={<Button variant="ghost" size="icon" />}
                  aria-label="Close preview"
                >
                  <X className="size-4" />
                </DialogClose>
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : image ? (
              <iframe
                src={image.url}
                title={attachment.name + ' preview'}
                sandbox=""
                referrerPolicy="no-referrer"
                className="mx-auto h-[65vh] w-full border-0"
              />
            ) : (
              <ScrollArea className="max-h-[70vh]" orientation="both">
                <pre className="selectable whitespace-pre-wrap text-xs leading-relaxed">
                  {preview?.text ?? 'Loading…'}
                </pre>
              </ScrollArea>
            )}
          </ScrollArea>
        </DialogContent>
      </div>
    </Dialog>
  )
}
