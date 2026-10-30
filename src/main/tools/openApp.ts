import { spawn } from 'child_process'
import { join } from 'path'
import { assertRun, currentRun } from '../security/run-manager'
import { blockedAppRule } from '../permissions'
import { listWindows, windowReference } from './windows'
import { appChoices, installedApps, matchingApps } from './app-catalog'
const ALIASES: Record<string, string> = {
  calculator: 'calc.exe',
  calc: 'calc.exe',
  notepad: 'notepad.exe',
  paint: 'mspaint.exe',
  mspaint: 'mspaint.exe'
}
function launchDetached(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',

      windowsHide: false,
      shell: false
    })
    child.once('error', reject)

    child.once('spawn', () => resolve())
    child.unref()
  })
}
export type AppLaunch = { name: string; appId: string; target?: string; executable?: string }
export async function resolveApp(name: string): Promise<AppLaunch | string> {
  if (
    !name.trim() ||
    name.length > 200 ||
    [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return 'Invalid app name.'
  const key = name.toLowerCase().trim()
  const alias = key.replace(/\.exe$/, '')
  const target = Object.hasOwn(ALIASES, alias) ? ALIASES[alias] : undefined
  if (target) return { name, appId: target, target }
  let matches = matchingApps(await installedApps(), name)
  if (!matches.length) matches = matchingApps(await installedApps(true), name)
  if (!matches.length)
    return `Failed to find installed app ${JSON.stringify(name)}. Use list_apps to search Windows Start menu apps. Portable apps need a Start menu shortcut.`
  if (matches.length > 1)
    return `Could not choose an app: multiple installed apps match. Ask the user which one, then use its app- reference:\n${appChoices(matches)}`
  return { name: matches[0].name, appId: matches[0].appId, executable: matches[0].executable }
}

export async function openApp(name: string, approved?: AppLaunch): Promise<string> {
  try {
    const run = currentRun()
    if (!run) return 'Denied: no active task.'
    assertRun(run)
    const resolved = approved ?? (await resolveApp(name))
    assertRun(run)
    if (typeof resolved === 'string') return resolved
    const { name: appName, appId, target, executable } = resolved
    const blocked = blockedAppRule(name, appName, appId, executable ?? '')
    if (blocked) return `Blocked: "${appName}" matches your blocked-apps rule "${blocked}".`
    assertRun(run)
    const root = process.env.SystemRoot ?? 'C:\\Windows'
    if (target) await launchDetached(join(root, 'System32', target), [])
    else await launchDetached(join(root, 'explorer.exe'), [`shell:AppsFolder\\${appId}`])

    const deadline = Date.now() + 10000
    const title = appName.toLowerCase()
    let previous = ''
    let stableAt = Date.now()
    while (Date.now() < deadline) {
      assertRun(run)
      // Games and launcher-started apps often run under an executable unrelated to the
      // Start menu name, so a window titled with the app name also counts.
      const win = listWindows().find(
        (w) =>
          ((target || executable
            ? w.exe.toLowerCase() === (target ?? executable)!.toLowerCase()
            : w.exe.toLowerCase().replace(/\.exe$/, '') === title) ||
            (!target && title.length >= 4 && w.title.toLowerCase().startsWith(title))) &&
          w.state !== 'minimized' &&
          w.width >= 150 &&
          w.height >= 100 &&
          (target !== 'notepad.exe' || w.title.toLowerCase() !== 'notepad')
      )
      const identity = win ? `${win.hwnd}:${win.title}` : ''
      if (!identity || identity !== previous) stableAt = Date.now()
      if (identity && identity === previous && Date.now() - stableAt >= 500)
        return `Opened ${appName}. Window: ${windowReference(win!)} ${JSON.stringify(win!.title)}.`
      previous = identity
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return `Unverified: sent launch request for ${appName}, but no matching stable window appeared within 10 seconds. It may still be loading (games and launcher-started apps often take longer or open under a different name). Check list_windows, wait a few seconds and check again if needed; launch again only if it is clearly not running.`
  } catch (error) {
    return `Failed to open ${name}: ${(error as Error).message}`
  }
}
