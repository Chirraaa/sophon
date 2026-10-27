export type WinInfo = {
  hwnd: number
  title: string
  exe: string
  state: 'normal' | 'maximized' | 'minimized'
  x: number
  y: number
  width: number
  height: number
}
