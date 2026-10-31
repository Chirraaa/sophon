import { useEffect, useState } from 'react'
import { Notice, PillButton, Row, Section, Segmented, Slider, TextArea, Toggle } from './controls'
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
        always adds its host rules (tool honesty, approvals, untrusted content), your memory
        settings, live tool availability, interface context, reply style, task workflow and coding
        safeguards, plus relevant guides and recalled memories. Permissions are enforced by the app;
        changing this text does not grant access or disable patch and verification requirements.
      </Notice>
    </div>
  )
}
export function BehaviorTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const b = settings.behavior
  const a = settings.agents
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
        title="Parallel agents"
        description="Sophon can work on several things at once. Each agent has its own thread in the chat, the same tools and permissions, and its own cursor while it uses the desktop."
      >
        <Row
          label="Parallel agents"
          hint="Lets Sophon start background agents for independent parts of a request, and lets you start new tasks while one is running."
        >
          <Toggle checked={a.enabled} onChange={(enabled) => void save({ agents: { enabled } })} />
        </Row>
        {a.enabled && (
          <>
            <Row
              label="Tasks at once"
              hint="Across all chats, including the main task. Each running task uses its own model requests; a local model server answers them in turn unless it has several slots."
            >
              <Slider
                value={a.maxConcurrent}
                min={1}
                max={6}
                step={1}
                format={(value) => (value === 1 ? '1 (one at a time)' : `${value} tasks`)}
                onCommit={(maxConcurrent) => void save({ agents: { maxConcurrent } })}
              />
            </Row>
            <Row
              label="Messages while working"
              hint="What happens to a message you send while the chat is busy. Auto starts a short agent that passes changes to the running task or handles new requests in parallel. You can still choose per message."
            >
              <Segmented
                value={a.route}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'steer', label: 'Add to task' },
                  { value: 'parallel', label: 'New agent' }
                ]}
                onChange={(route) => void save({ agents: { route } })}
              />
            </Row>
            <Row
              label="Agent cursors"
              hint="Shows each agent's own labelled cursor where it acts on screen. Screenshots never include them. Hidden over exclusive fullscreen games."
            >
              <Toggle
                checked={a.cursors}
                onChange={(cursors) => void save({ agents: { cursors } })}
              />
            </Row>
          </>
        )}
        <Row
          label="Pointer movement"
          hint="How the real pointer travels to a click. Natural glides briefly like a hand on a mouse; Fast halves that; Instant jumps straight there."
        >
          <Segmented
            value={a.pointer}
            options={[
              { value: 'natural', label: 'Natural' },
              { value: 'fast', label: 'Fast' },
              { value: 'instant', label: 'Instant' }
            ]}
            onChange={(pointer) => void save({ agents: { pointer } })}
          />
        </Row>
        <div className="mt-3">
          <Notice>
            Windows has one pointer and keyboard, so agents take turns for each click or keystroke,
            and an agent keeps the window it is working in until it pauses. Accessibility actions
            run at the same time. Messages between agents never grant permissions.
          </Notice>
        </div>
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
        description="Sophon's role, what it can do, when to answer directly or use tools, and how replies are formatted. Customize this guidance or reset it to the current built-in default."
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
