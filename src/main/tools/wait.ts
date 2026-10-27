import { setTimeout } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { assertRun, type RunContext } from '../security/run-manager'

export async function wait(seconds: number, run: RunContext): Promise<string> {
  if (!Number.isFinite(seconds) || seconds < 0.001 || seconds > 60)
    throw new Error('Wait duration must be between 0.001 and 60 seconds.')
  assertRun(run)
  const started = performance.now()
  await setTimeout(seconds * 1000, undefined, { signal: run.signal })
  assertRun(run)
  return `Wait completed. Actual elapsed: ${Math.floor(performance.now() - started)} ms. Current UTC time: ${new Date().toISOString()}. No desktop observation was made.`
}
