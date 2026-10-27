import { useEffect, useState, type ReactNode } from 'react'
import type { AppUpdateState } from '../../../shared/updates'
import { UpdatesContext } from '@/hooks/useUpdates'

export function UpdatesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let changed = false
    const unsubscribe = window.api.updates.onChange((next) => {
      changed = true
      if (alive) setState(next)
    })
    void window.api.updates
      .get()
      .then((next) => {
        if (alive && !changed) setState(next)
      })
      .catch(() => {
        if (alive) setError('Could not load update status. Reopen Sophon to try again.')
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  const run = async (action: 'check' | 'download' | 'install' | 'acknowledge'): Promise<void> => {
    setError(null)
    try {
      setState(await window.api.updates[action]())
    } catch {
      setError('The update action could not be completed. Please try again.')
    }
  }
  const openLink = (url: string): void => {
    setError(null)
    void window.api.pages.open(url, 'browser', false).catch(() => {
      setError(
        'Could not open the link. Visit github.com/Chirraaa/sophon/releases in your browser.'
      )
    })
  }
  return (
    <UpdatesContext.Provider value={{ state, error, run, openLink }}>
      {children}
    </UpdatesContext.Provider>
  )
}
