import { type ReactNode } from 'react'
import { useMicrophones } from '@/hooks/useMicrophones'
import { useSettings } from '@/hooks/useSettings'

import { MicrophonesContext } from '@/hooks/useAvailableMicrophones'

export function MicrophonesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useSettings()
  const microphones = useMicrophones(settings?.voice.enabled === true)
  return <MicrophonesContext.Provider value={microphones}>{children}</MicrophonesContext.Provider>
}
