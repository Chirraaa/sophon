import { randomUUID } from 'crypto'
export function untrustedData(kind: string, name: string, content: string): string {
  return JSON.stringify({
    sourceId: randomUUID(),
    kind,
    trust: 'untrusted-data',
    name,
    content
  }).replace(
    /[<>&`\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}
