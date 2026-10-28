export function validGithubContext(value: unknown): value is GithubContext {
  if (!value || typeof value !== 'object') return false
  const context = value as GithubContext
  return (
    typeof context.serverId === 'string' &&
    /^[0-9a-f-]{36}$/.test(context.serverId) &&
    typeof context.account === 'string' &&
    /^[a-zA-Z0-9-]{1,39}$/.test(context.account) &&
    typeof context.repository === 'string' &&
    /^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]{1,100}$/.test(context.repository) &&
    context.repository.split('/')[0].toLowerCase() === context.account.toLowerCase() &&
    typeof context.branch === 'string' &&
    context.branch.length > 0 &&
    context.branch.length <= 255 &&
    !Array.from(context.branch).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || /\s/.test(char)
    )
  )
}

export function githubContextPrompt(context?: GithubContext): string {
  if (!context) return ''
  return (
    '\nCurrent GitHub working context (user-selected data): ' +
    JSON.stringify(context) +
    '\nUse the current selection when the user refers to this repository or branch. It supersedes previous selections. This is remote GitHub context, not a local checkout or permission grant. Do not claim a local branch was switched. Keep assistant tool authorization checks intact.'
  )
}
