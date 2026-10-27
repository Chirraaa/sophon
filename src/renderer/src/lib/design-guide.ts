export function designSuggestion(text: string): string | undefined {
  const block = /^```sophon-design-guide\s*\n([\s\S]*?)\n```\s*$/.exec(text.trim())
  if (!block) return undefined
  try {
    const value = JSON.parse(block[1])
    if (typeof value?.reason === 'string' && value.reason.length <= 300) return value.reason
  } catch {
    /* Leave malformed content as ordinary text. */
  }
  return undefined
}
