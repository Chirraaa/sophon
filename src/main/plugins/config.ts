import type { McpConfig } from '../../shared/plugins'

export function object(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}
function string(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length <= max && !value.includes('\0')
}
function dictionary(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (
    !object(value) ||
    Object.keys(value).length > 50 ||
    Object.entries(value).some(
      ([key, val]) => !/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/.test(key) || !string(val)
    )
  )
    throw new Error('Use at most 50 named string values for headers or environment variables.')
  return { ...value } as Record<string, string>
}
export function parseMcpConfig(value: unknown): McpConfig {
  if (!object(value)) throw new Error('MCP configuration must be an object.')
  const type = value.type ?? (value.command ? 'stdio' : 'http')
  if (type === 'stdio') {
    if (!string(value.command, 1024) || !value.command.trim())
      throw new Error('A local MCP needs an executable command.')
    if (
      value.args !== undefined &&
      (!Array.isArray(value.args) || value.args.length > 64 || !value.args.every((v) => string(v)))
    )
      throw new Error('MCP args must be an array of up to 64 strings.')
    if (
      value.cwd !== undefined &&
      (!string(value.cwd, 1024) || !/^(?:[A-Za-z]:[\\/]|\/)/.test(value.cwd))
    )
      throw new Error('MCP cwd must be an absolute folder path.')
    if (value.url !== undefined || value.headers !== undefined)
      throw new Error('Local MCPs use command/args/env, not URL/headers.')
    return {
      type,
      command: value.command,
      args: (value.args ?? []) as string[],
      cwd: value.cwd as string | undefined,
      env: dictionary(value.env)
    }
  }
  if (type !== 'http')
    throw new Error('Supported MCP transports are stdio and Streamable HTTP (type: http).')
  if (!string(value.url, 2048) || !value.url)
    throw new Error('This connector needs an MCP endpoint URL.')
  const url = new URL(value.url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'Use HTTPS (or HTTP on loopback), without credentials, query parameters or fragments.'
    )
  if (
    value.command !== undefined ||
    value.args !== undefined ||
    value.env !== undefined ||
    value.cwd !== undefined
  )
    throw new Error('HTTP MCPs use URL/headers, not local process settings.')
  const headers = dictionary(value.headers)
  if (
    headers &&
    Object.entries(headers).some(
      ([key, val]) =>
        /[\r\n]/.test(val) ||
        /^(host|connection|content-length|mcp-session-id|mcp-protocol-version)$/i.test(key)
    )
  )
    throw new Error('Invalid or transport-owned HTTP header.')
  return { type, url: url.href, headers }
}

export function parseCallArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length > 32000)
    throw new Error('MCP arguments must be a JSON object string of at most 32000 characters.')
  const parsed: unknown = JSON.parse(value)
  if (!object(parsed)) throw new Error('MCP arguments must decode to an object.')
  return parsed
}

export function destination(config: McpConfig): string {
  return config.type === 'http'
    ? config.url!
    : JSON.stringify({ command: config.command, args: config.args, cwd: config.cwd })
}
