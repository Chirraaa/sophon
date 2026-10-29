import { dialog, protocol, type BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { writeFile } from 'fs/promises'
import { VISUAL_POLICY, visualDocument } from './visual-document'
import { parseDiagram } from './isolated-parser'

const documents = new Map<string, { owner: number; html: string; svg?: string; inert?: boolean }>()

export function registerVisualProtocol(): void {
  protocol.handle('sophon-visual', (request) => {
    const url = new URL(request.url)
    const document = documents.get(url.pathname.slice(1))
    if (url.hostname !== 'render' || request.method !== 'GET' || !document)
      return new Response('Visual unavailable', { status: 404 })
    return new Response(document.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': document.inert
          ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox"
          : VISUAL_POLICY,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Permissions-Policy':
          'camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=()'
      }
    })
  })
}
export function createImageVisual(
  owner: WebContents,
  dataUrl: string,
  svg?: string
): { id: string; url: string } {
  if (
    !/^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ||
    dataUrl.length > 12 * 1024 * 1024
  )
    throw new Error('Invalid isolated image.')
  if ([...documents.values()].filter((value) => value.owner === owner.id).length >= 100)
    throw new Error('Too many images are open.')
  const id = randomUUID()
  documents.set(id, {
    owner: owner.id,
    inert: true,
    svg,
    html: `<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body style="margin:0;display:grid;place-items:center;height:100vh;background:transparent"><img alt="Isolated image" style="max-width:100%;max-height:100vh;object-fit:contain" src="${dataUrl}"></body></html>`
  })
  return { id, url: 'sophon-visual://render/' + id }
}
export async function createDiagram(
  owner: WebContents,
  source: string
): Promise<{ id: string; url: string }> {
  const svg = await parseDiagram(source)
  if (owner.isDestroyed() || !/^<svg[\s>]/.test(svg) || svg.length > 1000000)
    throw new Error('Invalid diagram parser output.')
  return createImageVisual(
    owner,
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    svg
  )
}

export function createVisual(owner: WebContents, source: string): { id: string; url: string } {
  if (typeof source !== 'string' || source.length > 150000)
    throw new Error('Visuals must be smaller than 150,000 characters.')
  if ([...documents.values()].filter((value) => value.owner === owner.id).length >= 100)
    throw new Error('Too many visuals are open. Switch chats to free up space.')
  const id = randomUUID()
  documents.set(id, { owner: owner.id, html: visualDocument(source, id) })
  return { id, url: 'sophon-visual://render/' + id }
}

export function releaseVisual(owner: WebContents, id: string): void {
  if (documents.get(id)?.owner === owner.id) documents.delete(id)
}

export function clearVisuals(owner: WebContents): void {
  for (const [id, value] of documents) if (value.owner === owner.id) documents.delete(id)
}

export async function saveVisual(owner: BrowserWindow, id: string): Promise<void> {
  const document = documents.get(id)
  if (!document || document.owner !== owner.webContents.id) throw new Error('Visual unavailable.')
  const confirmation = await dialog.showMessageBox(owner, {
    type: 'warning',
    title: 'Sophon export confirmation',
    noLink: true,
    message: document.svg ? 'Export generated SVG?' : 'Export active HTML?',
    detail: document.svg
      ? 'SVG files can contain active content when opened outside Sophon. Inspect the file before sharing or opening it in another application.'
      : 'This file contains executable JavaScript. Opening it outside Sophon uses your browser’s security policy; Sophon’s iframe and IPC isolation do not travel with the file.',
    buttons: ['Cancel', document.svg ? 'Export SVG' : 'Export HTML'],
    defaultId: 0,
    cancelId: 0
  })
  if (confirmation.response !== 1) return
  const result = await dialog.showSaveDialog(owner, {
    title: document.svg ? 'Export Sophon diagram' : 'Export Sophon visual',
    defaultPath: document.svg ? 'sophon-diagram.svg' : 'sophon-visual.html',
    filters: [
      {
        name: document.svg ? 'SVG diagram' : 'HTML visual',
        extensions: [document.svg ? 'svg' : 'html']
      }
    ]
  })
  if (result.canceled || !result.filePath) return
  const policy = VISUAL_POLICY.replace('; sandbox allow-scripts', '')
  const html = document.html.replace(
    /<head\b[^>]*>/i,
    (tag) => tag + `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  )
  await writeFile(result.filePath, document.svg ?? html, 'utf8')
}
