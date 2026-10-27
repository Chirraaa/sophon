import { useEffect, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

export function MotionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const reduced = useMotionPreference()
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced)
  }, [reduced])
  return <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>
}
