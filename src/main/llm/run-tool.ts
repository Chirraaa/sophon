import { executeTool } from '../tools'
import { requestApproval } from '../permissions'
import { authorizeTool } from '../security/policy'
import { currentRun, assertRun, consumeToolBudget } from '../security/run-manager'
import { validateToolArguments } from '../security/tool-contracts'
import { securityEvent } from '../security/audit'
import { bindLocalAction } from '../security/local-action'
import type { ChatEvent } from './types'
import { toolPermission } from '../permissions'
import { hideScreenGlow } from '../services/screen-glow'
import { allowApprovedTool, getSettings } from '../settings'
import { readHarnessProposal } from '../harness/store'
import { normalizeToolOutcome, toolOutcome, type ToolOutcome } from '../workflow/tool-outcome'
import { MUTATIONS } from '../workflow/results'
import { recordTiming } from '../workflow/timing'
import { addGrant, grantKey, hasGrant } from '../security/grants'

export type RunToolOptions = {
  // Approving this check also lets the same exact check re-run during this task.
  reusable?: boolean
  // Host-run verification probes draw on their own budget instead of the action budget.
  budget?: 'action' | 'probe'
}

const REUSE_NOTE =
  '\n\nApproving also lets Sophon re-run this exact check during this task without asking again. Any other command still asks.'

export async function runTool(
  name: string,
  args: unknown,
  actionId: string,
  onEvent?: (e: ChatEvent) => void,
  options: RunToolOptions = {}
): Promise<ToolOutcome> {
  const run = currentRun()
  hideScreenGlow()
  if (!run) return toolOutcome('denied', 'Denied: no active task.')
  let executing = false
  try {
    const parameters = validateToolArguments(name, args)
    authorizeTool(run, name)
    consumeToolBudget(run, name, options.budget)
    const bound = await bindLocalAction(name, parameters, run)
    const reviewProposal =
      name === 'harness_manage' &&
      parameters.action === 'compose' &&
      parameters.category !== 'script-tools'
    const proposal = reviewProposal
      ? readHarnessProposal(String(parameters.category), String(parameters.name))
      : undefined
    if (proposal !== undefined)
      bound.preview += '\n\nApprove this exact procedural candidate for trial use:\n' + proposal
    const reusable = options.reusable === true && !!grantKey(name, parameters)
    if (reusable) bound.preview += REUSE_NOTE
    onEvent?.({ type: 'tool_preview', id: actionId, preview: bound.preview })

    const fingerprint = JSON.stringify(parameters)
    const oneUse =
      [
        'run_npm',
        'run_command',
        'delete_file',
        'delete_directory',
        'mcp_call',
        'mcp_read',
        'notes_delete',
        'calendar_delete',
        'clear_chat'
      ].includes(name) || bound.scope?.oneUse === true
    const codingEdit = ['write_file', 'edit_file', 'create_directory'].includes(name)
    const codingMode = codingEdit ? (getSettings().coding?.mode ?? 'ask-before-edit') : undefined
    const needsApproval = codingEdit
      ? codingMode === 'ask-before-edit'
      : toolPermission(name) !== 'allow'
    // The user already approved this exact check earlier in this task.
    const granted = !codingEdit && !reviewProposal && hasGrant(run, name, parameters)
    if ((needsApproval || oneUse || reviewProposal) && !granted) {
      const canAlwaysAllow =
        !codingEdit && !oneUse && !reviewProposal && toolPermission(name) === 'ask'
      const approval = requestApproval(
        actionId,
        run.signal,
        canAlwaysAllow ? () => allowApprovedTool(name, run) : undefined
      )
      onEvent?.({ type: 'tool_wait', id: actionId, canAlwaysAllow })
      const waited = performance.now()
      const decision = await approval
      recordTiming(run, 'approval', performance.now() - waited)
      assertRun(run)
      onEvent?.({ type: 'tool_resume', id: actionId })
      if (decision === 'timeout' || decision === 'deny') {
        securityEvent('tool_denied', run.id, name)
        return toolOutcome(
          'denied',
          decision === 'timeout'
            ? 'Denied: no answer from the user in time.'
            : 'Denied by the user.'
        )
      }
      if (proposal !== undefined) bound.scope.approvedProposal = proposal
      if (reusable) addGrant(run, name, parameters)
    }
    authorizeTool(run, name)
    await bound.revalidate()
    if (JSON.stringify(parameters) !== fingerprint) throw new Error('Action arguments changed.')
    assertRun(run)
    securityEvent(granted ? 'tool_allowed_by_grant' : 'tool_allowed', run.id, name)
    executing = true
    const started = performance.now()
    let result: Awaited<ReturnType<typeof executeTool>>
    try {
      result = await executeTool(name, parameters, run, bound.scope, (output) =>
        onEvent?.({ type: 'tool_output', id: actionId, output })
      )
    } finally {
      recordTiming(run, 'tool', performance.now() - started)
    }
    return normalizeToolOutcome(name, parameters, result)
  } catch (error) {
    assertRun(run)
    const message = (error as Error).message
    if (
      executing &&
      name === 'edit_file' &&
      !run.signal.aborted &&
      (error as NodeJS.ErrnoException).code === 'PATCH_NOT_APPLIED'
    ) {
      assertRun(run)
      securityEvent('tool_failed', run.id, name)
      return toolOutcome(
        'failed',
        'Patch not applied: no file was changed. Read the current file and copy a short unique old_text exactly, preserving JSON escaping and whitespace. ' +
          message,
        { code: 'patch-not-applied', execution: 'not-started' }
      )
    }
    if (
      !executing &&
      !run.signal.aborted &&
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      [
        'list_files',
        'read_file',
        'write_file',
        'edit_file',
        'create_directory',
        'run_npm',
        'run_command'
      ].includes(name)
    ) {
      assertRun(run)
      securityEvent('tool_failed', run.id, name)
      return toolOutcome(
        'failed',
        'Missing workspace path: no action was executed. Inspect the intended parent folder and create missing project folders with create_directory before writing. ' +
          message,
        { code: 'workspace-missing', execution: 'not-started' }
      )
    }
    if (
      !executing &&
      !run.signal.aborted &&
      ['TARGET_NOT_FOUND', 'SCREENSHOT_REQUIRED'].includes(
        String((error as NodeJS.ErrnoException).code)
      )
    ) {
      assertRun(run)
      securityEvent('tool_failed', run.id, name)
      return toolOutcome('failed', message, {
        execution: 'not-started',
        code:
          (error as NodeJS.ErrnoException).code === 'TARGET_NOT_FOUND'
            ? 'target-missing'
            : 'screenshot-required'
      })
    }
    if (
      executing &&
      !run.signal.aborted &&
      ['web_search', 'web_fetch'].includes(name) &&
      (/^(Exa search |DuckDuckGo |Website returned HTTP |Service returned HTTP |Could not connect to |Request stopped or timed out|DNS lookup cancelled|Page exceeds |Invalid or oversized PDF|PDF exceeds|PDF preview exceeds|PDF text exceeds|Parser exceeded|Compressed web responses|This page uses an unsupported text encoding|Only HTML|Add a Brave Search API key)/.test(
        message
      ) ||
        ['ENOTFOUND', 'EAI_AGAIN'].includes(String((error as NodeJS.ErrnoException).code)))
    ) {
      assertRun(run)
      if (name === 'web_search') run.searchUnavailable = true
      securityEvent('tool_failed', run.id, name)
      return toolOutcome('failed', `Web unavailable: ${message}`, { code: 'web-unavailable' })
    }
    securityEvent(executing ? 'tool_failed' : 'tool_denied', run.id, name)
    if (!executing) return toolOutcome('denied', `Denied: ${message}`)
    return toolOutcome(MUTATIONS.has(name) ? 'uncertain' : 'failed', `Tool error: ${message}`, {
      execution: 'unknown',
      code: name === 'act_on_control' ? 'control-uncertain' : 'execution-error'
    })
  }
}

