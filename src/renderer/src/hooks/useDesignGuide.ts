import { useEffect, useState } from 'react'

export const designPalettes = [
  { name: 'Quiet violet', accent: '#6d28d9', light: '#f5f3ff', dark: '#171321' },
  { name: 'Ocean blue', accent: '#1d4ed8', light: '#eff6ff', dark: '#101b2c' },
  { name: 'Warm earth', accent: '#9a3412', light: '#fff7ed', dark: '#241813' },
  { name: 'Forest studio', accent: '#166534', light: '#f0fdf4', dark: '#102019' },
  { name: 'Rose ink', accent: '#be123c', light: '#fff1f2', dark: '#25141d' },
  { name: 'Graphite', accent: '#52525b', light: '#fafafa', dark: '#18181b' }
] as const
export const designFonts = {
  sans: { label: 'Clean sans', family: "'Geist Variable', 'Segoe UI', sans-serif" },
  serif: { label: 'Editorial serif', family: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Technical mono', family: "Consolas, 'Courier New', monospace" }
} as const
export type DesignPreferences = {
  palette: number
  accent: string
  customPalette: boolean
  background: string
  surface: string
  foreground: string
  secondary: string
  font: keyof typeof designFonts
  customFont: string
  appearance: 'light' | 'dark'
  shape: 'soft' | 'sharp' | 'round'
  spacing: 'airy' | 'compact' | 'balanced'
  surfaceStyle: 'flat' | 'outlined' | 'elevated'
  motion: 'none' | 'subtle' | 'expressive'
  notes: string
  attached: boolean
}
export const defaultDesignPreferences: DesignPreferences = {
  palette: 0,
  accent: designPalettes[0].accent,
  customPalette: false,
  background: '#f5f3ff',
  surface: '#ffffff',
  foreground: '#18181b',
  secondary: '#0f766e',
  font: 'sans',
  customFont: '',
  appearance: 'light',
  shape: 'soft',
  spacing: 'airy',
  surfaceStyle: 'outlined',
  motion: 'subtle',
  notes: '',
  attached: false
}
const defaults = defaultDesignPreferences
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

export function designColors(value: DesignPreferences): {
  background: string
  surface: string
  foreground: string
  secondary: string
} {
  if (value.customPalette) return value
  const palette = designPalettes[value.palette] ?? designPalettes[0]
  const dark = value.appearance === 'dark'
  return {
    background: dark ? palette.dark : palette.light,
    surface: dark ? '#27272a' : '#ffffff',
    foreground: dark ? '#fafafa' : '#18181b',
    secondary: value.secondary
  }
}

export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const channels = hex
      .slice(1)
      .match(/../g)!
      .map((part) => {
        const n = parseInt(part, 16) / 255
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
      })
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function read(key: string): DesignPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object') return defaults
    return {
      palette:
        Number.isInteger(value.palette) && designPalettes[value.palette]
          ? value.palette
          : defaults.palette,
      accent: /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : defaults.accent,
      customPalette: value.customPalette === true,
      background: color(value.background, defaults.background),
      surface: color(value.surface, defaults.surface),
      foreground: color(value.foreground, defaults.foreground),
      secondary: color(value.secondary, defaults.secondary),
      font: Object.hasOwn(designFonts, value.font) ? value.font : defaults.font,
      customFont: typeof value.customFont === 'string' ? value.customFont.slice(0, 100) : '',
      appearance: value.appearance === 'dark' ? 'dark' : 'light',
      shape: ['sharp', 'round'].includes(value.shape) ? value.shape : 'soft',
      spacing: ['compact', 'balanced'].includes(value.spacing) ? value.spacing : 'airy',
      surfaceStyle: ['flat', 'elevated'].includes(value.surfaceStyle)
        ? value.surfaceStyle
        : 'outlined',
      motion: ['none', 'expressive'].includes(value.motion) ? value.motion : 'subtle',
      notes: typeof value.notes === 'string' ? value.notes.slice(0, 1000) : '',
      attached: value.attached === true
    }
  } catch {
    return defaults
  }
}
export function designBrief(value: DesignPreferences): string {
  const palette = designPalettes[value.palette]
  const colors = designColors(value)
  return [
    'Design guide preferences:',
    `Palette: ${value.customPalette ? 'Custom palette' : palette.name}; accent ${value.accent}; background ${colors.background}; surface ${colors.surface}; text ${colors.foreground}; secondary ${colors.secondary}.`,
    `Typography: ${value.customFont.trim() || `${designFonts[value.font].label} (${designFonts[value.font].family})`}.`,
    `Appearance: ${value.appearance}; corners: ${value.shape}; spacing: ${value.spacing}.`,
    `Surfaces: ${value.surfaceStyle}; motion: ${value.motion}. Respect reduced-motion preferences.`,
    `Text contrast: ${contrastRatio(colors.foreground, colors.background).toFixed(2)}:1 against background, ${contrastRatio(colors.foreground, colors.surface).toFixed(2)}:1 against surface. Adjust low-contrast combinations for readable text. Custom fonts need an available local or project font; the preview may use a fallback.`,
    value.notes.trim() ? `Additional direction: ${value.notes.trim()}` : '',
    'Use these as the visual direction for this request. Inspect the actual project and reuse its design system and components (including shadcn/ui when present). Apply only the requested changes and relevant views. The guide sample is illustrative, not a request to copy its content or add new app views.'
  ]
    .filter(Boolean)
    .join('\n')
}
function localPreferences(key: string): DesignPreferences | undefined {
  try {
    return localStorage.getItem(key) === null ? undefined : read(key)
  } catch {
    return undefined
  }
}
export function useDesignGuide(chatId: string): {
  preferences: DesignPreferences
  update: (patch: Partial<DesignPreferences>) => void
} {
  const key = `sophon:design-guide:${chatId}`
  const [state, setState] = useState(() => ({ key, preferences: read(key) }))
  const preferences = state.key === key ? state.preferences : read(key)
  if (state.key !== key) setState({ key, preferences })
  useEffect(() => {
    const sync = (event: StorageEvent | CustomEvent<string>): void => {
      if (
        ('key' in event && (event.key === key || event.key === null)) ||
        ('detail' in event && event.detail === key)
      )
        setState({ key, preferences: read(key) })
    }
    window.addEventListener('storage', sync)
    window.addEventListener('design-guide-change', sync as EventListener)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('design-guide-change', sync as EventListener)
    }
  }, [key])
  return {
    preferences,
    update: (patch) => {
      const next = { ...(localPreferences(key) ?? preferences), ...patch }
      setState({ key, preferences: next })
      try {
        localStorage.setItem(key, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent('design-guide-change', { detail: key }))
      } catch {
        /* Keep the guide usable when local storage is unavailable. */
      }
    }
  }
}
