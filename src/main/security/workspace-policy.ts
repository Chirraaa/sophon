import { app } from 'electron'
import { realpath } from 'fs/promises'
import { resolve, relative, isAbsolute, parse } from 'path'

export const READ_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.scss',
  '.svg',
  '.py',
  '.html',
  '.css',
  '.yaml',
  '.yml',
  '.xml',
  '.log',
  '.sql',
  '.rs',
  '.go',
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hxx',
  '.java',
  '.gradle',
  '.kts',
  '.properties',
  '.cmake',
  '.mk',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '',
  '.h',
  '.toml',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp'
])

export const WRITE_EXTENSIONS = new Set(
  [...READ_EXTENSIONS]
    .filter((extension) => !['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension))
    .concat(['.svg', '.htm', '.mjs', '.sh', '.ps1', '.bat', '.cmd'])
)
export const SENSITIVE_PART =
  /^(?:\.(?:git|aws|ssh|azure|config|codex|agents|gnupg|kube|vscode|env|docker|netrc|npmrc|pypirc)(?:\..*)?|node_modules|appdata|windows|program files(?: \(x86\))?|startup|start menu|credentials(?:\..*)?|secrets?(?:\..*)?|agents\.md|skill\.md|ntuser\.dat|id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|p12|pfx|kdbx|ppk|ovpn|rdp)|settings\.json|settings-review\.json|security-events)$/i
const within = (root: string, target: string): boolean => {
  const rel = relative(resolve(root).toLowerCase(), resolve(target).toLowerCase())
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel))
}
export async function validateWorkspaceRoot(input: string): Promise<string> {
  if (
    !input ||
    !isAbsolute(input) ||
    input.startsWith('\\\\') ||
    input.split(/[\\/]/).some((part) => /~\d/.test(part))
  )
    throw new Error('Choose a full local scratch-folder path.')
  const root = await realpath(input)
  if (
    root.toLowerCase() === parse(root).root.toLowerCase() ||
    root.toLowerCase() === app.getPath('home').toLowerCase() ||
    root.split(/[\\/]/).some((part) => SENSITIVE_PART.test(part)) ||
    [app.getPath('userData'), app.getAppPath(), process.env.SystemRoot]
      .filter(Boolean)
      .some((folder) => within(folder!, root))
  )
    throw new Error(
      'Protected workspace root. Choose a dedicated scratch folder outside application, profile, system and credential directories.'
    )
  return root
}
export function synchronizedWorkspace(input: string): boolean {
  return (
    /(?:^|[\\/])(?:onedrive(?: - [^\\/]+)?|dropbox)(?:[\\/]|$)/i.test(input) ||
    ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer', 'Dropbox'].some((name) =>
      Boolean(process.env[name] && within(process.env[name]!, input))
    )
  )
}
export function validateCsv(content: string): void {
  for (const cell of content.split(/[,;\t\r\n]/)) {
    const value = cell.replace(/^[\s\uFEFF"']+/, '')
    if (
      /^[=+@-]/.test(value) &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?["']?$/.test(value)
    )
      throw new Error(
        'Formula-like CSV cells are blocked. Use plain values or save a .txt document.'
      )
  }
}
