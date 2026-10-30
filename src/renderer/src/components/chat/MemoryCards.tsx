import { useState } from 'react'
import { Brain, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type MemoryChange = {
  operation: 'remember' | 'update' | 'forget'
  change: string
  title: string
  content: string
  scope: string
}
const SCOPE: Record<string, string> = {
  global: 'All chats',
  workspace: 'This working folder',
  chat: 'This chat'
}
const HEADING: Record<MemoryChange['operation'], string> = {
  remember: 'Remembered',
  update: 'Memory updated',
  forget: 'Forgot'
}

// Tool results are untrusted JSON: read only the bounded fields the card shows.
function parseMemoryChange(detail: string | undefined): MemoryChange | undefined {
  if (!detail || detail.length > 8000 || !detail.startsWith('{')) return undefined
  try {
    const data = JSON.parse(detail)
    const memory = data?.memory
    if (
      data?.kind !== 'memory-change' ||
      !['remember', 'update', 'forget'].includes(data.operation) ||
      typeof memory?.title !== 'string' ||
      typeof memory.content !== 'string'
    )
      return undefined
    return {
      operation: data.operation,
      change: typeof data.change === 'string' ? data.change : '',
      title: memory.title.slice(0, 80),
      content: memory.content.slice(0, 1200),
      scope: typeof memory.scope === 'string' ? memory.scope : 'global'
    }
  } catch {
    return undefined
  }
}

function MemoryChangeCard({ change }: { change: MemoryChange }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'undoing' | 'undone'>('idle')
  const [error, setError] = useState('')
  const undo = async (): Promise<void> => {
    setState('undoing')
    setError('')
    try {
      await window.api.memory.undo(change.change)
      setState('undone')
    } catch (err) {
      setError(
        (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
      setState('idle')
    }
  }
  return (
    <Card size="sm" className="w-full max-w-xl" aria-label="Memory change">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain aria-hidden="true" className="size-4 text-muted-foreground" />
          {state === 'undone' ? 'Change undone' : HEADING[change.operation]}
          <Badge variant="outline">{SCOPE[change.scope] ?? change.scope}</Badge>
        </CardTitle>
        <CardDescription
          className={`[overflow-wrap:anywhere] ${change.operation === 'forget' || state === 'undone' ? 'line-through' : ''}`}
        >
          {change.title}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p
          className={`selectable whitespace-pre-wrap text-sm [overflow-wrap:anywhere] ${change.operation === 'forget' || state === 'undone' ? 'text-muted-foreground line-through' : ''}`}
        >
          {change.content}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {change.change && state !== 'undone' && (
            <Button
              variant="outline"
              size="sm"
              disabled={state === 'undoing'}
              aria-busy={state === 'undoing'}
              onClick={() => void undo()}
            >
              <Undo2 aria-hidden="true" />
              {state === 'undoing' ? 'Undoing…' : 'Undo'}
            </Button>
          )}
          <span className="text-xs text-muted-foreground">Manage in Settings → Memory</span>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** What the assistant saved or forgot during this reply, each with Undo. */
export function MemoryResults({ actions }: { actions: ToolAction[] }): React.JSX.Element | null {
  const changes = actions.flatMap((action) => {
    const change =
      action.status === 'done' && ['remember', 'forget'].includes(action.name)
        ? parseMemoryChange(action.detail)
        : undefined
    return change ? [{ id: action.id, change }] : []
  })
  if (!changes.length) return null
  return (
    <div className="flex w-full flex-col gap-2" aria-label="Memory changes">
      {changes.map(({ id, change }) => (
        <MemoryChangeCard key={id} change={change} />
      ))}
    </div>
  )
}
