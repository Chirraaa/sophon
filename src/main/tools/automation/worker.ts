import { persistentPowershellWorker } from '../powershell-worker'
import { currentRun } from '../../security/run-manager'
import { recordTiming } from '../../workflow/timing'
import program from './bridge.ps1?raw'

// The resource job caps each worker at 15 s of lifetime CPU; recycling after 20
// requests keeps a long task well inside that before the cap could interrupt one.
const worker = persistentPowershellWorker(program, {
  label: 'Automation',
  timeout: 10000,
  idleMs: 60000,
  maxRequests: 20,
  unavailable: 'Windows accessibility inspection was unavailable.',
  invalid: 'Invalid accessibility response.'
})

export async function automationWorker(
  request: Record<string, unknown>,
  signal: AbortSignal
): Promise<unknown> {
  const started = performance.now()
  try {
    return await worker.request(request, signal)
  } finally {
    const run = currentRun()
    if (run) recordTiming(run, 'automation', performance.now() - started)
  }
}

export const stopAutomationWorker = (): void => worker.stop()
