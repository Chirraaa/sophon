import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Section } from './controls'
import { MicrophoneSetup } from './MicrophoneSetup'
import { Label } from '@/components/ui/label'

const USES = [
  ['coding', 'Coding'],
  ['learning', 'Learning'],
  ['writing', 'Writing'],
  ['research', 'Research'],
  ['everyday', 'Everyday tasks']
] as const

export function ProfileEditor({
  settings,
  onboarding = false
}: {
  settings: AppSettings
  onboarding?: boolean
}): React.JSX.Element {
  const [profile, setProfile] = useState(settings.profile)
  const [step, setStep] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const contextPlaceholder = profile.uses.includes('coding')
    ? 'What are you building? Which languages or tools do you use?'
    : profile.uses.includes('learning')
      ? 'What are you learning, and how familiar are you with it?'
      : profile.uses.includes('writing')
        ? 'What do you write, who is it for, and what tone do you prefer?'
        : profile.uses.includes('research')
          ? 'Which topics are you exploring, and what are your goals?'
          : 'Your goals, experience, or preferences…'
  const update = (patch: Partial<AppSettings['profile']>): void => {
    setProfile((previous) => ({ ...previous, ...patch }))
    setSaved(false)
    setError('')
  }
  async function persist(skip = false): Promise<void> {
    setPending(true)
    setError('')
    try {
      const result = await window.api.updateSettings({
        ...(onboarding && skip ? { voice: { enabled: false } } : {}),
        profile: {
          ...(skip ? settings.profile : profile),
          onboardingComplete: true
        }
      })
      if (!result.ok) throw new Error(result.error || 'Could not save your preferences. Try again.')
      setSaved(true)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (onboarding && step < 3) setStep(step + 1)
        else void persist()
      }}
    >
      {onboarding && (
        <p className="text-xs text-muted-foreground" role="status">
          Step {step + 1} of 4 · All questions are optional
        </p>
      )}
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        {onboarding && step === 3 && <MicrophoneSetup settings={settings} />}
        {(!onboarding || step === 0) && (
          <div className="space-y-2">
            <Label htmlFor="profile-name" className="text-sm font-medium">
              What should Sophon call you?
            </Label>
            <Input
              id="profile-name"
              autoComplete="nickname"
              maxLength={60}
              placeholder="Your preferred name"
              value={profile.name}
              onChange={(event) => update({ name: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Used in greetings and when it helps the conversation.
            </p>
          </div>
        )}
        {(!onboarding || step === 1) && (
          <div className="space-y-3">
            <p id="profile-uses" className="text-sm font-medium">
              What would you like help with?
            </p>
            <ToggleGroup
              multiple
              variant="outline"
              aria-labelledby="profile-uses"
              value={profile.uses}
              onValueChange={(uses) => update({ uses })}
              className="flex flex-wrap justify-start gap-2"
            >
              {USES.map(([value, label]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  variant="outline"
                  className="rounded-lg px-3"
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              Pick a few, or leave this open. You can ask Sophon for anything it supports.
            </p>
          </div>
        )}
        {(!onboarding || step === 2) && (
          <>
            <div className="space-y-2">
              <Label id="profile-guidance" className="text-sm font-medium">
                How do you like to work?
              </Label>
              <Select
                value={profile.guidance}
                onValueChange={(value) =>
                  update({ guidance: value as AppSettings['profile']['guidance'] })
                }
              >
                <SelectTrigger aria-labelledby="profile-guidance" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Adapt to the task</SelectItem>
                  <SelectItem value="step-by-step">Guide me step by step</SelectItem>
                  <SelectItem value="direct">Get straight to the result</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-context" className="text-sm font-medium">
                Anything else Sophon should know?
              </Label>
              <Textarea
                id="profile-context"
                rows={3}
                maxLength={1200}
                placeholder={contextPlaceholder}
                value={profile.context}
                onChange={(event) => update({ context: event.target.value })}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Saved on this computer and included in requests to your selected model. You can edit
                or clear it anytime in Settings → Profile. Avoid adding secrets.
              </p>
            </div>
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && !onboarding && (
        <p role="status" className="text-xs text-muted-foreground">
          Profile saved. Your next conversation request will use these preferences.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onboarding ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => void persist(true)}
          >
            Skip setup
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Applies to future replies.</span>
        )}
        <div className="flex gap-2">
          {onboarding && step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setStep(step - 1)}
            >
              Back
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending
              ? 'Saving…'
              : onboarding
                ? step < 3
                  ? 'Continue'
                  : 'Make yourself at home'
                : 'Save profile'}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function ProfileTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  return (
    <Section
      title="Your preferences"
      description="A little context helps Sophon give more useful guidance. These preferences stay yours to change."
    >
      <ProfileEditor settings={settings} />
    </Section>
  )
}
