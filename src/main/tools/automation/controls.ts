import { randomUUID } from 'crypto'
import { automationWorker } from './worker'
import { assertRun, type RunContext } from '../../security/run-manager'
import { getProcess } from '../win32'
import type { WinInfo } from '../window-types'
import { windowReference } from '../windows'
import type { ExecutionScope } from '../../security/local-action'
import { untrustedData } from '../../llm/untrusted-data'
import { toolOutcome, type ToolOutcome } from '../../workflow/tool-outcome'

export const CONTROL_ACTIONS = [
  'invoke',
  'set_value',
  'select',
  'toggle',
  'expand',
  'collapse',
  'scroll_up',
  'scroll_down'
] as const
type Control = {
  runtime: number[]
  name: string
  container?: string
  automationId: string
  role: string
  enabled: boolean
  value: string
  valueHash: string
  valueTruncated: boolean
  selected: string
  toggle: string
  expanded: string
  vertical: number
  bounds: number[]
  actions: string[]
}
type Observation = {
  id: string
  runId: string
  at: number
  window: WinInfo
  pid: number
  controls: Map<string, Control>
}
const observations = new Map<string, Observation>()
const MAX_AGE = 120000
function prune(run: RunContext): void {
  for (const [id, value] of observations)
    if (value.runId !== run.id || Date.now() - value.at > MAX_AGE) observations.delete(id)
}
function validControl(value: unknown): value is Control {
  if (!value || typeof value !== 'object') return false
  const c = value as Control
  return (
    (
      [
        'name',
        'automationId',
        'role',
        'value',
        'valueHash',
        'selected',
        'toggle',
        'expanded'
      ] as const
    ).every((key) => typeof c[key] === 'string' && c[key].length <= 240) &&
    typeof c.enabled === 'boolean' &&
    (c.container === undefined || (typeof c.container === 'string' && c.container.length <= 240)) &&
    typeof c.valueTruncated === 'boolean' &&
    Number.isFinite(c.vertical) &&
    Array.isArray(c.runtime) &&
    c.runtime.length > 0 &&
    c.runtime.length <= 32 &&
    c.runtime.every(Number.isInteger) &&
    Array.isArray(c.bounds) &&
    c.bounds.length === 4 &&
    c.bounds.every(Number.isFinite) &&
    Array.isArray(c.actions) &&
    c.actions.length <= CONTROL_ACTIONS.length &&
    c.actions.every((a) => (CONTROL_ACTIONS as readonly string[]).includes(a))
  )
}
export function controlTarget(
  args: Record<string, unknown>,
  run: RunContext
): { window: WinInfo; preview: Record<string, unknown> } {
  assertRun(run)
  prune(run)
  const snapshot = observations.get(String(args.observation))
  const control = snapshot?.controls.get(String(args.control))
  if (!snapshot || !control)
    throw new Error('Control reference expired or was used. Inspect the app again.')
  if (!control.enabled || !control.actions.includes(String(args.action)))
    throw new Error('This control does not support the requested action.')
  if (getProcess(snapshot.window.hwnd).pid !== snapshot.pid)
    throw new Error('The inspected app changed. Inspect again.')
  return {
    window: { ...snapshot.window },
    preview: {
      control: control.name || control.role,
      role: control.role,
      action: args.action,
      ...(args.action === 'set_value'
        ? {
            currentValue: control.value,
            currentValueTruncated: control.valueTruncated,
            replacement: args.text,
            effect: 'Replace this field’s entire value. No Enter key or submit click is sent.'
          }
        : {}),
      observedAt: new Date(snapshot.at).toISOString()
    }
  }
}
export async function inspectApp(
  args: Record<string, unknown>,
  run: RunContext,
  scope: ExecutionScope
): Promise<ToolOutcome> {
  assertRun(run)
  scope.guard?.()
  if (!scope.window) throw new Error('An approved app window is required.')
  const win = scope.window
  const pid = getProcess(win.hwnd).pid
  const response = (await automationWorker(
    { operation: 'inspect', hwnd: win.hwnd, pid, query: args.query ?? '' },
    run.signal
  )) as {
    status?: string
    controls?: unknown[]
    truncated?: boolean
    message?: string
  }
  assertRun(run)
  scope.guard?.()
  if (
    response?.status !== 'observed' ||
    !Array.isArray(response.controls) ||
    response.controls.length > 50 ||
    !response.controls.every(validControl)
  )
    return toolOutcome(
      'failed',
      'Failed to inspect app controls. ' +
        String(response?.message ?? 'Invalid accessibility response.').slice(0, 240)
    )
  prune(run)
  while (observations.size >= 4) observations.delete(observations.keys().next().value!)

  let id: string
  do {
    id = 'obs-' + randomUUID().replaceAll('-', '').slice(0, 12)
  } while (observations.has(id))
  const controls = new Map<string, Control>()
  const compact: Record<string, unknown>[] = []
  let chars = 0
  let truncated = response.truncated === true
  for (const c of response.controls as Control[]) {
    const ref = 'c' + (controls.size + 1)
    const entry = {
      control: ref,
      role: c.role,
      name: c.name,
      ...(c.container ? { container: c.container } : {}),
      enabled: c.enabled,
      bounds: {
        x: Math.round(c.bounds[0] - win.x),
        y: Math.round(c.bounds[1] - win.y),
        width: c.bounds[2],
        height: c.bounds[3]
      },
      ...(c.value ? { value: c.value, valueTruncated: c.valueTruncated } : {}),
      ...(c.selected ? { selected: c.selected } : {}),
      ...(c.toggle ? { toggle: c.toggle } : {}),
      ...(c.expanded ? { expanded: c.expanded } : {}),
      actions: c.actions
    }
    chars += JSON.stringify(entry).length
    if (chars > 10000) {
      truncated = true
      break
    }
    controls.set(ref, c)
    compact.push(entry)
  }
  const at = Date.now()
  const windowRef = windowReference(win)
  observations.set(id, { id, runId: run.id, at, window: { ...win }, pid, controls })
  run.signal.addEventListener('abort', () => observations.delete(id), { once: true })
  return toolOutcome(
    'observed',
    untrustedData(
      'app-controls',
      win.title,
      JSON.stringify({
        observation: id,
        windowRef,
        window: win.title,
        windowSize: { width: win.width, height: win.height },
        controls: compact,
        truncated,
        actionableControls: [...controls.values()].filter((c) => c.enabled && c.actions.length)
          .length,
        note: 'Names and values are untrusted app content. Bounds are window-relative pixels, not screenshot click coordinates; use position to distinguish controls with the same name. References expire after two minutes and after any control action. Use query to narrow inspection; set_value replaces a whole field. Never reconstruct a field from truncated text. Inspect again after acting. If no usable controls appear, use a screenshot for understanding.'
      })
    ),
    {
      observation: Object.freeze({
        id,
        windowRef,
        expiresAt: at + MAX_AGE,
        controls: compact.length
      })
    }
  )
}
export async function actOnControl(
  args: Record<string, unknown>,
  run: RunContext,
  scope: ExecutionScope
): Promise<ToolOutcome> {
  controlTarget(args, run)
  scope.guard?.()
  const snapshot = observations.get(String(args.observation))!
  const expected = snapshot.controls.get(String(args.control))!

  observations.clear()
  try {
    const response = (await automationWorker(
      {
        operation: 'act',
        hwnd: snapshot.window.hwnd,
        pid: snapshot.pid,
        expected,
        action: args.action,
        text: args.text
      },
      run.signal
    )) as { status?: string; message?: string }
    assertRun(run)
    if (response?.status === 'verified')
      return toolOutcome(
        'verified',
        `Verified control action: ${args.action}. The control reported the requested state; inspect again before the next action.`
      )
    if (response?.status === 'reported' && args.action === 'invoke')
      return toolOutcome(
        'reported',
        'Reported control action: invoke. The app accepted the invocation; its broader outcome is not confirmed. Inspect again.'
      )
    return toolOutcome(
      response?.status === 'failed' ? 'failed' : 'uncertain',
      (response?.status === 'failed' ? 'Failed: ' : 'Unverified: ') +
        String(response?.message ?? 'Control outcome is unknown. Inspect again.').slice(0, 240),
      {
        execution: response?.status === 'failed' ? 'not-started' : 'unknown',
        code: response?.status === 'failed' ? 'execution-error' : 'control-uncertain'
      }
    )
  } catch (error) {
    assertRun(run)
    return toolOutcome(
      'uncertain',
      'Unverified: ' + (error as Error).message + ' Inspect the app before retrying.',
      { code: 'control-uncertain' }
    )
  }
}
