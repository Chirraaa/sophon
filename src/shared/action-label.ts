const INTERNAL_ACTION_LABELS: Record<string, string> = {
  discover_tools: 'Load tool instructions',
  coding_resources: 'Adjust coding working sizes',
  coding_checkpoint: 'Save coding progress'
}

export function fallbackActionLabel(name: string): string {
  if (Object.hasOwn(INTERNAL_ACTION_LABELS, name)) return INTERNAL_ACTION_LABELS[name]
  const words = name.replace(/[_\-.]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Action'
}
