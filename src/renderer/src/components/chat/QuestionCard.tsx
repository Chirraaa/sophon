import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { ClarificationQuestion } from '../../../../shared/questions'

export function QuestionCard({
  questions,
  onAsk
}: {
  questions: ClarificationQuestion[]
  onAsk?: (text: string) => void
}): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [custom, setCustom] = useState('')
  const [sent, setSent] = useState(false)
  const question = questions[index]
  const submit = (next: Record<number, string>): void => {
    setSent(true)
    onAsk?.(
      'My answers:\n' +
        questions
          .map((q, i) => `${q.title}\n${next[i] || 'Skipped; use a reasonable assumption.'}`)
          .join('\n\n')
    )
  }
  const choose = (answer: string): void => {
    const next = { ...answers, [index]: answer }
    setAnswers(next)
    setCustom('')
    if (index + 1 < questions.length) setIndex(index + 1)
    else submit(next)
  }
  if (sent)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Answers sent. You can add more details in your next message.
      </p>
    )
  return (
    <section
      className="rounded-2xl border border-border bg-muted/50 p-4"
      aria-label="Clarifying questions"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium" aria-live="polite">
          {question.title}
        </h3>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous question"
            disabled={!onAsk || index === 0}
            onClick={() => {
              setIndex(index - 1)
              setCustom('')
            }}
          >
            <ChevronLeft size={16} />
          </Button>
          <span>
            {index + 1} of {questions.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next question"
            disabled={!onAsk || index + 1 === questions.length}
            onClick={() => {
              setIndex(index + 1)
              setCustom('')
            }}
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Skip all questions"
            disabled={!onAsk}
            onClick={() => submit(answers)}
          >
            <X size={16} />
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border">
        {question.options.map((option, i) => (
          <Button
            type="button"
            variant="ghost"
            key={option}
            disabled={!onAsk}
            aria-pressed={answers[index] === option}
            onClick={() => choose(option)}
            className="flex h-auto w-full items-center justify-start gap-3 whitespace-normal rounded-md px-1 py-3 text-left text-sm hover:bg-muted disabled:opacity-50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {i + 1}
            </span>
            {option}
          </Button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (custom.trim()) choose(custom.trim())
        }}
      >
        <Input
          disabled={!onAsk}
          aria-label="Something else"
          placeholder="Something else…"
          value={custom}
          maxLength={1000}
          onChange={(event) => setCustom(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background/30 px-3 py-2 text-sm"
        />
        {custom.trim() && (
          <Button
            variant="secondary"
            disabled={!onAsk}
            type="submit"
            className="rounded-lg bg-muted px-3 text-sm"
          >
            Use answer
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!onAsk}
          type="button"
          onClick={() => choose('Skipped; use a reasonable assumption.')}
          className="rounded-lg bg-muted px-3 text-sm"
        >
          Skip
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">You can also reply directly in the chat.</p>
    </section>
  )
}
