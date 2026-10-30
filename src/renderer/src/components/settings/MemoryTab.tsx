import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { useSession } from '@/hooks/useSession'
import { Notice, NumberField, PillButton, Row, Section, SelectField, Toggle } from './controls'
import { save } from './save'

const blank = (): MemoryDraft => ({
  title: '',
  content: '',
  scope: 'global',
  kind: 'fact',
  pinned: false
})
export function MemoryTab({ settings }: { settings: AppSettings }): React.JSX.Element {
  const session = useSession()
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [draft, setDraft] = useState<MemoryDraft>(blank)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [listError, setListError] = useState('')
  const [saving, setSaving] = useState(false)
  const [enablingHarness, setEnablingHarness] = useState(false)
  const [filter, setFilter] = useState('')
  const [origin, setOrigin] = useState<'all' | MemoryRecord['source']>('all')
  const [episodes, setEpisodes] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)
  const [harness, setHarness] = useState<{ directory: string; documents: string[] } | null>(null)
  const [document, setDocument] = useState('')
  const [contents, setContents] = useState('')
  useEffect(() => {
    let alive = true
    window.api.harness
      .list()
      .then((value) => {
        if (alive) setHarness(value)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!document) return
    let alive = true
    const [category, filename] = document.split('/')
    window.api.harness
      .read(category, filename.slice(0, -3))
      .then((value) => {
        if (alive) setContents(value)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [document])
  useEffect(() => {
    let alive = true
    window.api.memory
      .episodes()
      .then((count) => {
        if (alive) setEpisodes(count)
      })
      .catch(() => {
        if (alive) setEpisodes(null)
      })
    return () => {
      alive = false
    }
  }, [refresh, session.busy])
  useEffect(() => {
    let alive = true
    window.api.memory
      .list()
      .then((value) => {
        if (alive) setRecords(value)
      })
      .catch((err: Error) => {
        if (alive) setListError(err.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [refresh, session.busy])
  const shown = records.filter(
    (record) =>
      (origin === 'all' || record.source === origin) &&
      `${record.title} ${record.content}`.toLowerCase().includes(filter.toLowerCase())
  )
  const locked = session.busy || saving || loading
  const harnessEnabled =
    settings.memory.enabled &&
    settings.tools.harness_manage !== 'block' &&
    settings.tools.python_calculate !== 'block'
  const enableHarness = async (): Promise<void> => {
    setEnablingHarness(true)
    try {
      await save({
        memory: { enabled: true },
        tools: {
          harness_manage: settings.tools.harness_manage === 'allow' ? 'allow' : 'ask',
          python_calculate: settings.tools.python_calculate === 'allow' ? 'allow' : 'ask'
        }
      })
    } finally {
      setEnablingHarness(false)
    }
  }
  const workspace = settings.files.workspace.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const editable = (record: MemoryRecord): boolean =>
    record.scope === 'global' ||
    (record.scope === 'workspace' && !!workspace && record.scopeKey === workspace) ||
    (record.scope === 'chat' && record.scopeKey === session.chatId)
  const submit = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      setRecords(await window.api.memory.save(draft))
      setDraft(blank())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async (id: string): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      setRecords(await window.api.memory.delete(id))
      if (draft.id === id) setDraft(blank())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {harness && (
        <Section
          title="Saved task guidance"
          collapsible
          description="Review and edit reusable instructions, skills and recipes as Markdown documents. Previous versions are kept."
        >
          <p className="mb-3 break-all text-xs text-muted-foreground">{harness.directory}</p>
          <SelectField
            value={document}
            options={[
              { value: '', label: 'Inspect a document…' },
              ...harness.documents.map((name) => ({ value: name, label: name }))
            ]}
            onChange={(value) => {
              setContents('')
              setDocument(value)
            }}
          />
          {document && (
            <ScrollArea
              className="mt-3 max-h-72 rounded-lg border border-border"
              orientation="both"
            >
              <pre className="whitespace-pre-wrap p-3 text-xs">{contents}</pre>
            </ScrollArea>
          )}
          <div className="my-3">
            <PillButton
              disabled={session.busy || enablingHarness || harnessEnabled}
              aria-busy={enablingHarness}
              onClick={() => void enableHarness()}
            >
              {enablingHarness
                ? 'Enabling…'
                : harnessEnabled
                  ? 'Guidance and recall enabled'
                  : 'Enable guidance and recall'}
            </PillButton>
          </div>
          <Notice>
            Set these tools to Always allow in Permissions to let the model evolve its guidance
            without a prompt for every step. Markdown is stored as plaintext; keep personal facts in
            encrypted memories below. Turning off saved memories also disables guidance recall and
            model edits. Structure checks alone do not verify advice.
          </Notice>
        </Section>
      )}
      <Section
        title="Selective recall"
        description="Teach short, reusable facts and preferences. Sophon recalls relevant entries when answering in private chats. No model needs to be loaded to manage them."
      >
        <Row
          label="Use memories and task guidance"
          hint="Recall saved entries and task guidance, and allow guidance edits. Turning this off keeps stored entries and Markdown documents."
        >
          <Toggle
            checked={settings.memory.enabled}
            onChange={(enabled) => void save({ memory: { enabled } })}
          />
        </Row>
        <Row
          label="Recall budget"
          hint="Estimated tokens per request, at most six entries. Pinned entries get priority but still share this limit."
        >
          <NumberField
            value={settings.memory.maxTokens}
            min={100}
            max={2000}
            suffix="tokens"
            onCommit={(maxTokens) => void save({ memory: { maxTokens } })}
          />
        </Row>
        <Row
          label="Let Sophon remember on its own"
          hint="Sophon saves lasting facts, preferences and corrections from your chats without asking, and forgets them when you ask. Each change appears in the chat with Undo."
        >
          <Toggle
            checked={settings.memory.learn}
            disabled={!settings.memory.enabled}
            onChange={(learn) => void save({ memory: { learn } })}
          />
        </Row>
        <Row
          label="Remember past conversations"
          hint="Keeps a short encrypted digest of each chat so Sophon can recall what you discussed before. Deleting, clearing or expiring a chat removes its digest."
        >
          <Toggle
            checked={settings.memory.episodes}
            disabled={!settings.memory.enabled}
            onChange={(episodes) => void save({ memory: { episodes } })}
          />
        </Row>
        <Row
          label="Conversation memory"
          hint={
            episodes === null
              ? 'Conversation digests could not be read.'
              : `${episodes} ${episodes === 1 ? 'conversation' : 'conversations'} remembered.`
          }
        >
          <PillButton disabled={session.busy || !episodes} onClick={() => setClearing(true)}>
            Clear conversation memory
          </PillButton>
        </Row>
        <ConfirmationDialog
          open={clearing}
          onOpenChange={setClearing}
          title="Clear conversation memory?"
          description="Sophon forgets the digests of all past conversations. The chats themselves and your saved memories are kept."
          confirmLabel="Clear"
          cancelLabel="Cancel"
          pendingLabel="Clearing…"
          onConfirm={async () => {
            await window.api.memory.clearEpisodes()
            setEpisodes(0)
          }}
        />
        <Notice>
          Memories and conversation digests are encrypted on this device and sent only as context to
          your selected model. They do not train the model. Entries Sophon learned are marked below;
          edit or delete them like your own.
        </Notice>
      </Section>
      <Section
        title={draft.id ? 'Edit memory' : 'Teach Sophon'}
        description="Save one clear idea per entry. Use Task notes for the current goal, constraints, decisions and next step. Keep passwords and API keys out of memories."
      >
        <div className="flex flex-col gap-3">
          <Input
            aria-label="Memory title"
            placeholder="Title, e.g. Project test command"
            maxLength={80}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <Textarea
            aria-label="Memory content"
            placeholder="A concise fact, preference, or procedure, with its source when useful."
            rows={5}
            maxLength={1200}
            value={draft.content}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            {draft.content.length}/1,200 characters
          </span>
          <Row label="Kind">
            <SelectField
              value={draft.kind}
              options={[
                { value: 'fact', label: 'Fact' },
                { value: 'preference', label: 'Preference' },
                { value: 'procedure', label: 'Procedure' },
                { value: 'task', label: 'Task notes' }
              ]}
              onChange={(kind) => setDraft({ ...draft, kind: kind as MemoryKind })}
            />
          </Row>
          <Row
            label="Use in"
            hint="Chat notes are deleted when that conversation is cleared, deleted or expires. Other entries remain until you delete them."
          >
            {draft.id ? (
              <span className="text-xs">{draft.scope}</span>
            ) : (
              <SelectField
                value={draft.scope}
                options={[
                  { value: 'global', label: 'All private chats' },
                  { value: 'workspace', label: 'Current working folder' },
                  { value: 'chat', label: 'Current conversation' }
                ]}
                onChange={(scope) => setDraft({ ...draft, scope: scope as MemoryScope })}
              />
            )}
          </Row>
          <Row
            label="Prioritize this entry"
            hint="Useful for recurring preferences or a task handoff you need in every request."
          >
            <Toggle checked={draft.pinned} onChange={(pinned) => setDraft({ ...draft, pinned })} />
          </Row>
          <div className="flex gap-2">
            <PillButton
              disabled={locked || !draft.title.trim() || !draft.content.trim()}
              onClick={() => void submit()}
            >
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save memory'}
            </PillButton>
            <PillButton disabled={saving} onClick={() => setDraft(blank())}>
              Clear editor
            </PillButton>
          </div>
          {session.busy && (
            <Notice>Wait for the current response or stop the task before editing.</Notice>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </Section>
      <Section
        title={`Saved memories (${records.length}/200)`}
        description="Preferences and current conversation task notes are considered automatically. Other entries match words in your request. Use specific titles so they are easy to retrieve."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Filter memories"
            placeholder="Filter saved memories"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <SelectField
            value={origin}
            options={[
              { value: 'all', label: 'All entries' },
              { value: 'user', label: 'Saved by you' },
              { value: 'assistant', label: 'Learned by Sophon' }
            ]}
            onChange={(value) => setOrigin(value as typeof origin)}
          />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading memories…</p>
          ) : listError ? (
            <div className="space-y-2">
              <p role="alert" className="text-xs text-destructive">
                {listError}
              </p>
              <PillButton
                onClick={() => {
                  setLoading(true)
                  setListError('')
                  setRefresh((value) => value + 1)
                }}
              >
                Retry loading memories
              </PillButton>
            </div>
          ) : records.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved memories yet.</p>
          ) : !shown.length ? (
            <p className="text-xs text-muted-foreground">
              No memories match. Try another search or clear the filter.
            </p>
          ) : (
            shown
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((record) => (
                <article key={record.id} className="rounded-xl border border-border p-3 text-xs">
                  <div className="font-medium">
                    {record.title}
                    {record.pinned ? ' · prioritized' : ''}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {record.kind} · {record.scope} ·{' '}
                    {record.source === 'assistant' ? 'learned by Sophon' : 'saved by you'} ·{' '}
                    {new Date(record.updatedAt).toLocaleDateString()}
                  </p>
                  {record.scope === 'workspace' && (
                    <p className="mt-1 break-all text-muted-foreground">{record.scopeKey}</p>
                  )}
                  {!editable(record) && (
                    <p className="mt-1 text-muted-foreground">
                      Applies to a different chat or working folder.
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap break-words">{record.content}</p>
                  <div className="mt-3 flex gap-2">
                    <PillButton
                      disabled={locked || !editable(record)}
                      onClick={() => {
                        const { id, title, content, kind, scope, pinned } = record
                        setDraft({ id, title, content, kind, scope, pinned })
                        setError('')
                      }}
                    >
                      Edit
                    </PillButton>
                    <PillButton
                      disabled={saving || session.busy}
                      onClick={() => void remove(record.id)}
                    >
                      Delete
                    </PillButton>
                  </div>
                </article>
              ))
          )}
        </div>
      </Section>
      <Section
        title="How Sophon approaches a task"
        collapsible
        description="A short core workflow is always included. Up to four relevant guides cover the task, sources, verification and explanation."
      >
        <p className="text-xs leading-6 text-muted-foreground">
          Understand the goal → take a supported step → inspect the result → verify and explain.
          Coding guidance favors focused changes and honest test reporting. Research guidance asks
          for current primary sources when facts may have changed. Desktop guidance checks the
          target and respects action results. Teaching guidance uses small steps and concrete
          examples.
        </p>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          Learn in a cycle: curiosity (identify the question and assumptions), study (check sources,
          calculations and examples), then teaching (explain the checked result). Substantial
          answers receive one review when the model-call budget allows. Save a checked lesson or
          correction from chat to improve future recall. Review and update lessons as evidence
          changes; more saved entries do not prove greater expertise.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Open Context below the message box to inspect recall and history trimming. For durable
          project conventions, save a Procedure scoped to your working folder.
        </p>
      </Section>
    </div>
  )
}
