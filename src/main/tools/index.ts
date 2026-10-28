import { toolSchemas } from './schemas'
import { getSettings } from '../settings'
import { wait } from './wait'
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
  moveWindow,
  rememberEditedWindow,
  type MoveArgs
} from './windows'
import { captureScreen, type CapturedScreen, type CaptureArgs } from './screen'
import { clickScreen, focusWindow, pressKeys, scrollWindow, typeText } from './interact'
import { inspectApp, actOnControl } from './automation/controls'
import { commandOutcome, toolOutcome, type ToolOutcome } from '../workflow/tool-outcome'
import { MUTATIONS } from '../workflow/results'
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
      const result = await actOnControl(parameters, run, scope)
      if (scope.window && scope.pid !== undefined) rememberEditedWindow(scope.window, scope.pid)
      return result
    }

    const result = await handler(parameters, scope)
    if (scope.window && scope.pid !== undefined && ['type_text', 'press_keys'].includes(name))
      rememberEditedWindow(scope.window, scope.pid)
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
