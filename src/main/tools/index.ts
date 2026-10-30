import { toolSchemas } from './schemas'
import { getSettings } from '../settings'
import { wait } from './wait'
import { requestChatClear } from '../chat/clear-request'
import {
  manageHarness,
  readHarness,
  scriptExpression,
  recordHarnessUse,
  harnessLifecycle
} from '../harness/store'
import { pythonExpression } from '../harness/python'
import {
  listFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  readWorkspaceCsv,
  createWorkspaceDirectory,
  editWorkspaceFile,
  deleteWorkspaceEntry
} from './files'
import { runNpm } from './npm'
import { runCommand } from './command'
import { toolPermission } from '../permissions'
import { canUseTool, authorizeTool } from '../security/policy'
import { currentRun, assertRun, type RunContext } from '../security/run-manager'
import { validateToolArguments } from '../security/tool-contracts'
import { webSearch } from '../network/search-provider'
import { webFetch } from '../network/public-page'
import type { ExecutionScope } from '../security/local-action'
import { openApp } from './openApp'
import { listApps } from './app-catalog'
import {
  closeApp,
  closeWindow,
  listWindowsText,
  listWindows,
  moveWindow,
  rememberEditedWindow,
  type MoveArgs
} from './windows'
import {
  captureScreen,
  invalidateScreenCoordinates,
  markCapture,
  type CapturedScreen,
  type CaptureArgs
} from './screen'
import { clickScreen, focusWindow, pressKeys, scrollWindow, typeText } from './interact'
import { inspectApp, actOnControl, observationBounds } from './automation/controls'
import { commandOutcome, toolOutcome, type ToolOutcome } from '../workflow/tool-outcome'
import { MUTATIONS, resultFailure } from '../workflow/results'
export const activeToolSchemas = (): typeof toolSchemas =>
  toolSchemas.filter(
    (t) =>
      (t.function.name !== 'harness_manage' || getSettings().memory?.enabled === true) &&
      toolPermission(t.function.name) !== 'block' &&
      canUseTool(currentRun(), t.function.name)
  )
const handlers: Record<
  string,
  (
    args: Record<string, unknown>,
    scope: ExecutionScope
  ) => Promise<string | CapturedScreen | ToolOutcome> | string
