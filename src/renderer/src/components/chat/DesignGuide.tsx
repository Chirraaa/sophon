import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { useId, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  contrastRatio,
  defaultDesignPreferences,
  designColors,
  designFonts,
  designPalettes,
  type DesignPreferences
} from '@/hooks/useDesignGuide'
import { cn } from '@/lib/utils'

function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const errorId = useId()
  const [draft, setDraft] = useState({ source: value, hex: value })
  const hex = draft.source === value ? draft.hex : value
  if (draft.source !== value) setDraft({ source: value, hex: value })
  const valid = /^#[0-9a-f]{6}$/i.test(hex)
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs">
      <Input
        type="color"
        aria-label={`${label} color`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
      />
      <span className="flex-1">{label}</span>
      <Input
        aria-label={`${label} hex`}
        aria-invalid={!valid}
        aria-describedby={!valid ? errorId : undefined}
        value={hex}
        maxLength={7}
        onChange={(event) => {
          setDraft({ source: value, hex: event.target.value })
          if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(event.target.value)
        }}
        className="w-20 rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-[11px]"
      />
      {!valid && (
        <span id={errorId} role="alert" className="w-full text-[10px] text-destructive">
          Use a six-digit hex color, such as #6d28d9.
        </span>
      )}
    </label>
  )
}

function Choices<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option.value}
            variant="outline"
            size="sm"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 text-xs',
              value === option.value && 'border-foreground/40 bg-accent'
            )}
          >
            <Check className={cn('size-3 shrink-0', value !== option.value && 'opacity-0')} />
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  )
}

