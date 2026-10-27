import { useCallback, useEffect, useRef, useState } from 'react'
import { microphoneError } from '@/lib/recording'
export function useMicrophones(enabled: boolean): {
  devices: MediaDeviceInfo[]
  error: string | null
  loading: boolean
  defaultLabel: string
  refresh: () => Promise<void>
} {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [defaultLabel, setDefaultLabel] = useState('')
  const detecting = useRef(false)
  const generation = useRef(0)
  const activeStream = useRef<MediaStream | null>(null)
  const update = useCallback((list: MediaDeviceInfo[]): void => {
    setDefaultLabel(
      list.find((device) => device.kind === 'audioinput' && device.deviceId === 'default')?.label ??
        ''
    )
    setDevices(
      list.filter(
        (device) =>
          device.kind === 'audioinput' &&
          Boolean(device.deviceId) &&
          device.deviceId !== 'default' &&
          device.deviceId !== 'communications'
      )
    )
  }, [])
  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || detecting.current) return
    const version = generation.current
    detecting.current = true
    setLoading(true)
    setError(null)
    let stream: MediaStream | undefined
    try {
      await window.api.voice.beginDeviceDetection()
      if (version !== generation.current) return
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (version !== generation.current) return
      activeStream.current = stream
      const list = await navigator.mediaDevices.enumerateDevices()
      if (version === generation.current) update(list)
    } catch (error) {
      if (version === generation.current) setError(microphoneError(error))
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      activeStream.current = null
      try {
        await window.api.voice.endDeviceDetection()
      } catch (error) {
        setError((error as Error).message)
      }
      detecting.current = false
      setLoading(false)
    }
  }, [enabled, update])
  useEffect(() => {
    let active = true
    const revoke = (): void => {
      generation.current++
      activeStream.current?.getTracks().forEach((track) => track.stop())
      activeStream.current = null
    }
    const off = window.api.onSettings((settings) => {
      if (!settings.voice.enabled) revoke()
    })
    const changed = (): void => {
      if (!enabled) return
      const version = generation.current
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (active && version === generation.current) update(list)
        })
        .catch((error: Error) => {
          if (active && version === generation.current) setError(microphoneError(error))
        })
    }

    queueMicrotask(() => {
      if (active && enabled) void refresh()
    })
    navigator.mediaDevices.addEventListener('devicechange', changed)
    return () => {
      active = false
      revoke()
      off()
      void window.api.voice.endDeviceDetection().catch(() => {})
      navigator.mediaDevices.removeEventListener('devicechange', changed)
    }
  }, [enabled, refresh, update])
  return { devices, error, loading, defaultLabel, refresh }
}
