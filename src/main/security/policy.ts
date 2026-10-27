import { getSettings, settingsRecovery } from '../settings'
import { isKnownTool } from '../tools/registry'
import { assertRun, type RunContext } from './run-manager'

export function authorizeTool(run: RunContext, name: string): void {
  assertRun(run)
  if (!isKnownTool(name)) throw new Error('Unknown tool.')
  if (!['ask', 'allow'].includes(getSettings().tools[name]))
    throw new Error('Blocked by current tool policy.')
  const web = name === 'web_search' || name === 'web_fetch'
  if (settingsRecovery().required)
    throw new Error('Review recovered security settings before using tools.')
  if (web && !getSettings().research.enabled)
    throw new Error('Public web access is disabled in Settings.')
  if (name === 'web_search' && run.searchUnavailable)
    throw new Error(
      'Search is unavailable for this request. Read a public source with web_fetch or explain that current information could not be verified.'
    )
  if (
    getSettings().model.endpoint !== run.endpoint ||
    getSettings().files.workspace !== run.workspace
  )
    throw new Error('Task destinations changed. Start a new task.')
}
export const canUseTool = (run: RunContext | undefined, name: string): boolean => {
  if (!run) return false
  try {
    authorizeTool(run, name)
    return true
  } catch {
    return false
  }
}
