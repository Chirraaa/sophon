import { listWindows, targetWindow } from '../tools/windows'
import { getProcess } from '../tools/win32'
import { protectedWindowRule, blockedAppRule } from '../permissions'
import { controlTarget } from '../tools/automation/controls'
import type { WinInfo } from '../tools/window-types'
import {
  workspacePath,
  prepareWorkspaceDeletion,
  revalidateWorkspaceDeletion,
  type WorkspaceDeletion
} from '../tools/files'
import { stat } from 'fs/promises'
import { assertRun, type RunContext } from './run-manager'
import type { FileIdentity } from './workspace-handles'
import { extname } from 'path'
import { READ_EXTENSIONS, validateCsv } from './workspace-policy'
import { searchProviderLabel } from '../network/search-provider'
import { captureCoordinates, markPoint } from '../tools/screen'
import { resolveApp, type AppLaunch } from '../tools/openApp'
import type { DeviceTarget } from '../tools/system-control'
import type { CalendarBinding } from '../tools/calendar'
export interface ExecutionScope {
  approvedProposal?: string
  device?: DeviceTarget
  app?: AppLaunch
  window?: WinInfo
  windows?: WinInfo[]
  pid?: number
  file?: FileIdentity
  deletion?: WorkspaceDeletion
  calendar?: CalendarBinding
  /** The action reaches other people or cannot be undone, so it is approved each time. */
  oneUse?: boolean
  guard?: () => void
}

