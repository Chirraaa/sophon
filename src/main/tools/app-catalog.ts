import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { join } from 'path'
import { blockedAppRule } from '../permissions'
import { assertRun, currentRun } from '../security/run-manager'

export type InstalledApp = { id: string; name: string; appId: string; executable?: string }
let cache: { expires: number; apps: InstalledApp[] } | undefined
const hasControls = (value: string): boolean =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const normalize = (name: string): string =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\.exe$/, '')
    .replace(/\s+/g, ' ')

export function parseApps(data: string): InstalledApp[] {
  const parsed: unknown = JSON.parse(data.replace(/^\uFEFF/, '') || '[]')
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const apps = new Map<string, InstalledApp>()
  for (const row of rows) {
    if (!row || typeof row.Name !== 'string' || typeof row.AppID !== 'string') continue
    const name = row.Name.trim()
    const appId = row.AppID.trim()
    if (!name || name.length > 200 || !appId || appId.length > 1000) continue
    if (hasControls(name + appId) || appId.includes('"')) continue
    const id = 'app-' + createHash('sha256').update(appId).digest('hex').slice(0, 20)
    const candidate =
      typeof row.Executable === 'string' && row.Executable
        ? row.Executable
        : (appId.split(/[\\/]/).at(-1) ?? '')
    const executable =
      !hasControls(candidate) && /^[^\\/:*?"<>|]+\.exe$/i.test(candidate) ? candidate : undefined
    apps.set(id, { id, name, appId, executable })
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function installedApps(refresh = false): Promise<InstalledApp[]> {
  if (!refresh && cache && cache.expires > Date.now()) return cache.apps

  const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$targets=@{}
try {
  $folder=(New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder')
  foreach ($item in $folder.Items()) {
    $target=$item.ExtendedProperty('System.Link.TargetParsingPath')
    if ($target -and [IO.Path]::GetExtension($target) -eq '.exe') {
      $targets[$item.Path]=[IO.Path]::GetFileName($target)
    }
  }
} catch { }
@(Get-StartApps | ForEach-Object {
  [PSCustomObject]@{Name=$_.Name; AppID=$_.AppID; Executable=$targets[$_.AppID]}
}) | ConvertTo-Json -Compress`
  const data = await new Promise<string>((resolve, reject) => {
    execFile(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
  const apps = parseApps(data)
  cache = { expires: Date.now() + 60000, apps }
  return apps
}

export function matchingApps(apps: InstalledApp[], query: string): InstalledApp[] {
  const key = normalize(query)
  if (!key) return apps
  const exact = apps.filter((app) => app.id === key || normalize(app.name) === key)
  if (exact.length) return exact
  const words = key.split(' ')
  return apps.filter((app) => words.every((word) => normalize(app.name).includes(word)))
}

export function appChoices(apps: InstalledApp[]): string {
  return apps
    .slice(0, 40)
    .map((app) => `${app.id}: ${JSON.stringify(app.name)}`)
    .join('\n')
}

export async function listApps(query = ''): Promise<string> {
  const run = currentRun()
  if (!run) return 'Denied: no active task.'
  assertRun(run)
  if (query.length > 200 || hasControls(query)) return 'Invalid app query.'
  try {
    const apps = await installedApps()
    assertRun(run)
    const matches = matchingApps(apps, query).filter(
      (app) => !blockedAppRule(app.name, app.appId, app.executable ?? '')
    )
    if (!matches.length) return 'No matching installed apps found in the Windows Start menu.'
    return `Installed apps (${matches.length}${matches.length > 40 ? ', first 40; narrow query for more' : ''}):\n${appChoices(matches)}\nUse an exact name or app- reference with open_app.`
  } catch (error) {
    return `Failed to discover installed apps: ${(error as Error).message}`
  }
}
