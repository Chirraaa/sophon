type Retry = 'session' | 'gate' | 'arguments' | 'completion' | 'protocol'
const RETRY_LIMITS: Record<Retry, number> = {
  session: 3,
  gate: 3,
  arguments: 3,
  completion: 1,
  protocol: 1
}
type Progress = 'checkpoint' | 'inspection' | 'mutation' | 'file-read' | 'arguments'

export class LoopBudgets {
  private retries: Partial<Record<Retry, number>> = {}
  private workspaceRefreshes = 0
  private targets = new Map<string, number>()
  private screenshotRefreshes = 0
  private targetRefreshes = 0
  private controlReadbacks = 0

  count(kind: Retry): number {
    return this.retries[kind] ?? 0
  }
  canRetry(kind: Retry, limit = RETRY_LIMITS[kind]): boolean {
    return this.count(kind) < limit
  }
  fail(kind: Retry): number {
    return (this.retries[kind] = this.count(kind) + 1)
  }
  progress(event: Progress): void {
    if (['checkpoint', 'inspection', 'mutation'].includes(event)) this.retries.session = 0
    if (['checkpoint', 'file-read'].includes(event)) this.retries.gate = 0
    if (event === 'arguments') this.retries.arguments = 0
  }
  recover(tool: string, path: string, result: string, status: string): boolean {
    if (tool === 'act_on_control' && status === 'uncertain') return this.controlReadbacks++ < 2
    const target = path.replace(/\\/g, '/').toLowerCase()
    if (status === 'verified' && ['edit_file', 'write_file', 'create_directory'].includes(tool)) {
      this.workspaceRefreshes = 0
      this.targets.delete(target)
    }
    if (tool === 'click' && result.startsWith('Screenshot required:'))
      return this.screenshotRefreshes++ < 2
    if (
      result.startsWith('Missing workspace path:') ||
      (tool === 'edit_file' && result.startsWith('Patch not applied:'))
    ) {
      const count = this.targets.get(target) ?? 0
      this.targets.set(target, count + 1)
      return this.workspaceRefreshes++ < 2 && count < 2
    }
    if (result.startsWith('Target not found:')) return this.targetRefreshes++ < 2
    return false
  }
}