export async function bindLocalAction(
  name: string,
  args: Record<string, unknown>,
  run: RunContext
): Promise<{ preview: string; revalidate: () => Promise<void>; scope: ExecutionScope }> {
  const scope: ExecutionScope = {}
  const details: Record<string, unknown> = {
    taskId: run.id,
    mode: run.mode,
    model: run.endpoint,
    arguments: args
  }
  let revalidate = async (): Promise<void> => {
    assertRun(run)
  }
  if (['browser_open', 'browser_tabs', 'browser_inspect', 'browser_act'].includes(name)) {
    const { bindBrowserAction } = await import('../tools/browser/runtime')
    const binding = await bindBrowserAction(name, args, run)
    details.browser = binding.preview
    revalidate = binding.revalidate
  }
  if (name.startsWith('calendar_')) {
    const { bindCalendarAction } = await import('../tools/calendar')
    const plan = await bindCalendarAction(name, args, run)
    scope.calendar = plan.binding
    scope.oneUse = plan.oneUse
    details.event = plan.preview
    revalidate = plan.revalidate
  }
  if (name.startsWith('notes_')) {
    const { bindNotesAction } = await import('../tools/notes')
    const binding = bindNotesAction(name, args)
    if (Object.keys(binding.preview).length) details.note = binding.preview
    revalidate = async (): Promise<void> => {
      assertRun(run)
      binding.revalidate()
    }
  }
  if (name === 'set_volume' || name === 'set_radio') {
    const { prepareDeviceTarget, revalidateDeviceTarget } = await import('../tools/system-control')
    const target = await prepareDeviceTarget(name, args, run)
    scope.device = { ...target }
    details.device = { ...target }
    if (name === 'set_radio' && args.enabled === false)
      details.effect =
        'Turning this radio off can disconnect networks, Bluetooth audio, keyboard or mouse.'
    revalidate = async (): Promise<void> => revalidateDeviceTarget(target, run)
  }
  if (name === 'open_app') {
    const app = await resolveApp(String(args.name))
    assertRun(run)
    if (typeof app === 'string') throw new Error(app)
    if (blockedAppRule(String(args.name), app.name, app.appId, app.executable ?? ''))
      throw new Error('This app is blocked from launching.')
    scope.app = { ...app }
    details.app = { name: app.name, identity: app.appId }
    revalidate = async (): Promise<void> => {
      assertRun(run)
      if (blockedAppRule(String(args.name), app.name, app.appId, app.executable ?? ''))
        throw new Error('This app is blocked from launching.')
    }
  }
  if (
    [
      'move_window',
      'focus_window',
      'close_window',
      'look_at_screen',
      'inspect_app',
      'act_on_control',
      'click',
      'scroll',
      'press_keys',
      'type_text'
    ].includes(name)
  ) {
    const control = name === 'act_on_control' ? controlTarget(args, run) : undefined
    if (name === 'click' && args.mark !== undefined) {
      // A mark resolves to image coordinates once, so every later check is the coordinate path.
      const centre = markPoint(Number(args.mark))
      if (!centre)
        throw Object.assign(
          new Error(
            'Screenshot required: that mark is not on the latest screenshot or input has made it stale. Capture with marks again. No click was executed.'
          ),
          { code: 'SCREENSHOT_REQUIRED' }
        )
      details.mark = args.mark
      delete args.mark
      args.x = centre.x
      args.y = centre.y
    }
    const point = name === 'click' ? captureCoordinates(Number(args.x), Number(args.y)) : undefined
    if (name === 'click' && !point?.window)
      throw Object.assign(
        new Error(
          'Screenshot required: capture the intended target window again, then use coordinates inside the new image. No click was executed.'
        ),
        { code: 'SCREENSHOT_REQUIRED' }
      )
    const win =
      point?.window ??
      control?.window ??
      targetWindow(String(args.title ?? args.window ?? '') || undefined)
    if (!win)
      throw Object.assign(
        new Error(
          'Target not found: the window is missing or ambiguous. No action was executed. Use list_windows for fresh win- references; ask the user if the intended window is still unclear.'
        ),
        { code: 'TARGET_NOT_FOUND' }
      )
    if (protectedWindowRule(win.title, win.exe))
      throw new Error('No unambiguous, unprotected target window.')
    if (name !== 'look_at_screen' && blockedAppRule(win.exe))
      throw new Error('This app is blocked from interaction.')
    if (point) details.screenPoint = { x: point.x, y: point.y }
    if (control) details.control = control.preview
    scope.window = { ...win }
    const identity = getProcess(win.hwnd)
    scope.pid = identity.pid
    const snapshot = JSON.stringify(win)
    details.window = { ...win, pid: identity.pid }
    scope.guard = (): void => {
      assertRun(run)
      const current = listWindows().find((w) => w.hwnd === win.hwnd)
      if (
        !current ||
        current.exe !== win.exe ||
        getProcess(win.hwnd).pid !== identity.pid ||
        protectedWindowRule(current.title, current.exe)
      )
        throw new Error('The approved window identity changed.')
    }
    if (['look_at_screen', 'inspect_app', 'scroll', 'press_keys', 'type_text'].includes(name))
      args.window = win.title
    else if (!['act_on_control', 'click'].includes(name)) args.title = win.title
    revalidate = async (): Promise<void> => {
      assertRun(run)
      if (name === 'act_on_control') controlTarget(args, run)
      if (name === 'click') {
        const now = captureCoordinates(Number(args.x), Number(args.y))
        if (!now || now.window?.hwnd !== win.hwnd || now.x !== point?.x || now.y !== point?.y)
          throw new Error(
            'Screenshot required: the screenshot target changed. Capture the intended window again. No click was executed.'
          )
      }
      const current = listWindows().find((w) => w.hwnd === win.hwnd)
      if (
        !current ||
        JSON.stringify(current) !== snapshot ||
        getProcess(win.hwnd).pid !== identity.pid ||
        protectedWindowRule(current.title, current.exe)
      )
        throw new Error('The target window changed. Start a new action.')
    }
  }
  if (name === 'close_app') {
    const exe = String(args.name)
      .toLowerCase()
      .replace(/\.exe$/, '')
    const wins = listWindows().filter((w) => w.exe.toLowerCase().replace(/\.exe$/, '') === exe)
    if (!wins.length) throw new Error('No open app matching that exact executable name.')
    if (wins.some((w) => protectedWindowRule(w.title, w.exe) || blockedAppRule(w.exe)))
      throw new Error('This app contains a blocked or protected window.')
    scope.windows = wins.map((w) => ({ ...w }))
    const identities = wins.map((w) => ({ ...w, pid: getProcess(w.hwnd).pid }))
    details.windows = identities
    revalidate = async (): Promise<void> => {
      assertRun(run)
      const now = listWindows().filter((w) => w.exe.toLowerCase().replace(/\.exe$/, '') === exe)
      if (
        JSON.stringify(now.map((w) => ({ ...w, pid: getProcess(w.hwnd).pid }))) !==
        JSON.stringify(identities)
      )
        throw new Error('The app windows changed. Start a new action.')
      if (now.some((w) => protectedWindowRule(w.title, w.exe) || blockedAppRule(w.exe)))
        throw new Error('This app is blocked or protected.')
    }
  }
  if (name === 'delete_file' || name === 'delete_directory') {
    const snapshot = await prepareWorkspaceDeletion(
      { path: String(args.path), recursive: args.recursive === true },
      name === 'delete_directory'
    )
    scope.deletion = snapshot
    details.destination = snapshot.target
    details.deletion =
      'Permanent deletion; this does not use the Recycle Bin. Approval applies only to the listed objects. Partial failures can leave some contents removed.'
    details.entries = snapshot.entries.map((entry) => ({
      path: entry.path.slice(snapshot.root.length + 1),
      type: entry.directory ? 'folder' : 'file'
    }))
    revalidate = async () => {
      assertRun(run)
      await revalidateWorkspaceDeletion(snapshot)
      assertRun(run)
    }
  }
  if (
    [
      'list_files',
      'read_file',
      'write_file',
      'edit_file',
      'create_directory',
      'run_npm',
      'run_command'
    ].includes(name) ||
    (name === 'python_calculate' && args.path !== undefined)
  ) {
    if (name === 'python_calculate' && extname(String(args.path)).toLowerCase() !== '.csv')
      throw new Error('Python file input must be a CSV file.')
    if (name === 'read_file' && !READ_EXTENSIONS.has(extname(String(args.path)).toLowerCase()))
      throw new Error('This file format is not allowed for workspace reads.')
    if (name === 'write_file' && extname(String(args.path)).toLowerCase() === '.csv')
      validateCsv(String(args.content))
    const writing = name === 'write_file' || name === 'edit_file' || name === 'create_directory'
    const path = await workspacePath(
      String(args.path ?? '.'),
      writing,
      name === 'create_directory',
      name === 'read_file'
    )
    details.destination = path
    const info = await stat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && writing && name !== 'edit_file') return null
      throw error
    })
    if (name === 'write_file' && info && !args.overwrite)
      throw new Error('File exists. Read it first, then use overwrite: true to replace it.')
    if (name === 'write_file' && args.overwrite && !info)
      throw new Error('File does not exist. Omit overwrite to create it.')
    if (name === 'create_directory' && info) throw new Error('Folder already exists.')
    if (name === 'run_npm') {
      if (!info?.isDirectory()) throw new Error('Choose a project folder.')
      details.execution =
        args.action === 'stop'
          ? 'Stop the matching server process tree started by Sophon in this project. No npm script is executed and unrelated terminals are not targeted.'
          : 'Run npm with your Windows account permissions. It can download packages, run lifecycle/project scripts, access the network and modify files outside this folder. Stop or a 120-second timeout terminates the process tree; a ready dev server stays running until explicitly stopped or the app exits. Approve only trusted projects and packages.'
    }
    if (name === 'run_command') {
      if (!info?.isDirectory()) throw new Error('Choose an existing project folder.')
      details.execution = `Run this exact PowerShell command with your Windows account access, including network and files outside this folder. This is not a sandbox. Stop or the ${args.timeout_seconds ?? 120}-second timeout terminates the process tree. Approval applies to this invocation only.`
    }
    if (
      name === 'read_file' ||
      name === 'edit_file' ||
      name === 'python_calculate' ||
      (name === 'write_file' && info)
    ) {
      const identity = await stat(path, { bigint: true })
      if (identity.ino.toString() !== info?.ino.toString())
        throw new Error('File changed while preparing approval.')
      scope.file = { ino: identity.ino.toString(), mtimeNs: identity.mtimeNs.toString() }
    }
    revalidate = async (): Promise<void> => {
      assertRun(run)
      if (
        (await workspacePath(
          String(args.path ?? '.'),
          writing,
          name === 'create_directory',
          name === 'read_file'
        )) !== path
      )
        throw new Error('File target changed.')
      const now = await stat(path, { bigint: true }).catch(() => null)
      if (
        info &&
        (!now ||
          now.ino !== info.ino ||
          now.dev !== info.dev ||
          now.mtimeMs !== info.mtimeMs ||
          (!['list_files', 'run_npm', 'run_command'].includes(name) && now.nlink !== 1n))
      )
        throw new Error('The approved file changed.')
      if (!info && now) throw new Error('The file now exists. Overwriting is blocked.')
      assertRun(run)
    }
  }
  if (name === 'web_search') details.provider = searchProviderLabel()
  if (['plugins_list', 'plugin_read', 'mcp_catalog', 'mcp_call', 'mcp_read'].includes(name)) {
    const { bindPluginAction } = await import('../plugins/tools')
    const binding = bindPluginAction(name, args)
    details.plugin = binding.preview
    revalidate = async (): Promise<void> => {
      assertRun(run)
      binding.revalidate()
    }
  }
  if (name === 'web_fetch')
    details.network = 'Public HTTPS GET; no cookies or scripts; up to three public redirects.'
  const heading =
    name === 'act_on_control'
      ? 'Use one inspected app control. Field replacement does not submit; activating a button may change the app or send information.\n\n'
      : name === 'inspect_app'
        ? 'Read visible controls and text in this app. Password controls are excluded.\n\n'
        : ''
  return { preview: heading + JSON.stringify(details, null, 2), revalidate, scope }
}
