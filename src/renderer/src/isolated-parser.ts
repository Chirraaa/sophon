import mermaid from 'mermaid'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import 'pdfjs-dist/build/pdf.worker.mjs'
GlobalWorkerOptions.workerSrc = 'unused'
declare global {
  var parseDocument: (input: {
    kind: string
    source?: string
    dataUrl?: string
    format?: string
  }) => Promise<string>
}
globalThis.parseDocument = async (input): Promise<string> => {
  if (input.kind === 'pdf') {
    if (!input.source || input.source.length > 12 * 1024 * 1024)
      throw new Error('Invalid PDF input.')

    const task = getDocument({
      data: Uint8Array.from(atob(input.source), (char) => char.charCodeAt(0)),
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
      maxImageSize: 16000000
    })
    const pdf = await task.promise
    try {
      if (pdf.numPages > 100) throw new Error('PDF exceeds the 100-page limit.')
      const pages: string[] = []
      let text = ''
      let output = 0
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        const content = await page.getTextContent()
        text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n\n'
        if (text.length > 1000000) throw new Error('PDF text exceeds its size limit.')
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.min(1.5, 1200 / base.width, 1600 / base.height)
        })
        if (
          !Number.isFinite(viewport.width + viewport.height) ||
          viewport.width <= 0 ||
          viewport.height <= 0
        )
          throw new Error('Invalid PDF page dimensions.')
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        const image = canvas.toDataURL('image/jpeg', 0.8)
        output += image.length
        if (output > 10 * 1024 * 1024) throw new Error('PDF preview exceeds its size limit.')
        pages.push(image)
        canvas.width = canvas.height = 0
        page.cleanup()
      }
      return JSON.stringify({ text, pages })
    } finally {
      await task.destroy()
    }
  }
  if (input.kind === 'diagram') {
    if (typeof input.source !== 'string' || input.source.length > 20000)
      throw new Error('Invalid diagram input.')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true
    })
    const { svg } = await mermaid.render('diagram', input.source)
    if (svg.length > 1000000) throw new Error('Diagram output is too large.')
    return svg
  }
  if (
    input.kind !== 'image' ||
    typeof input.dataUrl !== 'string' ||
    input.dataUrl.length > 12 * 1024 * 1024
  )
    throw new Error('Invalid image input.')
  const image = new Image()
  image.src = input.dataUrl
  await image.decode()
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > 16000000 ||
    Math.max(image.naturalWidth, image.naturalHeight) > 8192
  )
    throw new Error('Image dimensions exceed their budget.')
  const scale = Math.min(1, 1920 / image.naturalWidth, 1920 / image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No image canvas.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const result = canvas.toDataURL(input.format === 'png' ? 'image/png' : 'image/jpeg', 0.85)
  if (result.length > 11 * 1024 * 1024) throw new Error('Decoded image exceeds its output budget.')
  return result
}
