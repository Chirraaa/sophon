import type { ModelMessage } from './types'

export function releaseCheckpointedMessages(turn: ModelMessage[], checkpoint: string): void {
  turn.splice(1, turn.length - 1, {
    role: 'user',
    content: checkpoint
  })
}

export class RecentResults {
  private entries: string[] = []
  get length(): number {
    return this.entries.length
  }
  push(text: string): void {
    this.entries.push(
      text.length > 2000
        ? text.slice(0, 2000) + '\n[Result excerpt; full details are in task history.]'
        : text
    )
    if (this.entries.length > 8) this.entries.shift()
  }
  join(separator: string): string {
    return this.entries.join(separator)
  }
}