export function DesignGuide({
  open,
  onOpenChange,
  preferences: value,
  update,
  disabled
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferences: DesignPreferences
  update: (patch: Partial<DesignPreferences>) => void
  disabled: boolean
}): React.JSX.Element {
  const [saved, setSaved] = useState(false)
  const colors = designColors(value)
  const radius = value.shape === 'round' ? 28 : value.shape === 'soft' ? 16 : 3
  const contrast = Math.min(
    contrastRatio(colors.foreground, colors.background),
    contrastRatio(colors.foreground, colors.surface)
  )

  const rgb = value.accent
    .slice(1)
    .match(/../g)!
    .map((part) => {
      const channel = parseInt(part, 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
  const buttonText =
    rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#111111' : '#ffffff'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] p-0" closeLabel="Close design guide">
        <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <Palette className="size-4 text-muted-foreground" />
            Design guide
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-xs text-muted-foreground">
            Choose a direction. Try it below, then attach it to your request.
          </DialogDescription>
        </div>
        <ScrollArea
          className="min-h-0"
          viewportClassName="overscroll-contain"
          contentClassName="p-5"
        >
          <fieldset className="mb-5" disabled={disabled}>
            <legend className="mb-2 text-xs font-medium">Start with a direction</legend>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    palette: 5,
                    accent: '#52525b',
                    customPalette: false,
                    secondary: '#0f766e',
                    font: 'sans',
                    customFont: '',
                    appearance: 'light',
                    spacing: 'airy',
                    shape: 'sharp',
                    surfaceStyle: 'flat',
                    motion: 'none'
                  })
                }
              >
                Quiet minimal
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    palette: 2,
                    accent: '#9a3412',
                    customPalette: false,
                    secondary: '#0f766e',
                    font: 'serif',
                    customFont: '',
                    appearance: 'light',
                    spacing: 'airy',
                    shape: 'soft',
                    surfaceStyle: 'outlined',
                    motion: 'subtle'
                  })
                }
              >
                Warm editorial
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    palette: 1,
                    accent: '#1d4ed8',
                    customPalette: false,
                    secondary: '#0f766e',
                    font: 'sans',
                    customFont: '',
                    appearance: 'dark',
                    spacing: 'compact',
                    shape: 'soft',
                    surfaceStyle: 'elevated',
                    motion: 'subtle'
                  })
                }
              >
                Focused workspace
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    palette: 4,
                    accent: '#be123c',
                    customPalette: false,
                    secondary: '#0f766e',
                    font: 'sans',
                    customFont: '',
                    appearance: 'light',
                    spacing: 'balanced',
                    shape: 'round',
                    surfaceStyle: 'elevated',
                    motion: 'expressive'
                  })
                }
              >
                Playful studio
              </Button>
            </div>
          </fieldset>
          <div className="grid gap-5 min-[720px]:grid-cols-2">
            <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
              <fieldset>
                <legend className="mb-2 text-xs font-medium">
                  What color palette do you have in mind?
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {designPalettes.map((item, index) => (
                    <Button
                      key={item.name}
                      type="button"
                      variant="outline"
                      aria-pressed={
                        !value.customPalette &&
                        value.palette === index &&
                        value.accent === item.accent
                      }
                      onClick={() =>
                        update({ palette: index, accent: item.accent, customPalette: false })
                      }
                      className={cn(
                        'h-auto min-w-0 flex-col items-stretch gap-0 rounded-xl p-2 text-left whitespace-normal',
                        !value.customPalette &&
                          value.palette === index &&
                          value.accent === item.accent &&
                          'border-foreground/40'
                      )}
                    >
                      <span className="mb-2 flex overflow-hidden rounded-md" aria-hidden="true">
                        {[item.light, item.accent, item.dark].map((color) => (
                          <span key={color} className="h-6 flex-1" style={{ background: color }} />
                        ))}
                      </span>
                      <span className="flex items-center justify-between gap-1 text-[10px]">
                        {item.name}
                        <Check
                          className={cn(
                            'size-3 shrink-0',
                            (value.customPalette ||
                              value.palette !== index ||
                              value.accent !== item.accent) &&
                              'opacity-0'
                          )}
                        />
                      </span>
                    </Button>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  <ColorField
                    label="Custom accent"
                    value={value.accent}
                    onChange={(accent) => update({ accent })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={value.customPalette}
                    onClick={() => update({ ...colors, customPalette: !value.customPalette })}
                  >
                    {value.customPalette ? 'Use preset colors' : 'Customize the whole palette'}
                  </Button>
                  {value.customPalette && (
                    <div className="space-y-2 rounded-xl border border-border p-3">
                      {(['background', 'surface', 'foreground', 'secondary'] as const).map(
                        (token) => (
                          <ColorField
                            key={token}
                            label={
                              {
                                background: 'Background',
                                surface: 'Surface',
                                foreground: 'Text',
                                secondary: 'Secondary'
                              }[token]
                            }
                            value={value[token]}
                            onChange={(color) => update({ [token]: color })}
                          />
                        )
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Your exact colors stay the same when switching appearance.
                      </p>
                    </div>
                  )}
                </div>
              </fieldset>
              <Choices
                label="Which font style feels right?"
                value={value.font}
                options={Object.entries(designFonts).map(([key, font]) => ({
                  value: key as keyof typeof designFonts,
                  label: font.label
                }))}
                onChange={(font) => update({ font, customFont: '' })}
              />
              <label className="text-xs font-medium">
                Custom font family
                <Input
                  aria-label="Custom font family"
                  value={value.customFont}
                  maxLength={100}
                  onChange={(event) => update({ customFont: event.target.value })}
                  placeholder="e.g. Avenir Next, sans-serif"
                  className="mt-2 w-full text-xs font-normal"
                />
                <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                  Uses a local font when available; otherwise previews a fallback.
                </span>
              </label>
              <Choices
                label="Light or dark?"
                value={value.appearance}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' }
                ]}
                onChange={(appearance) => update({ appearance })}
              />
              <Choices
                label="Corners"
                value={value.shape}
                options={[
                  { value: 'soft', label: 'Soft & rounded' },
                  { value: 'sharp', label: 'Crisp & sharp' },
                  { value: 'round', label: 'Extra rounded' }
                ]}
                onChange={(shape) => update({ shape })}
              />
              <Choices
                label="Layout spacing"
                value={value.spacing}
                options={[
                  { value: 'airy', label: 'Airy' },
                  { value: 'compact', label: 'Compact' },
                  { value: 'balanced', label: 'Balanced' }
                ]}
                onChange={(spacing) => update({ spacing })}
              />
              <Choices
                label="Surface treatment"
                value={value.surfaceStyle}
                options={[
                  { value: 'flat', label: 'Flat' },
                  { value: 'outlined', label: 'Outlined' },
                  { value: 'elevated', label: 'Elevated' }
                ]}
                onChange={(surfaceStyle) => update({ surfaceStyle })}
              />
              <Choices
                label="Motion"
                value={value.motion}
                options={[
                  { value: 'none', label: 'Still' },
                  { value: 'subtle', label: 'Subtle' },
                  { value: 'expressive', label: 'Expressive' }
                ]}
                onChange={(motion) => update({ motion })}
              />
              <label className="text-xs font-medium">
                Anything else?
                <Textarea
                  value={value.notes}
                  maxLength={1000}
                  rows={2}
                  onChange={(event) => update({ notes: event.target.value })}
                  placeholder="Brand colors, a font name, examples you like…"
                  className="mt-2 block w-full resize-y text-xs font-normal"
                />
              </label>
            </fieldset>
            <section aria-label="Live design preview" className="min-w-0">
              <div className="sticky top-0">
                <p className="mb-2 text-xs font-medium">
                  Quick trial{' '}
                  <span className="font-normal text-muted-foreground">· Sample interface</span>
                </p>
                <div
                  data-design-preview
                  style={{
                    background: colors.background,
                    color: colors.foreground,
                    fontFamily: value.customFont.trim() || designFonts[value.font].family,
                    borderRadius: radius,
                    padding: value.spacing === 'airy' ? 24 : value.spacing === 'balanced' ? 19 : 14
                  }}
                  className="border border-black/10 transition-[padding,border-radius,background-color] motion-reduce:transition-none"
                >
                  <div className="mb-7 flex items-center justify-between gap-2 text-[10px]">
                    <span className="font-bold tracking-widest">STUDIO</span>
                    <span>Overview</span>
                  </div>
                  <p className="mb-2 text-[10px] tracking-widest uppercase opacity-65">
                    A little inspiration
                  </p>
                  <h3 className="text-[27px] leading-tight font-medium tracking-tight">
                    Make room for
                    <br />
                    your next idea.
                  </h3>
                  <p className="mt-3 text-xs leading-relaxed opacity-75">
                    A calm place to bring your projects, plans and people together.
                  </p>
                  <div
                    className="my-5"
                    style={{
                      background: colors.surface,
                      border:
                        value.surfaceStyle === 'outlined'
                          ? '1px solid currentColor'
                          : '1px solid transparent',
                      boxShadow:
                        value.surfaceStyle === 'elevated' ? '0 8px 24px #00000020' : 'none',
                      borderRadius: radius,
                      padding: value.spacing === 'airy' ? 16 : 10
                    }}
                  >
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: colors.secondary }}
                      />
                      Your next project
                    </div>
                    <p className="mt-2 text-[11px] opacity-65">
                      Everything you need, in one place.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setSaved(!saved)}
                    aria-pressed={saved}
                    style={{
                      background: value.accent,
                      color: buttonText,
                      borderRadius: Math.min(radius, 12)
                    }}
                    className={cn(
                      'flex min-h-10 w-full items-center justify-center gap-2 px-3 text-xs font-medium motion-reduce:transform-none motion-reduce:transition-none',
                      value.motion === 'none' ? 'transition-none' : 'transition-all duration-300',
                      value.motion === 'expressive' && saved && 'scale-95'
                    )}
                  >
                    {saved && <Check className="size-3.5" />}
                    {saved ? 'Added to your workspace' : 'Try this button'}
                  </Button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  Colors, typography and spacing update as you choose. Your project will use its own
                  content.
                </p>
                <p
                  role="status"
                  className={cn(
                    'mt-3 rounded-lg border px-3 py-2 text-[11px]',
                    contrast < 4.5
                      ? 'border-amber-500/40 text-amber-600 dark:text-amber-300'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  Text contrast {contrast.toFixed(2)}:1 ·{' '}
                  {contrast >= 4.5
                    ? 'Meets 4.5:1 for normal text'
                    : 'Below 4.5:1 — adjust text or background colors'}
                  <span className="mt-1 block">
                    Checks solid text on both backgrounds. Final components still need accessibility
                    review.
                  </span>
                </p>
              </div>
            </section>
          </div>
        </ScrollArea>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => update({ ...defaultDesignPreferences })}
          >
            Reset choices
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              update({ attached: true })
              onOpenChange(false)
            }}
          >
            Attach design brief
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
