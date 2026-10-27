import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type RefCallback,
  type Dispatch,
  type SetStateAction
} from 'react'

type VisualFrameState = {
  frame: RefCallback<HTMLIFrameElement>
  resource: { id: string; url: string } | null
  title: string
  height: number
  error: string | null
  question: string | null
  setQuestion: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

export function useVisualFrame(resource: { id: string; url: string }): VisualFrameState {
  const frameElement = useRef<HTMLIFrameElement>(null)
  const frame = useCallback<RefCallback<HTMLIFrameElement>>((element) => {
    if (!element) return
    frameElement.current = element

    return () => {
      if (frameElement.current === element) frameElement.current = null
    }
  }, [])
  const [title, setTitle] = useState('Interactive visual')
  const [height, setHeight] = useState(300)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  useEffect(() => {
    if (!resource) return
    let at = Date.now()
    let messages = 0
    const receive = (event: MessageEvent): void => {
      if (event.source !== frameElement.current?.contentWindow || event.origin !== 'null') return
      const data = event.data
      if (!data || data.channel !== 'sophon-visual' || data.id !== resource.id) return
      if (Date.now() - at >= 1000) {
        at = Date.now()
        messages = 0
      }
      if (++messages > 60 || (typeof data.value === 'string' && data.value.length > 4000)) return
      if (data.type === 'height' && typeof data.value === 'number' && Number.isFinite(data.value))
        setHeight(Math.max(180, Math.min(1200, data.value)))
      if (data.type === 'ready' && typeof data.value === 'string')
        setTitle(data.value.slice(0, 100))
      if (data.type === 'error' && typeof data.value === 'string')
        setError(data.value.slice(0, 500))
      if (data.type === 'follow-up' && typeof data.value === 'string' && data.value.trim())
        setQuestion(data.value.trim().slice(0, 2000))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [resource])
  return { frame, resource, title, height, error, question, setQuestion, setError }
}
