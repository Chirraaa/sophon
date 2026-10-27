import { powershellWorker } from './powershell-worker'
import program from './system-control.ps1?raw'

export function systemControlWorker(
  request: Record<string, unknown>,
  signal: AbortSignal
): Promise<unknown> {
  return powershellWorker(program, request, signal, {
    label: 'Device control',
    timeout: 20000,
    unavailable: 'Windows device control was unavailable.',
    invalid: 'Invalid device control response.'
  })
}
