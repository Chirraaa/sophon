import { createContext, useContext } from 'react'

export const VisualFollowUp = createContext<((question: string) => void) | undefined>(undefined)
export const StreamingReply = createContext(false)
export const useVisualFollowUp = (): ((question: string) => void) | undefined =>
  useContext(VisualFollowUp)
