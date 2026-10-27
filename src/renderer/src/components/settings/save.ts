import { useSyncExternalStore } from 'react'

export type SaveResult = Pick<SettingsResult, 'ok' | 'error'>
let status = { pending: 0, error: '' }
const listeners = new Set<() => void>()
function publish(next: typeof status): void {
  status = next
  listeners.forEach((listener) => listener())
}
export function useSettingsSave(): typeof status {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => status
  )
}
export async function save(patch: SettingsPatch): Promise<SaveResult> {
  publish({ pending: status.pending + 1, error: '' })
  try {
    const result = await window.api.updateSettings(patch)
    if (!result.ok) publish({ ...status, error: result.error ?? 'Could not save settings.' })
    return result
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'Could not save settings.'
    publish({ ...status, error })
    return { ok: false, error }
  } finally {
    publish({ ...status, pending: status.pending - 1 })
  }
}
