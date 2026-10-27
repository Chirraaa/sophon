import { is } from '@electron-toolkit/utils'

export function rendererDocument(): URL {
  const development = is.dev && process.env.ELECTRON_RENDERER_URL
  const url = new URL(development || 'sophon-app://app/index.html')
  if (
    development &&
    (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('The development renderer must be on loopback.')
  return url
}
export function trustedDocument(input: string): boolean {
  try {
    const actual = new URL(input)
    const expected = rendererDocument()
    actual.hash = ''
    expected.hash = ''
    return actual.href === expected.href
  } catch {
    return false
  }
}
