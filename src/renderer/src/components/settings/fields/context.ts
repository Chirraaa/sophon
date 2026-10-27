import { createContext } from 'react'
export const RowLabel = createContext<string | undefined>(undefined)
export const inputClass =
  'no-drag h-9 rounded-lg border-input bg-black/15 px-3 text-xs shadow-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20'
export type Option<T extends string> = {
  value: T
  label: string
}
