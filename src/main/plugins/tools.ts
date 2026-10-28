import { pluginSummaries, readPluginDocument, serverRecord } from './store'
import {
  connected,
  connectionSummaries,
  connectionCapabilities,
  disconnect,
  safeResult
} from './runtime'
import { destination, parseCallArguments } from './config'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { untrustedData } from '../llm/untrusted-data'
import { assertRun, type RunContext } from '../security/run-manager'
import { pluginSkillId } from './skills'

export function bindPluginAction(
  name: string,
  args: Record<string, unknown>
): { preview: unknown; revalidate: () => void } {
  if (!name.startsWith('mcp_'))
    return { preview: 'Read enabled local plugin guidance.', revalidate: () => undefined }
  const id = String(args.server)
  const server = serverRecord(id)
  const connection = connected(id)
  const definition =
    name === 'mcp_call' ? connection.tools.find((t) => t.name === args.tool) : undefined
  if (name === 'mcp_call' && !definition)
    throw new Error('Unknown MCP tool. Discover the current catalogue first.')
  const parameters =
    name === 'mcp_call' || args.arguments_json !== undefined
      ? parseCallArguments(args.arguments_json)
      : undefined
  if (definition) {
    const validation = new AjvJsonSchemaValidator().getValidator(definition.inputSchema)(parameters)
    if (!validation.valid)
      throw new Error(
        'MCP arguments do not match the discovered tool schema: ' + validation.errorMessage
      )
  }
  if (
    name === 'mcp_read' &&
    args.kind === 'prompt' &&
    parameters &&
    Object.values(parameters).some((v) => typeof v !== 'string')
  )
    throw new Error('MCP prompt arguments must be strings.')
  const fingerprint = JSON.stringify(server)
  return {
    preview: {
      server: server.name,
      destination: destination(server.config),
      operation: args.tool ?? args.kind,
      arguments: parameters,
      toolDescription: definition?.description,
      access:
        server.config.type === 'stdio'
          ? 'Local MCP runs with your Windows account access, outside Sophon workspace and app restrictions.'
          : 'Arguments go to this external service. Its account permissions apply.'
    },
    revalidate: () => {
      if (JSON.stringify(serverRecord(id)) !== fingerprint || connected(id) !== connection)
        throw new Error('MCP connection changed after approval.')
    }
  }
}

export async function executePluginTool(
  name: string,
  args: Record<string, unknown>,
  run: RunContext
): Promise<string> {
  assertRun(run)
  if (name === 'plugins_list') {
    const query = String(args.query ?? '')
      .trim()
      .toLowerCase()
    const matches = (value: unknown): boolean =>
      !query || JSON.stringify(value).toLowerCase().includes(query)
    const servers = connectionSummaries()
      .filter((s) => s.enabled)
      .map((server) => {
        const tools = connectionCapabilities(server.id)
        const relevant = matches({ name: server.name }) ? tools : tools.filter(matches)
        return {
          ...server,
          capabilities: relevant.slice(0, 8),
          moreCapabilities: relevant.length > 8
        }
      })
      .filter((server) => matches(server) || server.capabilities.length > 0)
    return untrustedData(
      'plugin-catalogue',
      'Enabled plugins and MCPs',
      JSON.stringify({
        plugins: pluginSummaries().filter((p) => p.enabled && matches(p)),
        servers,
        note: 'Capabilities describe cached connected tools, not permissions or authenticated account scope. Use mcp_catalog with query for exact schemas; disconnected servers require user connection in Settings. No match: use another available route.'
      })
    )
  }
  if (name === 'plugin_read') {
    const document = readPluginDocument(String(args.plugin), String(args.path))
    return untrustedData(
      'plugin-guidance',
      String(args.path),
      `Skill ID for coding_checkpoint: ${pluginSkillId(String(args.plugin), String(args.path))}\n` +
        (document.length > 60000
          ? document.slice(0, 60000) + '\n[Document truncated at 60000 characters]'
          : document)
    )
  }
  const id = String(args.server)
  const connection = connected(id)
  const client = connection.client
  const signal = AbortSignal.any([run.signal, connection.controller.signal])
  const abort = (): void => {
    void disconnect(id)
  }
  run.signal.addEventListener('abort', abort, { once: true })
  const options = { signal, timeout: 30000 }
  try {
    let result: unknown
    if (name === 'mcp_catalog') {
      const cursor = args.cursor ? { cursor: String(args.cursor) } : {}
      if (args.kind === 'tools') {
        const query = String(args.query ?? '')
          .trim()
          .toLowerCase()
        const tools = connection.tools.filter(
          (tool) => !query || `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(query)
        )
        const offset = args.cursor === undefined ? 0 : Number(args.cursor)
        if (!Number.isInteger(offset) || offset < 0 || offset > tools.length)
          throw new Error('Invalid tool catalogue cursor.')

        let end = offset
        let size = 0
        while (end < tools.length && end < offset + 20) {
          const length = JSON.stringify(tools[end]).length
          if (length > 50000)
            throw new Error('MCP tool schema exceeds the supported context limit.')
          if (size + length > 50000) break
          size += length
          end++
        }
        result = {
          tools: tools.slice(offset, end),
          nextCursor: end < tools.length ? String(end) : undefined,
          ...(query ? { query } : {})
        }
      } else if (args.kind === 'resources') result = await client.listResources(cursor, options)
      else if (args.kind === 'templates')
        result = await client.listResourceTemplates(cursor, options)
      else result = await client.listPrompts(cursor, options)
    } else if (name === 'mcp_read') {
      if (args.kind === 'resource')
        result = await client.readResource({ uri: String(args.target) }, options)
      else
        result = await client.getPrompt(
          {
            name: String(args.target),
            arguments: parseCallArguments(args.arguments_json ?? '{}') as Record<string, string>
          },
          options
        )
    } else {
      if (!connection.tools.some((t) => t.name === args.tool))
        throw new Error('Unknown MCP tool. Refresh the connection in Settings.')
      result = await client.callTool(
        { name: String(args.tool), arguments: parseCallArguments(args.arguments_json) },
        undefined,
        options
      )
    }
    assertRun(run)
    const text = untrustedData('mcp-result', serverRecord(id).name, safeResult(id, result))
    return result && typeof result === 'object' && 'isError' in result && result.isError === true
      ? 'Tool error: MCP server reported failure.\n' + text
      : text
  } catch {
    await disconnect(id)
    assertRun(run)
    return 'Unverified: MCP operation failed or timed out; the connection was closed. An external action may have completed. Inspect its state before retrying. Reconnect in Settings > Plugins.'
  } finally {
    run.signal.removeEventListener('abort', abort)
  }
}
