import type { ToolOutcome } from './tool-outcome'

type Retry =
  | 'session'
  | 'gate'
  | 'arguments'
  | 'completion'
  | 'protocol'
  | 'stall'
  | 'evidence'
  | 'batch'
  | 'proof'
const RETRY_LIMITS: Record<Retry, number> = {
  session: 3,
  gate: 3,
  arguments: 3,
  completion: 1,
  protocol: 1,
  stall: 1,
  evidence: 1,
  // Malformed batch shapes (mixing calls that must stand alone, unknown tools).
  batch: 3,
  // Proof gate rounds without convergence; probe progress resets it.
  proof: 4
}
// Distinct failed or uncertain actions the model may diagnose between verified changes.
const SETBACKS = 6
type Progress = 'checkpoint' | 'inspection' | 'mutation' | 'file-read' | 'arguments' | 'proof'

export class LoopBudgets {
  private retries: Partial<Record<Retry, number>> = {}
  private workspaceRefreshes = 0
  private targets = new Map<string, number>()
  private screenshotRefreshes = 0
  private targetRefreshes = 0
  private controlReadbacks = 0
  private setbacks = 0
  private failedCalls = new Set<string>()

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
    if (event === 'mutation') this.setbacks = 0
    if (event === 'proof') this.retries.proof = 0
  }
  recover(tool: string, path: string, result: ToolOutcome): boolean {
    if (tool === 'act_on_control' && result.code === 'control-uncertain')
      return this.controlReadbacks++ < 2
    const target = path.replace(/\\/g, '/').toLowerCase()
    if (
      result.status === 'verified' &&
      ['edit_file', 'write_file', 'create_directory'].includes(tool)
    ) {
      this.workspaceRefreshes = 0
      this.targets.delete(target)
    }
    if (tool === 'click' && result.code === 'screenshot-required')
      return this.screenshotRefreshes++ < 2
    if (
      result.code === 'workspace-missing' ||
      (tool === 'edit_file' && result.code === 'patch-not-applied')
    ) {
      const count = this.targets.get(target) ?? 0
      this.targets.set(target, count + 1)
      return this.workspaceRefreshes++ < 2 && count < 2
    }
    if (result.code === 'target-missing') return this.targetRefreshes++ < 2
    return false
  }
  // A failed or uncertain result without a dedicated recovery path goes back to the model
  // while its attempts stay distinct: repeating an identical failed call ends recovery,
  // and a verified change resets the allowance. Denials always stop.
  setback(result: ToolOutcome, call = ''): boolean {
    if (!['failed', 'uncertain'].includes(result.status)) return false
    if (call && this.failedCalls.has(call)) return false
    if (call) this.failedCalls.add(call)
    return this.setbacks++ < SETBACKS
  }
}
