export const CODE_TEXT_MAX_CHARS = 65536
export const TOOL_ARGUMENT_MAX_CHARS = 262144
export const READ_TEXT_MAX_CHARS = 60000

export class CodingOutputLimitError extends Error {
  constructor() {
    super('The model returned an incomplete tool batch. No tools were executed.')
    this.name = 'CodingOutputLimitError'
  }
}

export type CodingResourcePreference = 'auto' | 'conserve' | 'expand'
type Capacity = { inputBudget: number; usedTokens: number; outputTokens: number }

export class CodingResources {
  private capacity: Capacity = { inputBudget: Infinity, usedTokens: 0, outputTokens: 0 }
  private requested: { edit_chars?: number; read_chars?: number } = {}
  private observedEdit = 0

  constructor(private readonly preference: CodingResourcePreference = 'auto') {}

  update(capacity: Capacity): void {
    this.capacity = { ...capacity }
  }

  consume(tokens: number): void {
    this.capacity.usedTokens += tokens
  }

  reduceEditSize(): void {
    this.requested.edit_chars = Math.max(1, Math.floor(this.snapshot().editChars / 2))
  }

  request(args: { edit_chars?: number; read_chars?: number }): void {
    for (const [key, limit] of [
      ['edit_chars', CODE_TEXT_MAX_CHARS],
      ['read_chars', READ_TEXT_MAX_CHARS]
    ] as const) {
      const value = args[key]
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > limit))
        throw new Error(`${key} must be an integer from 1 to ${limit}.`)
    }
    this.requested = { ...this.requested, ...args }
  }

  observeEdit(args: Record<string, unknown>): void {
    const edits = Array.isArray(args.edits) ? args.edits : [args]
    for (const edit of edits)
      for (const key of ['old_text', 'new_text', 'content'])
        if (typeof edit?.[key] === 'string')
          this.observedEdit = Math.max(this.observedEdit, edit[key].length)
  }

  snapshot(): CodingResourceState {
    const { inputBudget, usedTokens, outputTokens } = this.capacity
    const room = Number.isFinite(inputBudget) ? Math.max(0, inputBudget - usedTokens) : null
    const factor = this.preference === 'conserve' ? 0.5 : this.preference === 'expand' ? 1.5 : 1

    const readCapacity = room === null ? READ_TEXT_MAX_CHARS : Math.floor(room * 0.6)
    const maxRead = Math.max(1, Math.min(READ_TEXT_MAX_CHARS, readCapacity))
    // Provider-controlled output has no locally known token ceiling.
    const editCapacity =
      outputTokens > 0
        ? Math.max(1, Math.floor(Math.max(0, outputTokens - 256) * 3 * 0.5))
        : CODE_TEXT_MAX_CHARS
    const maxEdit = Math.min(CODE_TEXT_MAX_CHARS, editCapacity)
    return {
      preference: this.preference,
      readChars: Math.min(maxRead, this.requested.read_chars ?? Math.floor(12000 * factor)),
      editChars: Math.min(
        maxEdit,
        this.requested.edit_chars ?? Math.max(Math.floor(8000 * factor), this.observedEdit)
      ),
      maxReadChars: maxRead,
      maxEditChars: maxEdit,
      hardEditChars: CODE_TEXT_MAX_CHARS,
      hardArgumentChars: TOOL_ARGUMENT_MAX_CHARS,
      remainingContextTokens: room,
      outputTokens: outputTokens > 0 ? outputTokens : null
    }
  }

  context(): string {
    return (
      '\nCODING RESOURCES (host estimates, characters): ' +
      JSON.stringify(this.snapshot()) +
      '\nUse these working sizes to avoid wasted output and context. Valid larger edits within hard limits are accepted automatically. Read sizes adapt to remaining context. Choose semantic boundaries yourself; never split source strings mechanically or reconstruct omitted code. coding_resources can inspect capacity or request edit_chars/read_chars for this run with a reason; requests are clamped to current capacity. No permission or scope changes are granted. Output capacity includes reasoning and JSON overhead; character estimates cannot guarantee generation fits. Ask the user only when scope or their configured resource limits need changing.'
    )
  }
}
