import { lstatSync, readFileSync, readdirSync, realpathSync, type Stats } from 'fs'
import { join, relative, isAbsolute, sep } from 'path'
import { object, parseMcpConfig } from './config'
import type { McpConfig } from '../../shared/plugins'

export interface ImportedPlugin {
  name: string
  version: string
  description: string
  documents: Record<string, string>
  servers: { name: string; config: McpConfig }[]
  warnings: string[]
}

export function readPlugin(folder: string): ImportedPlugin {
  const root = realpathSync(folder)
  let bytes = 0
  let entries = 0
  const checked = (path: string): Stats => {
    if (++entries > 400) throw new Error('Plugin contains too many entries (maximum 400).')
    const info = lstatSync(path)
    const rel = relative(root, realpathSync(path))
    if (info.isSymbolicLink() || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
      throw new Error('Linked plugin files and folders are not supported.')
    return info
  }
  const read = (path: string): string => {
    const info = checked(path)
    if (!info.isFile() || info.size > 128000 || (bytes += Number(info.size)) > 2000000)
      throw new Error('Plugin exceeds the file or total size limit.')
    return readFileSync(path, 'utf8')
  }
  const manifest: unknown = JSON.parse(read(join(root, '.claude-plugin', 'plugin.json')))
  if (
    !object(manifest) ||
    typeof manifest.name !== 'string' ||
    !/^[\w .-]{1,100}$/.test(manifest.name)
  )
    throw new Error('Expected .claude-plugin/plugin.json with a valid name.')
  const result: ImportedPlugin = {
    name: String(manifest.displayName ?? manifest.name).slice(0, 100),
    version: String(manifest.version ?? '0.0.0').slice(0, 40),
    description: String(manifest.description ?? '').slice(0, 2000),
    documents: {},
    servers: [],
    warnings: []
  }
  const walk = (directory: string): void => {
    checked(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      checked(path)
      if (entry.isDirectory()) walk(path)
      else if (/\.md$/i.test(entry.name)) {
        if (Object.keys(result.documents).length >= 100)
          throw new Error('At most 100 plugin documents are supported.')
        result.documents[relative(root, path).replaceAll('\\', '/')] = read(path)
      }
    }
  }
  const rootEntries = readdirSync(root)
  if (rootEntries.includes('skills')) walk(join(root, 'skills'))
  for (const name of ['README.md', 'CONNECTORS.md'])
    if (rootEntries.includes(name)) result.documents[name] = read(join(root, name))
  const mcp: unknown = rootEntries.includes('.mcp.json')
    ? JSON.parse(read(join(root, '.mcp.json')))
    : undefined
  const configs = {
    ...(object(manifest.mcpServers) ? manifest.mcpServers : {}),
    ...(object(mcp) && object(mcp.mcpServers) ? mcp.mcpServers : {})
  }
  if (Object.keys(configs).length > 30)
    throw new Error('A plugin may declare at most 30 MCP servers.')
  for (const [name, value] of Object.entries(configs)) {
    try {
      if (JSON.stringify(value).includes('${'))
        throw new Error('Replace environment placeholders in a custom connection first.')
      const config = parseMcpConfig(value)
      result.servers.push({ name: name.slice(0, 100), config })
      if (object(value) && value.oauth)
        result.warnings.push(
          `${name}: bundled OAuth client settings are not imported. Supply your own credentials in a custom connection.`
        )
    } catch (error) {
      result.warnings.push(`${name}: ${(error as Error).message}`)
    }
  }
  if (manifest.hooks || rootEntries.includes('hooks'))
    result.warnings.push('Executable hooks are not supported or run.')
  return result
}
