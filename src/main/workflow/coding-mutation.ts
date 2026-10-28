// Mutation detection must not depend on a language/extension allowlist.
export function codingMutation(name: string, args: Record<string, unknown>): boolean {
  return (
    (name === 'run_npm' && args.action !== 'stop' && !isRoutineNpm(args.args)) ||
    (name === 'run_command' && args.purpose === 'change') ||
    ['write_file', 'edit_file', 'delete_file', 'delete_directory'].includes(name)
  )
}

export function isRoutineNpm(args: unknown): boolean {
  if (!Array.isArray(args)) return false
  const script = args[0] === 'run' ? args[1] : args[0]
  return (
    /^(?:dev|start|serve|preview|test(?::[\w-]+)?|lint|typecheck|type-check|check|build|smoke(?::[\w-]+)?)$/.test(
      String(script ?? '')
    ) && !args.some((arg) => /^(?:--fix|--write|--updateSnapshot|-u)$/.test(String(arg)))
  )
}

export function codingMutationPath(name: string, args: Record<string, unknown>): string {
  const path = String(args.path ?? '.')
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
  // Commands expose their working directory, not a reliable list of edited files.
  // Keep that scope dirty even when no previous verification session exists.
  return ['run_command', 'run_npm'].includes(name) ? `${path}/__mutation__` : path
}
