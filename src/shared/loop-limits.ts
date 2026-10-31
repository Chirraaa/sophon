export const ACTION_LIMIT = 60
export const TOOL_BATCH_LIMIT = 60
export const RUN_SECONDS = 15 * 60
// Coding runs earn more actions and time while verification shows progress (see the
// convergence governor); these ceilings bound every extension.
export const ACTION_CEILING = 240
export const RUN_SECONDS_CEILING = 60 * 60
// Host-run verification probes have their own budget so re-checking never starves actions.
export const PROBE_LIMIT = 200
export const actionLimit = (run: { actionLimit?: number }): number =>
  Math.min(Math.max(run.actionLimit ?? ACTION_LIMIT, ACTION_LIMIT), ACTION_CEILING)
export const runSeconds = (run: { deadlineSeconds?: number }): number =>
  Math.min(Math.max(run.deadlineSeconds ?? RUN_SECONDS, RUN_SECONDS), RUN_SECONDS_CEILING)
export const isBookkeepingTool = (name: string): boolean =>
  [
    'discover_tools',
    'coding_resources',
    'coding_checkpoint',
    'verification_contract',
    'run_probes',
    'remember',
    'forget',
    'recall'
  ].includes(name)
