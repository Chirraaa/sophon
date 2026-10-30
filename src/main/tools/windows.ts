import { protectedWindowRule } from '../permissions'
import { randomUUID } from 'crypto'
import { currentRun, assertRun } from '../security/run-manager'
import { monitorsText, monitorOf } from './monitors'
import type { WinInfo } from './window-types'
import {
  SW_RESTORE,
  bringToFront,
  enumTopLevelWindows,
  foregroundWindow,
  getProcess,
  getTitle,
  getVisibleRect,
  isCloaked,
  isMaximized,
  isMinimized,
  isToolWindow,
  isVisible,
  requestClose,
  showWindow
} from './win32'
export { monitors, monitorOf, resolveMonitor } from './monitors'
export { moveWindow, POSITIONS } from './window-move'
export type { MoveArgs } from './window-move'
export type { WinInfo } from './window-types'
const IGNORED_TITLES = new Set(['Program Manager'])
const references = new Map<string, { hwnd: number; pid: number; exe: string }>()

const editedTitles = new Map<string, { hwnd: number; pid: number; exe: string; title: string }>()
let referenceRun = ''
function currentReferences(): typeof references {
  const id = currentRun()?.id ?? ''
  if (id !== referenceRun || !id) {
    references.clear()
    editedTitles.clear()
    referenceRun = id
  }
  return references
}
export function windowReference(w: WinInfo): string {
  const refs = currentReferences()
  const pid = getProcess(w.hwnd).pid
  for (const [ref, value] of refs)
    if (value.hwnd === w.hwnd && value.pid === pid && value.exe === w.exe) return ref
  const ref = 'win-' + randomUUID()
  if (refs.size >= 200) refs.delete(refs.keys().next().value!)
  refs.set(ref, { hwnd: w.hwnd, pid, exe: w.exe })
  return ref
}
export function rememberEditedWindow(before: WinInfo, pid: number): void {
  currentReferences()
  const now = listWindows().find((w) => w.hwnd === before.hwnd && w.exe === before.exe)
  if (!now || now.title === before.title || getProcess(now.hwnd).pid !== pid) return
  const identity = { hwnd: before.hwnd, pid, exe: before.exe }
  for (const entry of editedTitles.values())
    if (entry.hwnd === now.hwnd && entry.pid === identity.pid) entry.title = now.title
  if (editedTitles.size >= 100) editedTitles.delete(editedTitles.keys().next().value!)
  editedTitles.set(before.title.toLowerCase().trim(), { ...identity, title: now.title })
}
export function listWindows(): WinInfo[] {
  const out: WinInfo[] = []
  for (const hwnd of enumTopLevelWindows()) {
    try {
      if (!isVisible(hwnd)) continue
      const title = getTitle(hwnd)
      if (!title || IGNORED_TITLES.has(title)) continue
      if (isCloaked(hwnd) || isToolWindow(hwnd)) continue
      const { pid, exe } = getProcess(hwnd)
      if (pid === process.pid) continue
      const r = getVisibleRect(hwnd)
      const state = isMinimized(hwnd) ? 'minimized' : isMaximized(hwnd) ? 'maximized' : 'normal'
      out.push({
        hwnd,
        title,
        exe,
        state,
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top
      })
    } catch {
      continue
    }
  }
  return out
}
function describe(w: WinInfo): string {
  if (w.state === 'minimized') return `"${w.title}" [${w.exe}] minimized`
  const mon = monitorOf(w).index
  return `"${w.title}" [${w.exe}] ${w.state} on monitor ${mon} at (${w.x},${w.y}) ${w.width}x${w.height}`
}
export function listWindowsText(): string {
  const wins = listWindows().filter((w) => !protectedWindowRule(w.title, w.exe))
  const body = wins.length
    ? wins
        .slice(0, 80)
        .map((w) => `${windowReference(w)} ${describe(w)}`)
        .join('\n')
    : 'No open windows found.'
  const active = activeWindow()
  const current =
    active && !protectedWindowRule(active.title, active.exe)
      ? `Active window: ${windowReference(active)} "${active.title}" on monitor ${monitorOf(active).index}\n\n`
      : ''
  return `${monitorsText()}\n\n${current}Windows:\n${body}`
}
function score(w: WinInfo, q: string): number {
  const t = w.title.toLowerCase()
  const e = w.exe.toLowerCase().replace(/\.exe$/, '')
  if (t === q || e === q) return 3
  if (t.startsWith(q) || e.startsWith(q)) return 2
  if (t.includes(q) || e.includes(q)) return 1
  return 0
}
export function findWindow(query: string): WinInfo | null {
  currentReferences()
  if (query.startsWith('win-')) {
    const ref = /^(win-[0-9a-f-]{36})(?:\s+"[^"\r\n]*")?$/i.exec(query)?.[1] ?? query
    const identity = currentReferences().get(ref)
    if (!identity) return null
    return (
      listWindows().find(
        (w) =>
          w.hwnd === identity.hwnd &&
          w.exe === identity.exe &&
          getProcess(w.hwnd).pid === identity.pid
      ) ?? null
    )
  }
  const q = query
    .toLowerCase()
    .trim()
    .replace(/\.exe$/, '')
  let best: WinInfo | null = null
  let bestScore = 0
  let tied = false
  for (const w of listWindows()) {
    const s = score(w, q)
    if (s > bestScore) {
      best = w
      bestScore = s
      tied = false
    } else if (s > 0 && s === bestScore) {
      tied = true
    }
  }
  if (tied || best) return tied ? null : best
  const edited = editedTitles.get(q)
  return edited
    ? (listWindows().find(
        (w) =>
          w.hwnd === edited.hwnd &&
          w.exe === edited.exe &&
          w.title === edited.title &&
          getProcess(w.hwnd).pid === edited.pid
      ) ?? null)
    : null
}
let lastExternal: { hwnd: number; pid: number; exe: string } | null = null
// Returns whether another app was in front, so focus can later go back to it.
export function rememberExternalWindow(): boolean {
  const h = foregroundWindow()
  if (!h) return false
  const identity = getProcess(h)
  if (identity.pid === process.pid) return false
  if (!listWindows().some((w) => w.hwnd === h)) return false
  lastExternal = { hwnd: h, ...identity }
  return true
}
// Fullscreen games often minimize when they lose focus; bring them back as they were.
export function restoreExternalWindow(): boolean {
  const target = lastExternal
  if (!target || !isVisible(target.hwnd)) return false
  const identity = getProcess(target.hwnd)
  if (identity.pid !== target.pid || identity.exe !== target.exe) return false
  if (isMinimized(target.hwnd)) showWindow(target.hwnd, SW_RESTORE)
  return bringToFront(target.hwnd)
}
export function activeWindow(): WinInfo | null {
  const windows = listWindows()
  const current = foregroundWindow()
  return (
    windows.find((w) => w.hwnd === current) ??
    windows.find(
      (w) =>
        w.hwnd === lastExternal?.hwnd &&
        w.exe === lastExternal.exe &&
        getProcess(w.hwnd).pid === lastExternal.pid
    ) ??
    null
  )
}
export function targetWindow(title?: string): WinInfo | null {
  return title ? findWindow(title) : activeWindow()
}
export async function closeWindow(title?: string, bound?: WinInfo): Promise<string> {
  const win = bound ?? targetWindow(title)
  if (!win) return `No window matching "${title ?? 'active window'}".`
  const rule = protectedWindowRule(win.title, win.exe)
  if (rule) return `Blocked: "${win.title}" is protected by your rule "${rule}".`
  const pid = getProcess(win.hwnd).pid
  if (!requestClose(win.hwnd)) return `Windows refused to close "${win.title}".`
  const run = currentRun()
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (run) assertRun(run)
    if (!listWindows().some((w) => w.hwnd === win.hwnd && getProcess(w.hwnd).pid === pid))
      return `Closed "${win.title}". Verified window closed.`
  }
  return `Asked "${win.title}" to close. The window is still present; inspect for an unsaved-work prompt.`
}
export function closeApp(name: string, bound?: WinInfo[]): string {
  const query = name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (!query || query.length > 80) return 'Provide an app name.'
  const windows =
    bound ?? listWindows().filter((w) => w.exe.toLowerCase().replace(/\.exe$/, '') === query)
  if (!windows.length) return `No open app named "${name}".`
  const protectedBy = windows.find((w) => protectedWindowRule(w.title, w.exe))
  if (protectedBy) return `Blocked: "${protectedBy.title}" is protected.`
  const requested = windows.filter((w) => requestClose(w.hwnd)).length
  return requested
    ? `Asked ${requested} window${requested === 1 ? '' : 's'} of ${name} to close. The app may ask about unsaved work.`
    : `Windows refused to close ${name}.`
}
