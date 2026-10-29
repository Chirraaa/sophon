import { useCallback, useEffect, useState } from 'react'

const ipcMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )

export interface LlamaState {
  view: LlamaView | null
  error: string
  busy: boolean
  run: (action: () => Promise<LlamaView | null>) => Promise<void>
}

// The managed llama.cpp server: its saved choices and live status, with one place for errors.
export function useLlama(): LlamaState {
  const [view, setView] = useState<LlamaView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    void window.api.llama
      .get()
      .then((next) => alive && setView(next))
      .catch((failure) => alive && setError(ipcMessage(failure)))
    const off = window.api.llama.onStatus((status) =>
      setView((old) =>
        old
          ? {
              ...old,
              status,
              applied:
                status.state === 'starting' || status.state === 'running' ? old.applied : null
            }
          : old
      )
    )
    return () => {
      alive = false
      off()
    }
  }, [])
  const run = useCallback(async (action: () => Promise<LlamaView | null>) => {
    setBusy(true)
    setError('')
    try {
      const next = await action()
      if (next) setView(next)
    } catch (failure) {
      setError(ipcMessage(failure))
    } finally {
      setBusy(false)
    }
  }, [])
  return { view, error, busy, run }
}
