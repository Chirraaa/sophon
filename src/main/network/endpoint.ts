export function modelEndpoint(input: string, provider: ModelProvider = 'local'): string {
  const url = new URL(input)
  if (!['local', 'openai', 'compatible', 'chatgpt'].includes(provider))
    throw new Error('Unknown model provider.')
  if (provider !== 'local') {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      ((provider === 'openai' || provider === 'chatgpt') &&
        url.toString().replace(/\/$/, '') !== 'https://api.openai.com/v1')
    )
      throw new Error('Use an HTTPS API base address. OpenAI requires https://api.openai.com/v1.')
    return url.toString().replace(/\/$/, '')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/v1'
  )
    throw new Error(
      'Use a loopback model endpoint such as http://127.0.0.1:1234/v1. Remote inference is disabled.'
    )
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.toString().replace(/\/$/, '')
}
