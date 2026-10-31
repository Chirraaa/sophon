import { assessResult, MUTATIONS } from './results'

export type OutcomeCode =
  | 'ok'
  | 'denied'
  | 'execution-error'
  | 'unverified'
  | 'control-uncertain'
  | 'target-missing'
  | 'screenshot-required'
  | 'workspace-missing'
  | 'patch-not-applied'
  | 'web-unavailable'
  // Another agent is using the target window; nothing was sent.
  | 'window-busy'

export type ToolOutcome = Readonly<{
  kind: 'tool-outcome'
  status: Exclude<EvidenceStatus, 'pending'>
  execution: 'not-started' | 'completed' | 'unknown'
  code: OutcomeCode
  text: string
  summary: string
  image?: string
  // Shown to the user only; the model already has this picture.
  shownImage?: string
  command?: Readonly<{ exitCode: number | null; stopped: boolean; running: boolean }>
  observation?: Readonly<{ id: string; windowRef: string; expiresAt: number; controls: number }>
}>

export type LegacyToolResult = string | { text: string; image: string; display?: boolean }

export function toolOutcome(
  status: ToolOutcome['status'],
  text: string,
  details: Partial<Omit<ToolOutcome, 'kind' | 'status' | 'text'>> = {}
): ToolOutcome {
  return Object.freeze({
    kind: 'tool-outcome',
    status,
    text,
    summary: text.slice(0, 240),
    execution:
      status === 'denied' ? 'not-started' : status === 'uncertain' ? 'unknown' : 'completed',
    code:
      status === 'denied'
        ? 'denied'
        : status === 'uncertain'
          ? 'unverified'
          : status === 'failed'
            ? 'execution-error'
            : 'ok',
    ...details
  })
}

// Compatibility boundary for tools not yet migrated to native structured results.
// Never parse a model/server JSON payload as a ToolOutcome. Only host code may
// construct the object. Consumers use its fields, never the display wording.
export function normalizeToolOutcome(
  tool: string,
  args: Record<string, unknown>,
  result: ToolOutcome | LegacyToolResult
): ToolOutcome {
  if (typeof result !== 'string' && 'kind' in result && result.kind === 'tool-outcome')
    return result
  const legacy = result as LegacyToolResult
  const text = typeof legacy === 'string' ? legacy : legacy.text
  const assessment = assessResult(tool, args, legacy)
  const code: OutcomeCode = text.startsWith('Target not found:')
    ? 'target-missing'
    : text.startsWith('Screenshot required:')
      ? 'screenshot-required'
      : text.startsWith('Missing workspace path:')
        ? 'workspace-missing'
        : text.startsWith('Patch not applied:')
          ? 'patch-not-applied'
          : text.startsWith('Web unavailable:')
            ? 'web-unavailable'
            : assessment.status === 'denied'
              ? 'denied'
              : assessment.status === 'uncertain'
                ? tool === 'act_on_control'
                  ? 'control-uncertain'
                  : 'unverified'
                : assessment.status === 'failed'
                  ? 'execution-error'
                  : 'ok'
  const notStarted = [
    'denied',
    'target-missing',
    'screenshot-required',
    'workspace-missing',
    'patch-not-applied'
  ].includes(code)
  let command: ToolOutcome['command']
  if (['run_npm', 'run_command'].includes(tool)) {
    try {
      const data = JSON.parse(text)
      command = Object.freeze({
        exitCode: Number.isInteger(data.exitCode) ? data.exitCode : null,
        stopped: data.stopped !== false,
        running: data.running === true
      })
    } catch {
      /* Unknown command output cannot verify a check. */
    }
  }
  return toolOutcome(assessment.status as ToolOutcome['status'], text, {
    summary: assessment.summary,
    code,
    execution: notStarted
      ? 'not-started'
      : ['uncertain', 'failed'].includes(assessment.status) && MUTATIONS.has(tool)
        ? 'unknown'
        : 'completed',
    ...(typeof legacy === 'string'
      ? {}
      : legacy.display
        ? { shownImage: legacy.image }
        : { image: legacy.image }),
    ...(command ? { command } : {})
  })
}

export function commandOutcome(text: string, stopping = false): ToolOutcome {
  const result = JSON.parse(text)
  const command = Object.freeze({
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    stopped: result.stopped !== false,
    running: result.running === true
  })
  if (stopping && result.stopped === true && result.running === false && result.verified === true)
    return toolOutcome('verified', text, { command, summary: 'Observed the managed process exit.' })
  if (command.running && !command.stopped)
    return toolOutcome('reported', text, {
      command,
      summary: 'Command is still running; checks are separate.'
    })
  if (command.stopped || command.exitCode === null)
    return toolOutcome('uncertain', text, {
      command,
      summary: 'Command did not complete; partial changes may have occurred.'
    })
  return toolOutcome(command.exitCode === 0 ? 'verified' : 'reported', text, {
    command,
    summary: `Command exited with code ${command.exitCode}; this establishes only its exit result.`
  })
}
