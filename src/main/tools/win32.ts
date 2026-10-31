import koffi from 'koffi'
const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')
const kernel32 = koffi.load('kernel32.dll')
const shell32 = koffi.load('shell32.dll')
const gdi32 = koffi.load('gdi32.dll')
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)')
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(intptr hwnd)')
const IsZoomed = user32.func('bool __stdcall IsZoomed(intptr hwnd)')
const GetWindowTextW = user32.func(
  'int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint16_t *buf, int max)'
)
const GetWindowLongW = user32.func('int __stdcall GetWindowLongW(intptr hwnd, int index)')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ int32_t *rect)')
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32_t *pid)'
)
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()')
const AttachThreadInput = user32.func(
  'bool __stdcall AttachThreadInput(uint32 attach, uint32 attachTo, bool join)'
)
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(intptr hwnd)')
const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr hwnd, int cmd)')
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)'
)
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr hwnd)')
const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()')
const PostMessageW = user32.func(
  'bool __stdcall PostMessageW(intptr hwnd, uint32 msg, intptr wParam, intptr lParam)'
)
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)')
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ int32_t *point)')
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 count, void *inputs, int size)')
const MapVirtualKeyW = user32.func('uint32 __stdcall MapVirtualKeyW(uint32 code, uint32 mapType)')
const DwmGetWindowAttribute = dwmapi.func(
  'int __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ int32_t *value, uint32 size)'
)
const OpenProcess = kernel32.func(
  'intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'
)
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr handle)')
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(intptr process, uint32 flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'
)
const GetDC = user32.func('intptr __stdcall GetDC(intptr hwnd)')
const ReleaseDC = user32.func('int __stdcall ReleaseDC(intptr hwnd, intptr hdc)')
const CreateCompatibleDC = gdi32.func('intptr __stdcall CreateCompatibleDC(intptr hdc)')
const CreateCompatibleBitmap = gdi32.func(
  'intptr __stdcall CreateCompatibleBitmap(intptr hdc, int w, int h)'
)
const SelectObject = gdi32.func('intptr __stdcall SelectObject(intptr hdc, intptr obj)')
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(intptr obj)')
const DeleteDC = gdi32.func('bool __stdcall DeleteDC(intptr hdc)')
const SetStretchBltMode = gdi32.func('int __stdcall SetStretchBltMode(intptr hdc, int mode)')
const StretchBlt = gdi32.func(
  'bool __stdcall StretchBlt(intptr dst, int x, int y, int w, int h, intptr src, int sx, int sy, int sw, int sh, uint32 rop)'
)
const GetDIBits = gdi32.func(
  'int __stdcall GetDIBits(intptr hdc, intptr bmp, uint32 start, uint32 lines, void *bits, void *info, uint32 usage)'
)
const SHQueryUserNotificationState = shell32.func(
  'int __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)'
)
export const SW_MAXIMIZE = 3
export const SW_MINIMIZE = 6
export const SW_RESTORE = 9
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_APPWINDOW = 0x40000
const DWMWA_CLOAKED = 14
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const SWP_NOACTIVATE = 0x0010
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const QUNS_RUNNING_D3D_FULL_SCREEN = 3
export type Rect = {
  left: number
  top: number
  right: number
  bottom: number
}
export function enumTopLevelWindows(): number[] {
  const handles: number[] = []
  const cb = koffi.register((hwnd: unknown) => {
    handles.push(Number(koffi.address(hwnd)))
    return true
  }, koffi.pointer(EnumWindowsProc))
  try {
    EnumWindows(cb, 0)
  } finally {
    koffi.unregister(cb)
  }
  return handles
}
export const isVisible = (h: number): boolean => IsWindowVisible(h)
export const isMinimized = (h: number): boolean => IsIconic(h)
export const isMaximized = (h: number): boolean => IsZoomed(h)
export function getTitle(h: number): string {
  const buf = new Uint16Array(512)
  const n = GetWindowTextW(h, buf, 512)
  return Buffer.from(buf.buffer, 0, n * 2).toString('utf16le')
}
export function isCloaked(h: number): boolean {
  const v = new Int32Array(1)
  DwmGetWindowAttribute(h, DWMWA_CLOAKED, v, 4)
  return v[0] !== 0
}
export function isToolWindow(h: number): boolean {
  const ex = GetWindowLongW(h, GWL_EXSTYLE)
  return (ex & WS_EX_TOOLWINDOW) !== 0 && (ex & WS_EX_APPWINDOW) === 0
}
export function getRect(h: number): Rect {
  const r = new Int32Array(4)
  GetWindowRect(h, r)
  return { left: r[0], top: r[1], right: r[2], bottom: r[3] }
}
export function getVisibleRect(h: number): Rect {
  const f = new Int32Array(4)
  const hr = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, f, 16)
  if (hr !== 0) return getRect(h)
  return { left: f[0], top: f[1], right: f[2], bottom: f[3] }
}
export function getProcess(h: number): {
  pid: number
  exe: string
} {
  const pidBuf = new Uint32Array(1)
  GetWindowThreadProcessId(h, pidBuf)
  const pid = pidBuf[0]
  let exe = ''
  const proc = Number(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid))
  if (proc) {
    try {
      const buf = new Uint16Array(1024)
      const size = new Uint32Array([1024])
      if (QueryFullProcessImageNameW(proc, 0, buf, size)) {
        const path = Buffer.from(buf.buffer, 0, size[0] * 2).toString('utf16le')
        exe = path.split('\\').pop() ?? ''
      }
    } finally {
      CloseHandle(proc)
    }
  }
  return { pid, exe }
}
export const showWindow = (h: number, cmd: number): boolean => ShowWindow(h, cmd)
export function bringToFront(h: number): boolean {
  if (SetForegroundWindow(h) && Number(GetForegroundWindow()) === h) return true

  const own = GetCurrentThreadId()
  const foreground = Number(GetForegroundWindow())
  const other = foreground ? GetWindowThreadProcessId(foreground, new Uint32Array(1)) : 0
  const attached = other !== 0 && own !== other && AttachThreadInput(own, other, true)
  try {
    BringWindowToTop(h)
    return SetForegroundWindow(h)
  } finally {
    if (attached) AttachThreadInput(own, other, false)
  }
}
export const foregroundWindow = (): number => Number(GetForegroundWindow())
// An exclusive fullscreen app drops out of its display mode when any window shows above it.
export function exclusiveFullscreen(): boolean {
  const state = new Int32Array(1)
  return SHQueryUserNotificationState(state) === 0 && state[0] === QUNS_RUNNING_D3D_FULL_SCREEN
}
export const requestClose = (h: number): boolean => PostMessageW(h, 0x0010, 0, 0)
// A small downscaled copy of a screen rectangle (physical pixels), 32-bit BGRA rows top to
// bottom. A few milliseconds instead of a full monitor capture, for deciding whether a
// window has stopped changing. Windows excluded from capture (Sophon's overlays) are absent.
export function screenSample(
  rect: { x: number; y: number; width: number; height: number },
  width: number
): Buffer | null {
  if (rect.width < 1 || rect.height < 1) return null
  const w = Math.max(1, Math.min(width, rect.width))
  const h = Math.max(1, Math.round((w * rect.height) / rect.width))
  const screenDc = Number(GetDC(0))
  if (!screenDc) return null
  const memory = Number(CreateCompatibleDC(screenDc))
  const bitmap = memory ? Number(CreateCompatibleBitmap(screenDc, w, h)) : 0
  const previous = bitmap ? SelectObject(memory, bitmap) : 0
  try {
    if (!bitmap) return null
    SetStretchBltMode(memory, 4)
    if (
      !StretchBlt(memory, 0, 0, w, h, screenDc, rect.x, rect.y, rect.width, rect.height, 0x00cc0020)
    )
      return null
    const info = Buffer.alloc(44)
    info.writeUInt32LE(40, 0)
    info.writeInt32LE(w, 4)
    info.writeInt32LE(-h, 8)
    info.writeUInt16LE(1, 12)
    info.writeUInt16LE(32, 14)
    const bits = Buffer.alloc(w * h * 4)
    SelectObject(memory, previous)
    return GetDIBits(memory, bitmap, 0, h, bits, info, 0) === h ? bits : null
  } finally {
    if (bitmap) DeleteObject(bitmap)
    if (memory) DeleteDC(memory)
    ReleaseDC(0, screenDc)
  }
}
export const setCursor = (x: number, y: number): boolean => SetCursorPos(x, y)
export function cursorPos(): { x: number; y: number } | null {
  const point = new Int32Array(2)
  return GetCursorPos(point) ? { x: point[0], y: point[1] } : null
}
const INPUT_SIZE = process.arch === 'x64' ? 40 : 28
const DATA_OFFSET = process.arch === 'x64' ? 8 : 4
function submitInput(type: number, fill: (data: Buffer) => void): boolean {
  const input = Buffer.alloc(INPUT_SIZE)
  input.writeUInt32LE(type, 0)
  fill(input.subarray(DATA_OFFSET))
  return SendInput(1, input, INPUT_SIZE) === 1
}
// Games read scan codes (DirectInput / Raw Input) and ignore the virtual-key field, so send both.
export function keyInput(key: number, up = false, unicode = false): boolean {
  return submitInput(1, (data) => {
    const scan = unicode ? 0 : MapVirtualKeyW(key, 0)
    const extended = !unicode && key >= 0x21 && key <= 0x2e
    data.writeUInt16LE(unicode ? 0 : key, 0)
    data.writeUInt16LE(unicode ? key : scan, 2)
    data.writeUInt32LE(
      (up ? 0x0002 : 0) | (unicode ? 0x0004 : 0) | (scan ? 0x0008 : 0) | (extended ? 0x0001 : 0),
      4
    )
  })
}
export function mouseInput(flags: number, wheel = 0, dx = 0, dy = 0): boolean {
  return submitInput(0, (data) => {
    data.writeInt32LE(dx, 0)
    data.writeInt32LE(dy, 4)
    data.writeInt32LE(wheel, 8)
    data.writeUInt32LE(flags, 12)
  })
}
export function placeWindow(h: number, x: number, y: number, w: number, hgt: number): boolean {
  const outer = getRect(h)
  const vis = getVisibleRect(h)
  const inset = {
    left: vis.left - outer.left,
    top: vis.top - outer.top,
    right: outer.right - vis.right,
    bottom: outer.bottom - vis.bottom
  }
  return SetWindowPos(
    h,
    0,
    x - inset.left,
    y - inset.top,
    w + inset.left + inset.right,
    hgt + inset.top + inset.bottom,
    SWP_NOACTIVATE
  )
}
