const INTERNAL_ACTION_LABELS: Record<string, string> = {
  discover_tools: 'Load tool instructions',
  coding_resources: 'Adjust coding working sizes',
  coding_checkpoint: 'Save coding progress',
  remember: 'Remember',
  forget: 'Forget a memory',
  recall: 'Search memory',
  spawn_agent: 'Start an agent',
  message_agent: 'Message an agent',
  check_agents: 'Check on agents',
  stop_agent: 'Stop an agent'
}

export function fallbackActionLabel(name: string): string {
  if (Object.hasOwn(INTERNAL_ACTION_LABELS, name)) return INTERNAL_ACTION_LABELS[name]
  const words = name.replace(/[_\-.]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Action'
}
