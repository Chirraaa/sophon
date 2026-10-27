import { ScrollArea } from '@/components/ui/scroll-area'
import Markdown, { type Components } from 'react-markdown'
import { useMemo } from 'react'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { normalizeMath } from '@/lib/markdown'
import { VisualBlock } from './chat/VisualBlock'
import { VisualFollowUp, StreamingReply } from '@/hooks/useVisualFollowUp'
import { hasToolMarkup } from '../../../shared/reply-quality'
import { PageLink } from './chat/PageLink'
import { QuestionCard } from './chat/QuestionCard'
import { questionsFromReply } from '../../../shared/questions'
import { DesignGuideSuggestion } from './chat/DesignGuideSuggestion'
import { designSuggestion } from '@/lib/design-guide'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '@/components/ui/table'

const components: Components = {
  hr: () => <Separator className="my-6" />,
  span: ({ children, className, style, 'aria-hidden': ariaHidden }) =>
    className === 'katex-display' ? (
      <ScrollArea
        render={<span />}
        className="my-5 max-w-full"
        orientation="horizontal"
        viewportProps={{ render: <span /> }}
        contentProps={{ render: <span /> }}
      >
        <span className={className} style={style} aria-hidden={ariaHidden}>
          {children}
        </span>
      </ScrollArea>
    ) : (
      <span className={className} style={style} aria-hidden={ariaHidden}>
        {children}
      </span>
    ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h2 className="mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h2>,
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-tint/60 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => <code className={className}>{children}</code>,
  pre: VisualBlock,
  table: ({ children }) => (
    <Table
      containerClassName="my-4 max-w-full rounded-xl border border-border"
      className="border-collapse text-xs"
    >
      {children}
    </Table>
  ),
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children, style }) => (
    <TableHead style={style} className="border-b border-border bg-muted/50 px-3 py-2 font-medium">
      {children}
    </TableHead>
  ),
  td: ({ children, style }) => (
    <TableCell style={style} className="border-b border-border px-3 py-2">
      {children}
    </TableCell>
  ),
  a: ({ children, href }) => <PageLink url={href || ''}>{children}</PageLink>,
  img: () => null
}

export function AssistantText({
  text,
  onAsk,
  questionsEnabled = true,
  streaming = false
}: {
  text: string
  onAsk?: (question: string) => void
  questionsEnabled?: boolean
  streaming?: boolean
}): React.JSX.Element {
  const markdown = useMemo(
    () => (
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20 }],
          [rehypeHighlight, { detect: false, ignoreMissing: true }]
        ]}
        components={components}
      >
        {normalizeMath(text)}
      </Markdown>
    ),
    [text]
  )
  const questions = questionsFromReply(text)
  const direction = designSuggestion(text)
  if (direction !== undefined)
    return (
      <DesignGuideSuggestion
        reason={direction}
        onAsk={streaming || !questionsEnabled ? undefined : onAsk}
      />
    )
  if (questions)
    return (
      <QuestionCard
        key={text}
        questions={questions}
        onAsk={streaming || !questionsEnabled ? undefined : onAsk}
      />
    )

  let sources: { title: string; url: string; snippet?: string; text?: string }[] = []
  if (!streaming) {
    try {
      const value: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
      const entries = Array.isArray(value) ? value : [value]
      if (
        entries.length &&
        entries.every(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            typeof entry.title === 'string' &&
            typeof entry.url === 'string' &&
            entry.provenance === 'untrusted-web'
        )
      )
        sources = entries
    } catch {
      /* Regular prose or incomplete streamed JSON. */
    }
  }
  if (sources.length)
    return (
      <div className="space-y-3" aria-label="Web results">
        {sources.map((source, index) => (
          <article key={index} className="rounded-xl border border-border p-3">
            <PageLink url={source.url}>{source.title}</PageLink>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {(source.snippet || source.text || '').slice(0, 1000)}
            </p>
          </article>
        ))}
      </div>
    )
  if (hasToolMarkup(text))
    return (
      <p role="status">
        This reply contains an invalid tool request. Use Rerun on your prompt to try again.
      </p>
    )
  return (
    <VisualFollowUp.Provider value={onAsk}>
      <StreamingReply.Provider value={streaming}>
        <div className="chat-markdown min-w-0">{markdown}</div>
      </StreamingReply.Provider>
    </VisualFollowUp.Provider>
  )
}
