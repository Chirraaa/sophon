import type { BrowserWindow, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { getSettings } from '../settings'
import { trustedDocument } from './trusted-document'

export interface ConsentPresentation {
  confirmLabel: string
  summary: string
  changes: { label: string; before: string; after: string }[]
  showDetails?: boolean
}

let active: {
  owner: BrowserWindow
  review: ConsentReview
  finish: (allow: boolean) => void
} | null = null

export function readConsent(sender: WebContents): ConsentReview | null {
  if (!active || active.owner.isDestroyed() || active.owner.webContents !== sender) return null
  if (!trustedDocument(sender.mainFrame.url)) throw new Error('Untrusted permission review sender.')
  return structuredClone(active.review)
}

export function resolveConsent(sender: WebContents, id: string, allow: boolean): void {
  if (
    typeof allow !== 'boolean' ||
    !active ||
    active.review.id !== id ||
    active.owner.isDestroyed() ||
    active.owner.webContents !== sender ||
    !trustedDocument(sender.mainFrame.url)
  )
    throw new Error('Invalid or stale permission review decision.')
  active.finish(allow)
}

export function styledConsent(
  owner: BrowserWindow,
  title: string,
  detail: string,
  signal: AbortSignal,
  presentation: ConsentPresentation
): Promise<boolean> {
  if (
    active ||
    signal.aborted ||
    owner.isDestroyed() ||
    !trustedDocument(owner.webContents.mainFrame.url)
  )
    return Promise.resolve(false)
  const settings = getSettings()
  const review: ConsentReview = {
    id: randomUUID(),
    title,
    detail,
    ...structuredClone(presentation),
    accent: settings.accent,
    motion: settings.motion
  }
  return new Promise((resolve) => {
    const contents = owner.webContents
    let settled = false
    const finish = (allow: boolean): void => {
      if (settled) return
      settled = true
      active = null
      signal.removeEventListener('abort', cancel)
      owner.removeListener('closed', cancel)
      owner.removeListener('hide', cancel)
      contents.removeListener('render-process-gone', cancel)
      contents.removeListener('did-start-loading', cancel)
      if (!contents.isDestroyed()) contents.send('consent:changed', null)
      resolve(
        allow && !signal.aborted && !owner.isDestroyed() && trustedDocument(contents.mainFrame.url)
      )
    }
    const cancel = (): void => finish(false)
    active = { owner, review, finish }
    signal.addEventListener('abort', cancel, { once: true })
    owner.once('closed', cancel)
    owner.once('hide', cancel)
    contents.once('render-process-gone', cancel)
    contents.once('did-start-loading', cancel)
    contents.send('consent:changed', structuredClone(review))
    if (signal.aborted) cancel()
  })
}
