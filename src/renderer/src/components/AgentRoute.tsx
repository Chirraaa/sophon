import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const LABELS: Record<AgentRoute, { short: string; detail: string }> = {
  auto: {
    short: 'Auto',
    detail: 'An agent decides: pass it to the running task, or handle it in parallel'
  },
  steer: { short: 'Add to task', detail: 'The running task reads it at its next step' },
  parallel: { short: 'New agent', detail: 'Start a separate agent for it right away' }
}

// Where a message goes while the chat is working. Shown only then.
export function AgentRouteSelect({
  value,
  onChange,
  disabled
}: {
  value: AgentRoute
  onChange: (route: AgentRoute) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(route) => {
        if (route === 'auto' || route === 'steer' || route === 'parallel') onChange(route)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Where this message goes while Sophon is working"
        title={LABELS[value].detail}
        className="text-xs text-muted-foreground"
      >
        <SelectValue>{LABELS[value].short}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-64">
        {(Object.keys(LABELS) as AgentRoute[]).map((route) => (
          <SelectItem key={route} value={route}>
            <span className="flex flex-col items-start gap-0.5">
              <span>{LABELS[route].short}</span>
              <span className="text-[11px] text-muted-foreground">{LABELS[route].detail}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const routePlaceholder = (route: AgentRoute): string =>
  route === 'steer'
    ? 'Add to the current request…'
    : route === 'parallel'
      ? 'Start another task in parallel…'
      : 'Ask for something else, or change the running task…'
