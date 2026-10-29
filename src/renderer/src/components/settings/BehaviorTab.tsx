import { useEffect, useState } from 'react'
import { Notice, PillButton, Row, Section, Segmented, TextArea } from './controls'
import { useLocalValue } from '@/hooks/useLocalValue'
import { save } from './save'
function PromptEditor({
  saved,
  defaultPrompt
}: {
  saved: string
  defaultPrompt: string
}): React.JSX.Element {
  const customized = saved !== ''
  const field = useLocalValue(
    saved || defaultPrompt,
    (v) => void save({ behavior: { systemPrompt: v.trim() === defaultPrompt.trim() ? '' : v } })
  )
  return (
    <div className="flex flex-col gap-3">
      <TextArea
        value={saved || defaultPrompt}
        onCommit={() => {}}
        field={field}
        rows={16}
        maxLength={8000}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {customized ? 'Customized' : 'Built-in default'}
        </span>
        <PillButton
          disabled={!customized && field.value === defaultPrompt}
          onClick={() => {
            field.cancel()
            void save({ behavior: { systemPrompt: '' } })
          }}
        >
          Reset to default
        </PillButton>
      </div>
      <Notice>
        {customized
          ? 'Your custom instructions replace the built-in role guidance. '
          : 'This is the built-in role guidance. '}
        Built-in guidance updates with the app; custom instructions stay as you saved them. Sophon
        also adds live tool availability, interface context, reply style, task workflow and coding
        safeguards, plus relevant guides and enabled memories. Permissions are enforced by the app;
        changing this text does not grant access or disable patch and verification requirements.
      </Notice>
    </div>
  )
}
export function BehaviorTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const b = settings.behavior
  const [defaultPrompt, setDefaultPrompt] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.api
      .defaultPrompt()
      .then((p) => {
        if (alive) setDefaultPrompt(p)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="flex flex-col gap-4">
      <Section title="Replies">
        <Row
          label="Reply style"
          hint="Terse keeps routine confirmations brief. Normal allows fuller explanations. Both give learning questions the detail they need."
        >
          <Segmented
            value={b.style}
            options={[
              { value: 'terse', label: 'Terse' },
              { value: 'normal', label: 'Normal' }
            ]}
            onChange={(style) => void save({ behavior: { style } })}
          />
        </Row>
      </Section>

      <Section
        title="Rules in your own words"
        description="Added to the instructions as extra rules, for example: Never close a window. Always put music apps on the right monitor."
      >
        <TextArea
          value={b.neverDo}
          onCommit={(neverDo) => void save({ behavior: { neverDo } })}
          rows={3}
          maxLength={2000}
          placeholder="Nothing added."
        />
        <div className="mt-3">
          <Notice>
            These are requests to the model, and a small model can ignore them. For rules that must
            hold, use <strong className="font-medium text-foreground">Permissions</strong>: those
            are enforced by the app itself.
          </Notice>
        </div>
      </Section>

      <Section
        title="Core instructions"
        collapsible
        description="Sophon's role, environment awareness, coding workflow, patch policy, verification, research, visuals and memory. Customize this guidance or reset it to the current built-in default."
      >
        {defaultPrompt === null ? (
          <p className="py-3 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <PromptEditor saved={b.systemPrompt} defaultPrompt={defaultPrompt} />
        )}
      </Section>
    </div>
  )
}
