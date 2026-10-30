export const ACTION_LIMIT = 60
export const TOOL_BATCH_LIMIT = 60
export const RUN_SECONDS = 15 * 60
export const isBookkeepingTool = (name: string): boolean =>
  [
    'discover_tools',
    'coding_resources',
    'coding_checkpoint',
    'remember',
    'forget',
    'recall'
  ].includes(name)
