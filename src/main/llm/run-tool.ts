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
export async function runTool(
  name: string,
  args: unknown,
  actionId: string,
  onEvent?: (e: ChatEvent) => void
): Promise<ToolOutcome> {
  const run = currentRun()
  hideScreenGlow()
  if (!run) return toolOutcome('denied', 'Denied: no active task.')
  let executing = false
  try {
    const parameters = validateToolArguments(name, args)
    authorizeTool(run, name)
    consumeToolBudget(run, name)
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
    onEvent?.({ type: 'tool_preview', id: actionId, preview: bound.preview })

    const fingerprint = JSON.stringify(parameters)
    const oneUse = [
      'run_npm',
      'run_command',
      'delete_file',
      'delete_directory',
      'mcp_call',
      'mcp_read',
      'notes_delete',
      'clear_chat'
    ].includes(name)
    const codingEdit = ['write_file', 'edit_file', 'create_directory'].includes(name)
    const codingMode = codingEdit ? (getSettings().coding?.mode ?? 'ask-before-edit') : undefined
    const needsApproval = codingEdit
      ? codingMode === 'ask-before-edit'
      : toolPermission(name) !== 'allow'
    if (needsApproval || oneUse || reviewProposal) {
      const canAlwaysAllow =
        !codingEdit && !oneUse && !reviewProposal && toolPermission(name) === 'ask'
      const approval = requestApproval(
        actionId,
        run.signal,
        canAlwaysAllow ? () => allowApprovedTool(name, run) : undefined
      )
      onEvent?.({ type: 'tool_wait', id: actionId, canAlwaysAllow })
      const decision = await approval
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
    }
    authorizeTool(run, name)
    await bound.revalidate()
    if (JSON.stringify(parameters) !== fingerprint) throw new Error('Action arguments changed.')
    assertRun(run)
    securityEvent('tool_allowed', run.id, name)
    executing = true
    const result = await executeTool(name, parameters, run, bound.scope, (output) =>
      onEvent?.({ type: 'tool_output', id: actionId, output })
    )
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
