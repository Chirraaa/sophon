import { createContext, useContext } from 'react'
import type { useMicrophones } from './useMicrophones'

export const MicrophonesContext = createContext<ReturnType<typeof useMicrophones> | null>(null)

export function useAvailableMicrophones(): ReturnType<typeof useMicrophones> {
  const microphones = useContext(MicrophonesContext)
  if (!microphones) throw new Error('Microphone settings require MicrophonesProvider.')
  return microphones
}
