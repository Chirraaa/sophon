import { shell } from 'electron'
import { requestPublicText } from '../network/public-page'
import { publicSourceUrl } from '../network/url-policy'
import { extractWebHtml } from '../network/html-text'
import { listMemories, saveMemory } from '../memory/store'

const TITLE = 'Where to open web pages'
export function pagePreference(): PageDestination | null {
  const memory = listMemories().find((entry) => entry.scope === 'global' && entry.title === TITLE)
  if (memory?.content === 'Open web pages in my browser.') return 'browser'
  if (memory?.content === 'Open web pages in the Sophon reader.') return 'reader'
  return null
}

export async function openPage(
  input: string,
  destination: PageDestination,
  remember: boolean
): Promise<PagePreview | null> {
  const url = publicSourceUrl(input)
  if (!url) throw new Error('Choose a public HTTPS page.')
  let preview: PagePreview | null = null
  if (destination === 'browser') await shell.openExternal(url)
  else {
    const page = await requestPublicText(url, AbortSignal.timeout(15000))
    const parsed = page.html ? extractWebHtml(page.body) : null
    const text = parsed?.text ?? page.body
    preview = {
      url: page.url,
      pages: page.pages,
      title: parsed?.title || page.url,
      text: text.slice(0, 60000),
      truncated: text.length > 60000
    }
  }
  if (remember) {
    const old = listMemories().find((entry) => entry.scope === 'global' && entry.title === TITLE)
    saveMemory(
      {
        ...(old ? { id: old.id } : {}),
        title: TITLE,
        kind: 'preference',
        scope: 'global',
        pinned: true,
        content:
          destination === 'browser'
            ? 'Open web pages in my browser.'
            : 'Open web pages in the Sophon reader.'
      },
      '',
      ''
    )
  }
  return preview
}
