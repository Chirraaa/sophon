import { useEffect, useState } from 'react'
import { documentedCapabilities } from '../../../shared/model-capabilities'

export function useModelInfo(settings: AppSettings | null): ModelChoice | undefined {
  const key = JSON.stringify([
    settings?.model.provider,
    settings?.model.endpoint,
    settings?.model.modelId
  ])
  const [result, setResult] = useState<{ key: string; info: ModelChoice } | null>(null)
  useEffect(() => {
    if (!settings) return
    let alive = true
    const refresh = (): void => {
      void window.api
        .llmModelInfo()
        .then((info) => {
          if (alive) setResult({ key, info })
        })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [key, settings])
  if (!settings) return
  return result?.key === key
    ? result.info
    : {
        id: settings.model.modelId,
        label: settings.model.modelId,
        ...documentedCapabilities(settings.model.modelId, settings.model.provider)
      }
}
