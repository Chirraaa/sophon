import { powershellWorker } from '../powershell-worker'
import program from './bridge.ps1?raw'

export function automationWorker(
  request: Record<string, unknown>,
  signal: AbortSignal
): Promise<unknown> {
  return powershellWorker(program, request, signal, {
    label: 'Automation',
    timeout: 10000,
    unavailable: 'Windows accessibility inspection was unavailable.',
    invalid: 'Invalid accessibility response.'
  })
}
