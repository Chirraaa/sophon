import { createContext, useContext } from 'react'
import type { AppUpdateState } from '../../../shared/updates'

export const UpdatesContext = createContext<{
  state: AppUpdateState | null
  error: string | null
  run: (action: 'check' | 'download' | 'install' | 'acknowledge') => Promise<void>
  openLink: (url: string) => void
}>({ state: null, error: null, run: async () => {}, openLink: () => {} })

export function useUpdates(): React.ContextType<typeof UpdatesContext> {
  return useContext(UpdatesContext)
}
