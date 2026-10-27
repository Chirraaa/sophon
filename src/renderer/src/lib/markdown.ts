export function normalizeMath(text: string): string {
  return text.replace(
    /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|(?![\s\S])))|(`+)[\s\S]*?\3|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/gm,
    (
      match,
      fence: string | undefined,
      _marker: string | undefined,
      ticks: string | undefined,
      display: string | undefined,
      inline: string | undefined
    ) => {
      if (fence || ticks) return match
      if (display !== undefined) return '\n\n$$\n' + display.trim() + '\n$$\n\n'
      return '$' + inline + '$'
    }
  )
}
