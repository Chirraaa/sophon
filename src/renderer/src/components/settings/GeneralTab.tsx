import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { HotkeyField } from './HotkeyField'
import { PillButton, Row, Section, Segmented, Toggle } from './controls'
import { save } from './save'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { PrivacySection } from './PrivacySection'
import { ColorField } from './fields/ColorField'
import { Hint } from '../ui/tooltip'
import { UpdatesSettings } from '../AppUpdates'
const ACCENTS: {
  id: AccentName
  label: string
  color: string
}[] = [
  { id: 'violet', label: 'Violet', color: 'oklch(0.68 0.19 285)' },
  { id: 'blue', label: 'Blue', color: 'oklch(0.68 0.17 250)' },
  { id: 'teal', label: 'Teal', color: 'oklch(0.76 0.12 195)' },
  { id: 'rose', label: 'Rose', color: 'oklch(0.7 0.19 10)' },
  { id: 'amber', label: 'Amber', color: 'oklch(0.8 0.15 75)' }
]
export function GeneralTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <Tabs defaultValue="appearance" className="gap-4">
      <TabsList
        aria-label="General sections"
        className="flex h-auto max-w-full flex-wrap justify-start gap-1"
      >
        <TabsTrigger value="appearance" className="px-3 py-2 text-xs">
          Appearance
        </TabsTrigger>
        <TabsTrigger value="window" className="px-3 py-2 text-xs">
          Window & shortcuts
        </TabsTrigger>
        <TabsTrigger value="privacy" className="px-3 py-2 text-xs">
          Privacy
        </TabsTrigger>
        <TabsTrigger value="advanced" className="px-3 py-2 text-xs">
          Advanced
        </TabsTrigger>
        <TabsTrigger value="updates" className="px-3 py-2 text-xs">
          Updates
        </TabsTrigger>
      </TabsList>
      <TabsContent value="updates">
        <UpdatesSettings />
      </TabsContent>
      <TabsContent value="appearance" className="space-y-4">
        <Section title="Appearance">
          <Row
            label="Animations"
            hint="Smooth transitions, your Windows preference, or reduced motion."
          >
            <Segmented
              value={settings.motion}
              options={[
                { value: 'full', label: 'Smooth' },
                { value: 'system', label: 'System' },
                { value: 'reduced', label: 'Reduced' }
              ]}
              onChange={(motion) => void save({ motion })}
            />
          </Row>
          <Row label="Accent color" hint="A subtle personal touch for small highlights.">
            <div className="flex flex-wrap items-center gap-3">
              {ACCENTS.map((a) => (
                <Hint key={a.id} text={a.label}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={a.label}
                    aria-pressed={settings.accent === a.id}
                    onClick={() => void save({ accent: a.id })}
                    className={cn(
                      'size-6 p-0 rounded-full outline-none transition-[transform,box-shadow] hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card',
                      settings.accent === a.id
                        ? 'ring-2 ring-foreground/80 ring-offset-2 ring-offset-transparent'
                        : ''
                    )}
                    style={{ background: a.color }}
                  />
                </Hint>
              ))}
              <ColorField
                label="Custom accent color"
                value={settings.accent.startsWith('#') ? settings.accent : '#a78bfa'}
                onCommit={(accent) => void save({ accent: accent as AccentName })}
              />
            </div>
          </Row>
        </Section>
        <Section title="Screen observation">
          <Row
            label="Screen glow"
            hint="A subtle aura around the observed monitor while the model reads a screenshot."
          >
            <Toggle
              checked={settings.screenGlow.enabled}
              onChange={(enabled) => void save({ screenGlow: { enabled } })}
            />
          </Row>
          <Row
            label="Glow color"
            hint="Choose a palette color or pick your own. Reduced motion keeps the glow still."
          >
            <div className="flex flex-wrap items-center gap-3">
              {[
                ['Violet', '#a78bfa'],
                ['Blue', '#60a5fa'],
                ['Teal', '#2dd4bf'],
                ['Rose', '#fb7185'],
                ['Amber', '#fbbf24']
              ].map(([label, color]) => (
                <Hint key={color} text={label}>
                  <Button
                    variant="ghost"
                    type="button"
                    aria-label={`${label} screen glow`}
                    aria-pressed={settings.screenGlow.color === color}
                    onClick={() => void save({ screenGlow: { color } })}
                    className={cn(
                      'size-6 p-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
                      settings.screenGlow.color === color &&
                        'ring-2 ring-foreground/80 ring-offset-2 ring-offset-card'
                    )}
                    style={{ background: color }}
                  />
                </Hint>
              ))}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ColorField
                  label="Custom screen glow color"
                  value={settings.screenGlow.color}
                  onCommit={(color) => void save({ screenGlow: { color } })}
                />
              </div>
            </div>
          </Row>
        </Section>
      </TabsContent>
      <TabsContent value="window" className="space-y-4">
        <Section title="Window">
          <Row
            label="Keep running in the tray"
            hint="It stays in the tray, so the quick-command shortcut keeps working. Quit from the tray icon."
          >
            <Toggle
              checked={settings.closeToTray}
              onChange={(v) => void save({ closeToTray: v })}
            />
          </Row>
          <Row
            label="Alert me from the dock"
            hint="When the full app is closed or in the background, the shortcut dock slides in at the top of the screen as soon as a task finishes or needs your approval."
          >
            <Toggle checked={settings.dockNotify} onChange={(v) => void save({ dockNotify: v })} />
          </Row>
          <Row
            label="Keep a minimized dock on screen"
            hint="A slim bar stays at the top of the screen while the full app is hidden. Hover it to open the shortcut window."
          >
            <Toggle
              checked={settings.dockAlwaysVisible}
              onChange={(v) => void save({ dockAlwaysVisible: v })}
            />
          </Row>
          <Row
            label="Start with Windows"
            hint="Starts hidden in the tray. This only takes effect in the installed app, not while developing."
          >
            <Toggle
              checked={settings.launchAtStartup}
              onChange={(v) => void save({ launchAtStartup: v })}
            />
          </Row>
        </Section>
        <Section
          title="Shortcuts"
          description="Works from anywhere in Windows, even when the app is hidden."
        >
          <Row label="Quick command" hint="Opens or closes the small command bar.">
            <HotkeyField
              value={settings.hotkeys.summon}
              onSave={(summon) => save({ hotkeys: { summon } })}
            />
          </Row>
        </Section>
      </TabsContent>
      <TabsContent value="privacy" className="space-y-4">
        <PrivacySection settings={settings} />
      </TabsContent>
      <TabsContent value="advanced" className="space-y-4">
        <Section title="Advanced">
          <Row
            label="Show response diagnostics"
            hint="Show context used, token usage and task evidence below replies. The Context button below the message box is always available."
          >
            <Toggle
              checked={settings.showResponseDiagnostics}
              onChange={(showResponseDiagnostics) => void save({ showResponseDiagnostics })}
            />
          </Row>
        </Section>
        <Section title="Reset">
          <Row
            label="Reset all settings"
            hint="Restores preferences and tool permissions. Chats, memories, harness documents and saved provider credentials are kept."
          >
            <PillButton tone="danger" onClick={() => setConfirmReset(true)}>
              Reset settings
            </PillButton>
            <ConfirmationDialog
              open={confirmReset}
              onOpenChange={setConfirmReset}
              title="Reset your preferences?"
              description="Appearance, shortcuts, model, voice, working folder, privacy, memory recall and permissions return to their defaults. Chats, saved memories, harness documents and provider credentials are kept."
              cancelLabel="Keep preferences"
              confirmLabel="Reset settings"
              pendingLabel="Resetting…"
              onConfirm={() => window.api.resetSettings()}
            />
          </Row>
        </Section>
      </TabsContent>
    </Tabs>
  )
}