> = {
  open_app: (a, scope) => openApp(a.name as string, scope.app),
  list_apps: (a) => listApps(a.query as string | undefined),
  list_windows: () => listWindowsText(),
  move_window: (a, scope) => moveWindow(a as MoveArgs, scope.guard, scope.window),
  look_at_screen: (a, scope) => captureScreen(a as CaptureArgs, scope.guard, scope.window),
  focus_window: (a, scope) => focusWindow(a.title as string | undefined, scope.guard, scope.window),
  close_window: (a, scope) => closeWindow(a.title as string | undefined, scope.window),
  close_app: (a, scope) => closeApp(a.name as string, scope.windows),
  click: (a, scope) =>
    clickScreen(a as Parameters<typeof clickScreen>[0], scope.guard, scope.window),
  scroll: (a, scope) =>
    scrollWindow(a as Parameters<typeof scrollWindow>[0], scope.guard, scope.window),
  press_keys: (a, scope) =>
    pressKeys(a as Parameters<typeof pressKeys>[0], scope.guard, scope.window),
  type_text: (a, scope) => typeText(a as Parameters<typeof typeText>[0], scope.guard, scope.window),
  list_files: (a) => listFiles(a as Parameters<typeof listFiles>[0]),
  read_file: (a, scope) =>
    readWorkspaceFile(a as Parameters<typeof readWorkspaceFile>[0], scope.file),
  create_directory: (a) => createWorkspaceDirectory(a as { path: string }),
  delete_file: (a, scope) => deleteWorkspaceEntry(a as { path: string }, false, scope.deletion),
  delete_directory: (a, scope) =>
    deleteWorkspaceEntry(a as { path: string; recursive?: boolean }, true, scope.deletion),
  edit_file: (a, scope) =>
    editWorkspaceFile(a as Parameters<typeof editWorkspaceFile>[0], scope.file),
  write_file: (a, scope) =>
    writeWorkspaceFile(a as Parameters<typeof writeWorkspaceFile>[0], scope.file)
}
export async function executeTool(
  name: string,
  args: unknown,
  run: RunContext,
  scope: ExecutionScope = {},
  onOutput?: (output: string) => void
): Promise<string | CapturedScreen | ToolOutcome> {
  authorizeTool(run, name)
  const parameters = validateToolArguments(name, args)
  if (['browser_open', 'browser_tabs', 'browser_inspect', 'browser_act'].includes(name)) {
    const { executeBrowserTool } = await import('./browser/runtime')
    assertRun(run)
    return await executeBrowserTool(name, parameters, run)
  }
  if (['list_audio', 'list_radios', 'set_volume', 'set_radio'].includes(name)) {
    try {
      const { listAudio, listRadios, setDevice } = await import('./system-control')
      assertRun(run)
      if (name === 'list_audio') return await listAudio(run)
      if (name === 'list_radios') return await listRadios(run)
      return await setDevice(parameters, scope.device, run)
    } catch (error) {
      assertRun(run)
      return toolOutcome(
        MUTATIONS.has(name) ? 'uncertain' : 'failed',
        `Tool error: ${(error as Error).message}`,
        { execution: 'unknown' }
      )
    }
  }
  if (name.startsWith('calendar_')) {
    const { executeCalendarTool } = await import('./calendar')
    assertRun(run)
    return await executeCalendarTool(name, scope.calendar, run)
  }
  if (name.startsWith('notes_')) {
    const { executeNotesTool } = await import('./notes')
    assertRun(run)
    return executeNotesTool(name, parameters)
  }
  if (name === 'run_npm')
    return commandOutcome(
      await runNpm(parameters as { path?: string; args: string[] }, run, onOutput),
      parameters.action === 'stop'
    )
  if (name === 'run_command')
    return commandOutcome(
      await runCommand(parameters as Parameters<typeof runCommand>[0], run, onOutput),
      parameters.action === 'stop'
    )
  if (['plugins_list', 'plugin_read', 'mcp_catalog', 'mcp_call', 'mcp_read'].includes(name)) {
    const { executePluginTool } = await import('../plugins/tools')
    assertRun(run)
    return await executePluginTool(name, parameters, run)
  }
  if (name === 'clear_chat') return requestChatClear()
  if (name === 'wait') return await wait(Number(parameters.seconds), run)
  if (name === 'harness_manage') {
    if (!getSettings().memory.enabled)
      throw new Error('Procedural memory is disabled in Settings > Memory.')
    try {
      return await manageHarness(parameters, run.signal, scope.approvedProposal)
    } catch (error) {
      assertRun(run)
      if (parameters.action === 'probe')
        return (
          'Probe did not pass: ' +
          (error as Error).message +
          ' Revise the proposal before composing.'
        )
      throw error
    }
  }
  if (name === 'python_calculate') {
    if (parameters.recipe && parameters.expression)
      throw new Error('Use an expression or a recipe, not both.')
    if (parameters.recipe && !getSettings().memory.enabled)
      throw new Error('Procedural memory is disabled.')
    const recipeVersion = parameters.recipe
      ? harnessLifecycle('script-tools', String(parameters.recipe)).version
      : undefined
    const expression = parameters.recipe
      ? scriptExpression(readHarness('script-tools', String(parameters.recipe), true))
      : String(parameters.expression ?? '')
    if (!expression.trim()) throw new Error('Supply a Python expression or recipe.')
    if (parameters.path && parameters.content)
      throw new Error('Supply a CSV path or inline content, not both.')
    const csv = parameters.path
      ? await readWorkspaceCsv(String(parameters.path), scope.file)
      : String(parameters.content ?? '')
    try {
      const result = await pythonExpression(expression, csv, run.signal)
      if (parameters.recipe)
        recordHarnessUse(
          'script-tools',
          String(parameters.recipe),
          run.id,
          true,
          'The saved expression executed successfully under the bounded Python worker; numerical correctness still depends on inputs.',
          recipeVersion
        )
      return result
    } catch (error) {
      if (parameters.recipe && !run.signal.aborted)
        recordHarnessUse(
          'script-tools',
          String(parameters.recipe),
          run.id,
          false,
          'Saved expression execution failed.',
          recipeVersion
        )
      throw error
    }
  }
  if (name === 'web_search') return JSON.stringify(await webSearch(String(parameters.query), run))
  if (name === 'web_fetch') return JSON.stringify(await webFetch(String(parameters.url), run))
  const handler = handlers[name]
  if (!handler && name !== 'inspect_app' && name !== 'act_on_control')
    return toolOutcome('failed', `Unknown tool: ${name}`, { execution: 'not-started' })
  try {
    assertRun(run)
    scope.guard?.()
    if (name === 'inspect_app') return await inspectApp(parameters, run, scope)
    if (name === 'act_on_control') {
      invalidateScreenCoordinates()
      const result = await actOnControl(parameters, run, scope)
      if (scope.window && scope.pid !== undefined) rememberEditedWindow(scope.window, scope.pid)
      if (
        parameters.readback_query !== undefined &&
        ['verified', 'reported'].includes(result.status)
      ) {
        if (toolPermission('inspect_app') !== 'allow' || !canUseTool(run, 'inspect_app'))
          return toolOutcome(
            result.status,
            result.text +
              '\nAutomatic read-back was skipped: inspect_app requires its own permission.',
            { summary: result.summary }
          )
        try {
          // The accessibility worker answers in tens of milliseconds; give the app
          // a moment to apply the action before reading it back.
          await wait(0.25, run)
          scope.guard?.()
          const window = listWindows().find((win) => win.hwnd === scope.window?.hwnd)
          if (!window) throw new Error('Original window closed.')
          const readback = await inspectApp({ query: parameters.readback_query }, run, {
            ...scope,
            window
          })
          assertRun(run)
          return toolOutcome(
            result.status,
            result.text +
              '\nFresh app evidence follows. Assess the requested effect; do not repeat inspection when this evidence is sufficient.\n' +
              readback.text,
            {
              summary: result.summary,
              ...(readback.status === 'observed' ? { observation: readback.observation } : {})
            }
          )
        } catch {
          assertRun(run)
          return toolOutcome(
            result.status,
            result.text +
              '\nFresh read-back was unavailable. Inspect the original app before continuing; do not repeat the action.',
            { summary: result.summary }
          )
        }
      }
      return result
    }

    if (['move_window', 'close_window', 'close_app'].includes(name)) invalidateScreenCoordinates()
    const result = await handler(parameters, scope)
    if (scope.window && scope.pid !== undefined && ['type_text', 'press_keys'].includes(name))
      rememberEditedWindow(scope.window, scope.pid)
    if (name === 'look_at_screen' && parameters.marks === true && typeof result !== 'string') {
      const captured = result as CapturedScreen
      if (toolPermission('inspect_app') !== 'allow' || !canUseTool(run, 'inspect_app'))
        return {
          ...captured,
          text:
            captured.text +
            '\nMarks were skipped: they read app controls, which requires inspect_app to be Always allow.'
        }
      try {
        scope.guard?.()
        const window = listWindows().find((win) => win.hwnd === scope.window?.hwnd)
        if (!window) throw new Error('Original window closed.')
        const inspected = await inspectApp({}, run, { ...scope, window })
        assertRun(run)
        const marked =
          inspected.status === 'observed' && inspected.observation
            ? markCapture(observationBounds(inspected.observation.id))
            : null
        if (!marked?.labels.length)
          return toolOutcome(
            'observed',
            captured.text +
              '\nNo accessible controls could be marked in this window; choose click coordinates from the image.\n' +
              inspected.text,
            { image: captured.image }
          )
        return toolOutcome(
          'observed',
          captured.text +
            `\nNumbered marks are drawn on ${marked.labels.length} controls. Mark N is control cN in the observation below: prefer act_on_control with that reference, or click with {"mark": N} for its centre. Unmarked areas still take x,y coordinates.\n` +
            inspected.text,
          { image: marked.image, observation: inspected.observation }
        )
      } catch {
        assertRun(run)
        return {
          ...captured,
          text: captured.text + '\nMarks were unavailable; choose click coordinates from the image.'
        }
      }
    }
    if (
      name === 'click' &&
      parameters.capture_after === true &&
      typeof result === 'string' &&
      !resultFailure(result)
    ) {
      if (toolPermission('look_at_screen') !== 'allow' || !canUseTool(run, 'look_at_screen'))
        return toolOutcome(
          'reported',
          result +
            '\nAutomatic capture skipped: look_at_screen requires its own permission. Inspect the requested effect separately.'
        )
      try {
        scope.guard?.()
        const window = listWindows().find((win) => win.hwnd === scope.window?.hwnd)
        if (!window) throw new Error('Original window closed.')
        const captured = await captureScreen(
          { region: parameters.readback_region as CaptureArgs['region'] },
          scope.guard,
          window
        )
        assertRun(run)
        return toolOutcome(
          'reported',
          result +
            '\nInput acceptance is not proof of success. Post-action observation:\n' +
            (typeof captured === 'string' ? captured : captured.text),
          typeof captured === 'string' ? {} : { image: captured.image }
        )
      } catch {
        assertRun(run)
        return toolOutcome(
          'reported',
          result +
            '\nPost-action capture was unavailable. Inspect the original app before continuing; do not repeat the click.'
        )
      }
    }
    return result
  } catch (e) {
    assertRun(run)
    if ((e as NodeJS.ErrnoException).code === 'PATCH_NOT_APPLIED') throw e
    return toolOutcome(
      MUTATIONS.has(name) ? 'uncertain' : 'failed',
      `Tool error: ${(e as Error).message}`,
      { execution: 'unknown' }
    )
  }
}
