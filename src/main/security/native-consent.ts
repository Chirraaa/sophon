import { type BrowserWindow } from 'electron'
import { trustedDocument } from './trusted-document'
import { styledConsent, type ConsentPresentation } from './consent-window'

let pending = false
let ownerWindow: () => BrowserWindow | null = () => null
export function setConsentOwner(provider: () => BrowserWindow | null): void {
  ownerWindow = provider
}

export async function nativeConsent(
  message: string,
  detail: string,
  signal?: AbortSignal,
  presentation?: ConsentPresentation
): Promise<boolean> {
  if (pending || signal?.aborted) return false
  if (detail.length > 12000)
    throw new Error('This action is too large for a complete preview. Use a smaller action.')
  const owner = ownerWindow()
  if (!owner || owner.isDestroyed() || !trustedDocument(owner.webContents.mainFrame.url))
    throw new Error('No trusted application window is available for confirmation.')
  pending = true
  const escaped = detail.replace(
    // eslint-disable-next-line no-control-regex -- Escape control characters in native approval text.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
  const approvalSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
    : AbortSignal.timeout(90000)
  try {
    const result = await styledConsent(
      owner,
      message,
      escaped,
      approvalSignal,
      presentation ?? {
        confirmLabel: 'Allow this exact action',
        summary:
          'Review the complete request below before allowing it. Cancel keeps the current permissions.',
        changes: [],
        showDetails: true
      }
    )
    return (
      !approvalSignal.aborted &&
      !owner.isDestroyed() &&
      trustedDocument(owner.webContents.mainFrame.url) &&
      result
    )
  } finally {
    pending = false
  }
}
