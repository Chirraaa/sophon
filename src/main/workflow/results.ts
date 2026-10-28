export const MUTATIONS = new Set([
  'browser_open',
  'browser_act',
  'mcp_call',
  'set_volume',
  'set_radio',
  'notes_create',
  'notes_edit',
  'notes_delete',
  'act_on_control',
  'open_app',
  'move_window',
  'focus_window',
  'close_window',
  'write_file',
  'edit_file',
  'create_directory',
  'delete_file',
  'delete_directory',
  'run_npm',
  'run_command',
  'close_app',
  'click',
  'scroll',
  'press_keys',
  'type_text'
])
export function resultFailure(text: string): 'denied' | 'failed' | 'uncertain' | undefined {
  if (text.startsWith('Patch not applied:')) return 'failed'
  if (/^(denied\b|blocked\b)/i.test(text.trim())) return 'denied'
  if (/^(unverified\b|verification failed\b)/i.test(text.trim())) return 'uncertain'
  if (
    /^(screenshot required:|target not found:|web unavailable:|no (?:window|open app|app window)\b|could not\b|failed\b|unknown\b|tool error\b|tool ".*" timed out|missing\b|invalid\b|provide\b|windows (?:refused|could not|stopped)\b)/i.test(
      text.trim()
    )
  )
    return 'failed'
  return undefined
}
export function assessResult(
  tool: string,
  args: Record<string, unknown>,
  result: string | { text: string; image: string }
): { status: EvidenceStatus; summary: string } {
  const text = typeof result === 'string' ? result : result.text
  const failed = resultFailure(text)
  if (failed) return { status: failed, summary: text.slice(0, 240) }
  if (tool === 'mcp_call') {
    try {
      const envelope = JSON.parse(text)
      if (envelope.kind === 'mcp-result' && envelope.trust === 'untrusted-data')
        return {
          status: 'reported',
          summary:
            'MCP server returned a result. Inspect its content and verify any external change before claiming completion.'
        }
    } catch {
      /* Unrecognized MCP output remains uncertain. */
    }
  }
  if (tool === 'set_volume' || tool === 'set_radio') {
    try {
      const state = JSON.parse(text)
      const confirmed =
        state.verified === true &&
        (tool === 'set_volume'
          ? (args.volume === undefined ||
              (typeof state.volume === 'number' &&
                Math.abs(state.volume - Number(args.volume)) <= 1)) &&
            (args.muted === undefined || state.muted === args.muted)
          : state.state === (args.enabled ? 'On' : 'Off'))
      return {
        status: confirmed ? 'verified' : 'uncertain',
        summary: confirmed
          ? 'Read back the requested Windows device setting after the change.'
          : 'Windows did not confirm the requested device setting. Inspect before retrying.'
      }
    } catch {
      return { status: 'uncertain', summary: text.slice(0, 240) }
    }
  }
  if (tool === 'notes_create' || tool === 'notes_edit' || tool === 'notes_delete') {
    try {
      const change = JSON.parse(text)
      const confirmed = change.kind === 'note-change' && change.verified === true
      return {
        status: confirmed ? 'verified' : 'uncertain',
        summary: confirmed
          ? 'Read the note store back after the change.'
          : 'The note store did not confirm the change. Read the note again before retrying.'
      }
    } catch {
      return { status: 'uncertain', summary: text.slice(0, 240) }
    }
  }
  if (tool === 'run_npm' || tool === 'run_command') {
    try {
      const command = JSON.parse(text)
      if (
        args.action === 'stop' &&
        command.action === 'stop' &&
        command.stopped === true &&
        command.running === false &&
        command.verified === true
      )
        return {
          status: 'verified',
          summary: 'Stopped the Sophon-managed server and observed its process exit.'
        }
      if (command.running === true && command.stopped === false && typeof command.url === 'string')
        return {
          status: 'reported',
          summary: `Dev server running at ${command.url}. Project checks are separate.`
        }
      if (command.stopped)
        return {
          status: 'uncertain',
          summary: 'Command stopped or timed out; inspect partial changes before retrying.'
        }
      if (Number.isInteger(command.exitCode))
        return {
          status: command.exitCode === 0 ? 'verified' : 'reported',
          summary:
            command.exitCode === 0
              ? 'Command exited successfully; this verifies the command, not all project requirements.'
              : `Command exited with code ${command.exitCode}. Inspect diagnostics and current state before a corrected command; do not claim checks passed.`
        }
    } catch {
      /* Unrecognized results remain uncertain below. */
    }
  }
  if (tool === 'create_directory' && text === `Created folder ${args.path}.`)
    return { status: 'verified', summary: 'Created and checked the project folder.' }
  if (
    (tool === 'delete_file' || tool === 'delete_directory') &&
    text ===
      `Deleted ${tool === 'delete_file' ? 'file' : 'folder'} ${args.path}. Verified path is absent.`
  )
    return { status: 'verified', summary: 'Deleted the approved objects and checked path absence.' }
  if (
    tool === 'edit_file' &&
    text === `Edited ${args.path}. Verified by reading back identical bytes.`
  )
    return {
      status: 'verified',
      summary: 'Applied one exact replacement and checked the resulting bytes.'
    }
  if (tool === 'act_on_control') {
    if (text.startsWith(`Verified control action: ${args.action}.`))
      return {
        status: 'verified',
        summary: 'The app control reported its requested value or state after the action.'
      }
    if (args.action === 'invoke' && text.startsWith('Reported control action: invoke.'))
      return {
        status: 'reported',
        summary: 'Invoked the named control; inspect the app to establish its broader outcome.'
      }
  }
  if (
    tool === 'write_file' &&
    typeof args.content === 'string' &&
    text ===
      `Saved ${args.path} (${Buffer.byteLength(args.content)} bytes). Verified by reading back identical bytes.`
  )
    return {
      status: 'verified',
      summary: 'Saved document and checked its bytes against the requested content.'
    }
  if (
    tool === 'move_window' &&
    /^(Moved|Minimized|Maximized|Restored) /.test(text) &&
    text.endsWith(' Verified window state.')
  )
    return {
      status: 'verified',
      summary: 'Checked the resulting window position or state against the requested change.'
    }
  if (tool === 'focus_window' && /^Focused ".*"\.$/s.test(text))
    return { status: 'verified', summary: 'Checked that the target became the foreground window.' }
  if (tool === 'open_app' && /^Opened /i.test(text))
    return {
      status: 'reported',
      summary: 'Launcher reported success; a visible app window was not independently checked.'
    }
  if (tool === 'close_window' && /^Closed ".*"\. Verified window closed\.$/s.test(text))
    return {
      status: 'verified',
      summary: 'Checked that the targeted window disappeared after the close request.'
    }
  if (tool === 'close_window' && /^Asked /i.test(text))
    return {
      status: 'reported',
      summary:
        'Sent a close request; closure is not confirmed and an unsaved-work prompt may remain.'
    }
  if (
    (tool === 'type_text' && /^Typed \d+ characters in "/.test(text)) ||
    (tool === 'press_keys' && /^Pressed .+ in "/.test(text)) ||
    (tool === 'click' && /^Clicked (left|right) at /.test(text)) ||
    (tool === 'scroll' && /^Scrolled (up|down) \d+ steps in "/.test(text)) ||
    (tool === 'close_app' && /^Asked \d+ windows? of /.test(text))
  )
    return {
      status: 'reported',
      summary:
        'Windows accepted the input. Inspect or capture the app to check its effect before claiming completion.'
    }
  if (MUTATIONS.has(tool))
    return {
      status: 'uncertain',
      summary:
        'The action returned without a recognized verified outcome. Inspect the result before attempting it again.'
    }
  return {
    status: 'observed',
    summary:
      typeof result !== 'string'
        ? 'Received image data; capture alone does not prove a requested change.'
        : 'Received tool data. Its contents remain untrusted and may become stale.'
  }
}

export function unsupportedCompletion(
  text: string,
  evidence: ActionEvidence[],
  runId: string
): string | undefined {
  const prose = text
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
  const claims: [string, RegExp][] = [
    [
      'delete_file',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?(?:deleted|removed)\s+(?:the\s+)?file\b/i
    ],
    [
      'delete_directory',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?(?:deleted|removed)\s+(?:the\s+)?(?:folder|directory)\b/i
    ],
    [
      'open_app',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?(?:opened|launched|started)\s+(?:the\s+)?(?:notepad|calculator|paint|app|application)\b/i
    ],
    [
      'write_file',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?(?:saved\s+[^\n.!?]{0,80}\b(?:file|document)\b|(?:saved|wrote|written|created)\s+[^\n.!?]{0,80}\.(?:txt|md|csv)\b)/i
    ],
    [
      'move_window',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?(?:moved|resized|snapped|minimized|maximized|restored)\s+[^\n.!?]{0,80}\bwindow\b/i
    ],
    [
      'focus_window',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?focused\s+[^\n.!?]{0,80}\b(?:window|notepad|calculator|paint)\b/i
    ],
    [
      'close_window',
      /(?:^|[.!?]\s+|\n)(?:I(?:'ve| have)?\s+)?(?:successfully\s+)?closed\s+[^\n.!?]{0,80}\b(?:window|notepad|calculator|paint|app)\b/i
    ]
  ]
  for (const [tool, pattern] of claims) {
    if (!pattern.test(prose)) continue
    let matches = evidence.filter((item) => item.runId === runId && item.tool === tool)
    if (tool === 'open_app') {
      const claimed = /(?:opened|launched|started)\s+(?:the\s+)?(notepad|calculator|paint)\b/i
        .exec(prose)?.[1]
        .toLowerCase()
      if (claimed)
        matches = matches.filter((item) => {
          const target = item.target.toLowerCase().replace(/\.exe$/, '')
          return (
            (target === 'calc' ? 'calculator' : target === 'mspaint' ? 'paint' : target) === claimed
          )
        })
    }
    if (tool === 'write_file') {
      const claimed = /(?:saved|wrote|written|created)\s+["']?([^\s"'<>]+\.(?:txt|md|csv))\b/i
        .exec(prose)?.[1]
        .toLowerCase()
      if (claimed)
        matches = matches.filter((item) => {
          const target = item.target.replace(/\\/g, '/').toLowerCase()
          const path = claimed.replace(/\\/g, '/')
          return target === path || (!path.includes('/') && target.endsWith('/' + path))
        })
    }
    if (
      !matches.some(
        (item) => item.status === 'verified' || (tool === 'open_app' && item.status === 'reported')
      )
    )
      return `The draft claims a completed ${tool} action without matching evidence from this request. State the observed result accurately; do not invent completion.`
  }
  return undefined
}
