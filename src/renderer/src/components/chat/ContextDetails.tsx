import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { contextSummary } from '@/lib/context'
import { contextUsedTokens } from '../../../../shared/context-usage'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '@/components/ui/table'

const categories: Record<ContextCategory, { label: string; color: string }> = {
  instructions: { label: 'Instructions & guides', color: '#a78bfa' },
  history: { label: 'Conversation history', color: '#60a5fa' },
  request: { label: 'Current request & task state', color: '#38bdf8' },
  attachments: { label: 'Files & images', color: '#fbbf24' },
  memories: { label: 'Saved memories', color: '#f472b6' },
  toolResults: { label: 'Tool results', color: '#34d399' },
  toolCalls: { label: 'Tool calls', color: '#2dd4bf' },
  reasoning: { label: 'Retained reasoning', color: '#c084fc' },
  overhead: { label: 'Message formatting', color: '#a1a1aa' },
  tools: { label: 'Tool definitions', color: '#fb923c' }
}
const number = (value: number): string => value.toLocaleString()

export function ContextDetails({ report }: { report: ContextReport }): React.JSX.Element {
  const used = contextUsedTokens(report)
  const measured = report.peakTokens !== undefined
  const total = report.estimatedTotalTokens ?? report.estimatedInputTokens
  const window = report.contextWindow
  const percentage = window ? (used / window) * 100 : null
  const parts =
    report.breakdown?.filter((part) => categories[part.category] && part.tokens > 0) ?? []
  const local = report.provider === 'local' || report.provider === 'compatible'
  return (
    <div className="min-w-0 space-y-4 text-xs [overflow-wrap:anywhere]" data-context-details>
      <div>
        <p className="text-base font-medium text-foreground">{contextSummary(report)}</p>
        <p className="mt-1 text-muted-foreground">
          {measured ? 'Largest request in this reply' : 'Next request, estimated'}
          {report.model ? ` · ${report.model}` : ''}
        </p>
        <p className="mt-1 text-muted-foreground">
          {measured
            ? `${number(used)} tokens measured by the provider`
            : `About ${number(used)} tokens`}
          {window ? ` of ${number(window)}` : ''}.{' '}
          {report.windowSource === 'provider'
            ? local
              ? 'Window reported by the running model server.'
              : 'Window reported by provider.'
            : report.windowSource === 'documented'
              ? 'Published model window; account limits may differ.'
              : report.windowSource === 'configured'
                ? 'Window configured in Settings; the server did not report its own.'
                : 'Window capacity unavailable; a fullness percentage cannot be calculated.'}
        </p>
        {measured && report.reportedInputTokens !== undefined && (
          <p className="mt-1 text-muted-foreground">
            Latest request: {number(report.reportedInputTokens)} prompt +{' '}
            {number(report.reportedOutputTokens ?? 0)} reply tokens.
          </p>
        )}
      </div>
      {percentage !== null && (
        <div>
          <Progress
            aria-label="Estimated context window used"
            value={Math.min(100, Math.max(0, percentage))}
            aria-valuetext={`${percentage.toFixed(1)}% used, estimated`}
            indicatorClassName={percentage >= 85 ? 'bg-warning' : undefined}
          />
          {percentage >= 85 && (
            <p className="mt-2 text-warning">The latest input is close to the window limit.</p>
          )}
        </div>
      )}
      {parts.length > 0 && (
        <div>
          <p className="mb-2 font-medium text-foreground">What fills the input (estimated split)</p>
          <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {parts.map((part) => (
              <span
                key={part.category}
                style={{
                  width: `${(part.tokens / Math.max(1, total)) * 100}%`,
                  background: categories[part.category].color
                }}
              />
            ))}
          </div>
          <Table className="text-xs tabular-nums">
            <TableHeader className="text-muted-foreground">
              <TableRow>
                <TableHead className="pb-2 font-normal">Element</TableHead>
                <TableHead className="pb-2 text-right font-normal">Tokens</TableHead>
                <TableHead className="pb-2 pl-3 text-right font-normal">Input share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((part) => (
                <TableRow key={part.category}>
                  <TableCell className="py-1.5">
                    <span
                      className="mr-2 inline-block size-2 rounded-full"
                      style={{ background: categories[part.category].color }}
                    />
                    {categories[part.category].label}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    ~{number(part.tokens)}
                  </TableCell>
                  <TableCell className="pl-3 text-right">
                    {((part.tokens / Math.max(1, total)) * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="space-y-1 text-muted-foreground">
        {report.compaction && (
          <div className="mb-3 rounded-lg border border-border p-3" data-context-compaction>
            <p className="font-medium text-foreground">Context compacted automatically</p>
            <p className="mt-1">
              {number(report.compaction.turns)} older exchanges and{' '}
              {number(report.compaction.messages)} messages represented by a{' '}
              {report.compaction.method === 'model' ? 'summary' : 'set of partial excerpts'}. Latest
              compaction: about {number(report.compaction.beforeTokens)} →{' '}
              {number(report.compaction.afterTokens)} tokens.
            </p>
            <p className="mt-1">
              The current request and latest tool batch stay intact. Your full chat remains in the
              conversation.
            </p>
            {report.compaction.method === 'excerpts' && (
              <p className="mt-1">
                Some earlier details were omitted and may need to be inspected again.
              </p>
            )}
          </div>
        )}
        {report.inputBudget !== null && (
          <p>
            Reply reserve: {number(report.reservedOutputTokens)} tokens. Safety margin:{' '}
            {number(report.headroomTokens ?? 0)} tokens. These are capacity reservations, not used
            input.
          </p>
        )}
        <p>
          {measured
            ? 'The total is the provider’s count for this model, including the reply it generated. The split by element is estimated.'
            : report.calibrated
              ? 'Estimated before the request, scaled by how this model counted its last request. The provider’s count replaces it when the reply arrives.'
              : 'Estimated before the request. The provider’s count replaces it when the reply arrives.'}{' '}
          Unsent drafts are not included.
        </p>
        <p>{report.droppedTurns} older exchanges omitted by the context budget.</p>
        {report.measuredAt && (
          <p>Measured {new Date(report.measuredAt).toLocaleTimeString()} before generation.</p>
        )}
      </div>
      <Collapsible className="text-muted-foreground">
        <CollapsibleTrigger className="cursor-pointer">Included resources</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1 break-words">
            <p>Guides: {report.playbooks.join(', ') || 'core workflow only'}.</p>
            <p>Memories: {report.memories.map((memory) => memory.title).join(', ') || 'none'}.</p>
            <p>Skills and recipes: {report.guidance?.join(', ') || 'none recalled'}.</p>
            <p>Available tools: {report.availableTools?.join(', ') || 'none'}.</p>
            {report.codingResources && (
              <p>
                Coding working sizes: up to {number(report.codingResources.readChars)} characters
                per read; about {number(report.codingResources.editChars)} per edit fragment.
                Preference: {report.codingResources.preference}.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
