import { useSyncExternalStore } from 'react'
import { useSettings } from './useSettings'

const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribe = (listener: () => void): (() => void) => {
  preference.addEventListener('change', listener)
  return () => preference.removeEventListener('change', listener)
}
const snapshot = (): boolean => preference.matches

export function useMotionPreference(): boolean {
  const settings = useSettings()
  const systemReduced = useSyncExternalStore(subscribe, snapshot)
  return (
    settings?.motion === 'reduced' || ((!settings || settings.motion === 'system') && systemReduced)
  )
}
