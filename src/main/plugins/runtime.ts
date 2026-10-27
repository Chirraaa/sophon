import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { containCommand } from '../security/worker-job'
import { serverRecord, serverSummaries } from './store'
import type { McpSummary } from '../../shared/plugins'

interface Connection {
  client: Client
  transport: StdioClientTransport | StreamableHTTPClientTransport
  controller: AbortController
  status: McpSummary['status']
  error?: string
  tools: Tool[]
  release?: () => void
}
const connections = new Map<string, Connection>()

export function endpointFetch(endpoint: string, signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input))
    if (target.href !== new URL(endpoint).href)
      throw new Error('MCP attempted to leave its configured endpoint.')
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([
        signal,
        ...(init?.signal ? [init.signal] : []),
        AbortSignal.timeout(60000)
      ])
    })
    if (!response.body) return response
    const reader = response.body.getReader()
    let size = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            controller.close()
            return
          }
          size += chunk.value.byteLength
          if (size > 4 * 1024 * 1024) {
            await reader.cancel()
            throw new Error('MCP response exceeds 4 MB.')
          }
          controller.enqueue(chunk.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel: () => reader.cancel()
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}
export function connectionSummaries(): McpSummary[] {
  return serverSummaries().map((s) => {
    const c = connections.get(s.id)
    return {
      ...s,
      status: c?.status ?? 'disconnected',
      toolCount: c?.tools.length ?? 0,
      error: c?.error
    }
  })
}
export async function disconnect(id: string): Promise<void> {
  const c = connections.get(id)
  if (!c) return
  connections.delete(id)
  c.controller.abort()
  c.release?.()
  c.release = undefined
  await c.client.close().catch(() => undefined)
}
export async function closeConnections(): Promise<void> {
  await Promise.allSettled([...connections.keys()].map(disconnect))
}
export function connected(id: string): Connection {
  serverRecord(id)
  const c = connections.get(id)
  if (!c || c.status !== 'connected')
    throw new Error('Connect this MCP in Settings > Plugins first.')
  return c
}
export async function connectServer(id: string): Promise<void> {
  const server = serverRecord(id)
  if (connections.get(id)?.status === 'connecting')
    throw new Error('This connection is already starting.')
  await disconnect(id)
  const controller = new AbortController()
  const client = new Client({ name: 'sophon', version: '1.0.0' }, { capabilities: {} })
  const transport =
    server.config.type === 'stdio'
      ? new StdioClientTransport({
          command: server.config.command!,
          args: server.config.args,
          cwd: server.config.cwd,
          env: server.config.env,
          stderr: 'ignore',
          maxBufferSize: 4 * 1024 * 1024
        })
      : new StreamableHTTPClientTransport(new URL(server.config.url!), {
          requestInit: { headers: server.config.headers, redirect: 'error' },
          fetch: endpointFetch(server.config.url!, controller.signal),
          reconnectionOptions: {
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
            maxRetries: 0
          }
        })
  const c: Connection = { client, transport, controller, status: 'connecting', tools: [] }
  connections.set(id, c)
  if (transport instanceof StdioClientTransport) {
    const start = transport.start.bind(transport)
    transport.start = async () => {
      await start()
      if (controller.signal.aborted) {
        await transport.close()
        throw new Error('Connection cancelled.')
      }
      if (process.platform === 'win32' && transport.pid) c.release = containCommand(transport.pid)
    }
  }
  client.onclose = () => {
    c.status = 'disconnected'
    c.tools = []
    c.release?.()
    c.release = undefined
  }
  client.onerror = () => {}
  try {
    await client.connect(transport, { signal: controller.signal, timeout: 20000 })
    serverRecord(id)
    if (client.getServerCapabilities()?.tools) {
      let cursor: string | undefined
      let pages = 0
      let size = 0
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, {
          signal: controller.signal,
          timeout: 15000
        })
        c.tools.push(...page.tools)
        size += JSON.stringify(page.tools).length
        if (
          ++pages > 25 ||
          size > 2000000 ||
          c.tools.length > 500 ||
          (cursor && page.nextCursor === cursor)
        )
          throw new Error('MCP tool catalogue limit exceeded.')
        cursor = page.nextCursor
      } while (cursor)
    }
    if (connections.get(id) !== c) throw new Error('Connection cancelled.')
    controller.signal.throwIfAborted()
    c.status = 'connected'
  } catch {
    controller.abort()
    c.release?.()
    c.release = undefined
    await client.close().catch(() => undefined)
    c.status = 'error'
    c.error =
      'Could not connect. Check the endpoint or executable, credentials, and server availability. OAuth-only servers need a token or an authenticated local bridge.'
  }
}

export function safeResult(id: string, result: unknown): string {
  const config = serverRecord(id).config
  let text = JSON.stringify(result)
  for (const secret of Object.values(config.headers ?? {}).concat(
    Object.values(config.env ?? {})
  )) {
    if (secret.length >= 4) {
      text = text.split(secret).join('[redacted]')
      const token = secret.replace(/^(Bearer|Basic) /i, '')
      if (token.length >= 4) text = text.split(token).join('[redacted]')
    }
  }
  return text.length > 60000
    ? text.slice(0, 60000) + '\n[Output truncated at 60000 characters]'
    : text
}
