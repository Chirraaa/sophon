import { Spinner } from '@/components/ui/spinner'
import { useEffect, useRef } from 'react'
import { ArrowUp, Camera, Palette, Paperclip, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useVoice } from '@/hooks/useVoice'
import { useSettings } from '@/hooks/useSettings'
import { useComposer } from '@/hooks/useComposer'
import { AttachmentView } from './chat/AttachmentView'
import { VoiceButton } from './chat/VoiceButton'
import { useState } from 'react'
import { ReasoningEffort } from './ReasoningEffort'
import { DesignGuide } from './chat/DesignGuide'
import { designBrief, useDesignGuide } from '@/hooks/useDesignGuide'
import { CodingMode } from './CodingMode'
import { ContextUsage } from './ContextUsage'
import { useModelInfo } from '@/hooks/useModelInfo'
type Props = {
  onSend: (text: string, attachments: string[]) => Promise<void>
  chatId: string
  busy: boolean
  focusToken?: number
  autoFocus?: boolean
  variant?: 'panel' | 'bar'
  placeholder?: string
  onDesignGuideChange?: (open: boolean) => void
  onDraftChange?: (active: boolean) => void
}
export function Composer({
  onSend,
  chatId,
  busy,
  focusToken = 0,
  autoFocus = true,
  variant = 'panel',
  onDesignGuideChange,
  onDraftChange,
  placeholder = 'Ask anything, or ask me to do something…'
}: Props): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const voice = useVoice()
  const settings = useSettings()
  const modelInfo = useModelInfo(settings)
  const design = useDesignGuide(chatId)
  const [guideOpen, setGuideOpen] = useState(false)
  const openGuide = (open: boolean): void => {
    setGuideOpen(open)
    onDesignGuideChange?.(open)
  }
  useEffect(() => () => onDesignGuideChange?.(false), [onDesignGuideChange])
  useEffect(() => {
    const show = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === chatId) {
        setGuideOpen(true)
        onDesignGuideChange?.(true)
      }
    }
    window.addEventListener('open-design-guide', show)
    return () => window.removeEventListener('open-design-guide', show)
  }, [chatId, onDesignGuideChange])
  const [recovery, setRecovery] = useState<{ required: boolean; backup?: string } | null>(null)
  const [stopError, setStopError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const reviewRecovery = async (): Promise<void> => {
    setRecovering(true)
    setStopError('')
    try {
      await window.api.reviewSettingsRecovery()
      setRecovery(await window.api.settingsRecovery())
    } catch (cause) {
      setStopError(
        cause instanceof Error ? cause.message : 'Could not review security settings. Try again.'
      )
    } finally {
      setRecovering(false)
    }
  }
  useEffect(() => {
    void window.api
      .settingsRecovery()
      .then(setRecovery)
      .catch(() => setRecovery(null))
  }, [])
  const recording = voice.phase === 'starting' || voice.phase === 'listening'
  const voiceBusy = recording || voice.phase === 'transcribing'
  const hold = settings?.voice.mode !== 'toggle'
  const draft = useComposer(chatId, busy || voiceBusy, async (text, attachments) => {
    await onSend(
      design.preferences.attached
        ? [text, designBrief(design.preferences)].filter(Boolean).join('\n\n')
        : text,
      attachments
    )
    if (design.preferences.attached) design.update({ attached: false })
  })
  const disabled = busy || voiceBusy || draft.loading || draft.sending
  const draftActive = draft.text.length > 0 || draft.attachments.length > 0
  useEffect(() => {
    onDraftChange?.(draftActive)
  }, [draftActive, onDraftChange])
  const bar = variant === 'bar'
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [focusToken, autoFocus])
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = element.scrollHeight + 'px'
  }, [draft.text])
  return (
    <div>
      <DesignGuide
        open={guideOpen}
        onOpenChange={openGuide}
        preferences={design.preferences}
        update={(patch) => {
          design.update(patch)
          if (patch.attached && !draft.text.trim())
            draft.setText('Continue the previous task; use this design direction.')
        }}
        disabled={disabled}
      />
      {recovery?.required && (
        <div
          role="alert"
          className="mb-3 rounded border border-amber-300/30 p-3 text-xs text-amber-100"
        >
          Security settings could not be loaded. Custom protections may be missing. Tools and screen
          capture are blocked until you review them. Original backup:{' '}
          {recovery.backup ?? 'see application data folder'}
          <Button
            variant="outline"
            size="sm"
            disabled={recovering}
            onClick={() => void reviewRecovery()}
          >
            {recovering ? 'Reviewing…' : 'Review recovery'}
          </Button>
        </div>
      )}
      <div
        className={cn(
          'composer no-drag rounded-[19px] p-3 transition-[border-color,box-shadow] duration-300',
          bar && 'rounded-[18px] p-2.5'
        )}
      >
        {design.preferences.attached && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-[11px]">
            <Palette className="size-3 shrink-0 text-muted-foreground" />
            <Button
              variant="ghost"
              type="button"
              disabled={disabled}
              onClick={() => openGuide(true)}
              className="h-auto min-w-0 truncate p-0 text-left text-[11px] hover:underline"
            >
              Design brief attached · Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label="Remove design brief"
              className="ml-auto shrink-0"
              onClick={() => design.update({ attached: false })}
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
        {!!draft.attachments.length && (
          <div className="flex flex-wrap gap-3 px-2 pt-2 pb-3">
            {draft.attachments.map((attachment) => (
              <AttachmentView
                key={attachment.id}
                attachment={attachment}
                compact
                onRemove={() => draft.remove(attachment.id)}
                onPreviewError={() => draft.unavailable(attachment.id)}
              />
            ))}
          </div>
        )}
        <ScrollArea className="max-h-[140px]" viewportClassName="overscroll-contain">
          <Textarea
            ref={ref}
            value={draft.text}
            rows={1}
            aria-label="Message Sophon"
            onChange={(event) => draft.setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.metaKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                void draft.submit()
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            className="selectable min-h-10 resize-none overflow-hidden rounded-none border-0 bg-transparent! px-1.5 py-2 text-[13px] leading-6 shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
          />
        </ScrollArea>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled || draft.attachments.length >= 4}
              aria-label="Attach images or text files"
              title="Attach images or text files"
              onClick={() => void draft.attach('file')}
              className="size-8 rounded-full text-muted-foreground"
            >
              <Paperclip className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled || draft.attachments.length >= 4}
              aria-label="Take screenshot"
              title="Capture the last active window"
              onClick={() => void draft.attach('screen')}
              className="size-8 rounded-full text-muted-foreground"
            >
              <Camera className="size-3.5" />
            </Button>
            {settings?.files.workspace && (
              <CodingMode value={settings.coding?.mode ?? 'ask-before-edit'} disabled={disabled} />
            )}
            {draft.loading && <Spinner className="ml-1 size-3 text-muted-foreground" />}
            {settings && ['openai', 'chatgpt'].includes(settings.model.provider) && (
              <ReasoningEffort
                value={settings.model.reasoningEffort}
                model={modelInfo}
                disabled={disabled}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {settings?.voice.enabled && (
              <VoiceButton
                disabled={busy || draft.sending || voice.phase === 'transcribing'}
                recording={recording}
                hold={hold}
              />
            )}
            <Button
              size="icon"
              onClick={() => {
                setStopError('')
                if (busy)
                  void window.api.stop().catch((error: Error) => setStopError(error.message))
                else void draft.submit()
              }}
              disabled={!busy && ((!draft.text.trim() && !draft.attachments.length) || disabled)}
              aria-label={busy ? 'Stop response' : 'Send message'}
              title={busy ? 'Stop response' : 'Send message'}
              className="size-8 rounded-full shadow-sm disabled:opacity-25"
            >
              {busy ? (
                <Square className="size-3.5" fill="currentColor" />
              ) : voice.phase === 'transcribing' ? (
                <Spinner className="size-4" />
              ) : (
                <ArrowUp className="size-4" strokeWidth={2} />
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-end">
        <ContextUsage provider={settings?.model.provider} />
      </div>
      {(draft.error || stopError) && (
        <p role="alert" className="mt-2 px-2 text-xs text-destructive">
          {draft.error || stopError}
        </p>
      )}
      {voice.phase !== 'idle' && (
        <div
          className="mt-2 flex items-center justify-between gap-2 px-2 text-xs"
          role="status"
          aria-live="polite"
        >
          <span className={voice.phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
            {voice.phase === 'starting'
              ? 'Opening microphone…'
              : voice.phase === 'listening'
                ? hold
                  ? 'Listening… release to send'
                  : 'Listening… click the microphone to send'
                : voice.phase === 'transcribing'
                  ? 'Transcribing on this computer…'
                  : voice.error}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void window.api.voice.cancel()}
            aria-label={voice.phase === 'error' ? 'Dismiss voice error' : 'Cancel recording'}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
