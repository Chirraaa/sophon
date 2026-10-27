import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'crypto'
import { lockChromiumSession, lockWebRtc } from '../security/chromium-egress'
import { constrainParser } from '../security/worker-job'
import { registerAppProtocol } from './app-assets'
import { rendererDocument } from '../security/trusted-document'

let tail: Promise<unknown> = Promise.resolve()
let queued = 0
async function parse(input: Record<string, unknown>): Promise<string> {
  const partition = session.fromPartition(`parser-${randomUUID()}`, { cache: false })
  const renderer = rendererDocument()
  const development = /^https?:$/.test(renderer.protocol) ? renderer : undefined
  await lockChromiumSession(partition, development)
  registerAppProtocol(partition.protocol, true)
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      backgroundThrottling: false
    }
  })
  lockWebRtc(win.webContents)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  let release: (() => void) | undefined
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      (async (): Promise<string> => {
        await win.loadURL(
          development
            ? new URL('/parser.html', development).href
            : 'sophon-parser://parser/parser.html'
        )
        const pid = win.webContents.getOSProcessId()
        if (pid === process.pid || pid <= 0)
          throw new Error('Parser did not receive a separate process.')
        release = constrainParser(pid)
        const result: unknown = await win.webContents.executeJavaScript(
          `globalThis.parseDocument(${JSON.stringify(input)})`
        )
        if (typeof result !== 'string' || result.length > 12 * 1024 * 1024)
          throw new Error('Invalid or oversized parser output.')
        return result
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          if (!win.isDestroyed()) {
            win.webContents.forcefullyCrashRenderer()
            win.destroy()
          }
          reject(new Error('Parser exceeded its time limit.'))
        }, 20000)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
    release?.()
  }
}
function schedule(input: Record<string, unknown>): Promise<string> {
  if (++queued > 8) {
    queued--
    return Promise.reject(new Error('Too many parser requests.'))
  }
  const task = tail.then(() => parse(input))
  tail = task.catch(() => {})
  return task.finally(() => {
    queued--
  })
}
export function decodeImage(dataUrl: string, format: 'png' | 'jpeg' = 'jpeg'): Promise<string> {
  if (
    !/^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ||
    dataUrl.length > 12 * 1024 * 1024
  )
    throw new Error('Invalid or oversized image data.')
  return schedule({ kind: 'image', dataUrl, format })
}
export function parseDiagram(source: string): Promise<string> {
  if (source.length > 20000) throw new Error('Diagram source exceeds its size budget.')
  return schedule({ kind: 'diagram', source })
}

export async function parsePdf(bytes: Buffer): Promise<{ text: string; pages: string[] }> {
  if (bytes.length > 8 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-')
    throw new Error('Invalid or oversized PDF document.')
  return JSON.parse(await schedule({ kind: 'pdf', source: bytes.toString('base64') }))
}