// One approval card for a set of exact verification checks (a contract's probes). Each
// entry passes policy first; on approval each becomes a grant for the rest of this task.
export async function approveChecks(
  actionId: string,
  checks: { name: string; args: Record<string, unknown> }[],
  preview: string,
  onEvent?: (e: ChatEvent) => void
): Promise<boolean> {
  const run = currentRun()
  if (!run) return false
  const pending = checks.filter((check) => !hasGrant(run, check.name, check.args))
  if (!pending.length) return true
  for (const check of pending) {
    authorizeTool(run, check.name)
    if (!grantKey(check.name, validateToolArguments(check.name, check.args)))
      throw new Error('Only verification checks can be approved for reuse.')
  }
  onEvent?.({ type: 'tool_preview', id: actionId, preview })
  const approval = requestApproval(actionId, run.signal)
  onEvent?.({ type: 'tool_wait', id: actionId, canAlwaysAllow: false })
  const waited = performance.now()
  const decision = await approval
  recordTiming(run, 'approval', performance.now() - waited)
  assertRun(run)
  onEvent?.({ type: 'tool_resume', id: actionId })
  if (decision !== 'once' && decision !== 'always') {
    securityEvent('tool_denied', run.id, 'run_command')
    return false
  }
  for (const check of pending) addGrant(run, check.name, check.args)
  securityEvent('tool_allowed', run.id, 'run_command')
  return true
}
