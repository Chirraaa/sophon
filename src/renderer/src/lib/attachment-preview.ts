type Preview = { url?: string; text?: string }

// The main process allows 20 calls per channel per second. A long desktop task can
// mount dozens of screenshot attachments at once, so requests are shared per id and
// paced below that limit instead of all firing on mount.
const PER_SECOND = 15
const pending = new Map<string, Promise<Preview>>()
let next = 0

const slot = (): Promise<void> => {
  const now = Date.now()
  next = Math.max(next, now) + 1000 / PER_SECOND
  return new Promise((resolve) => setTimeout(resolve, next - 1000 / PER_SECOND - now))
}

export function loadPreview(id: string): Promise<Preview> {
  let request = pending.get(id)
  if (!request) {
    request = slot()
      .then(() => window.api.attachments.preview(id))
      .finally(() => pending.delete(id))
    pending.set(id, request)
  }
  return request
}
