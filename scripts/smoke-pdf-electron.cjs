const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
protocol.registerSchemesAsPrivileged([
  { scheme: 'pdf-test', privileges: { standard: true, secure: true } }
])
app.whenReady().then(async () => {
  let win
  try {
    const root = path.resolve(__dirname, '../out/renderer')
    protocol.handle('pdf-test', async (request) => {
      const name = new URL(request.url).pathname.slice(1)
      assert.match(name, /^(?:parser\.html|assets\/[\w.-]+)$/)
      return new Response(await fs.readFile(path.join(root, name)), {
        headers: {
          'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/html',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'"
        }
      })
    })
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await win.loadURL('pdf-test://parser/parser.html')
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Length 46 >>\nstream\nBT /F1 18 Tf 20 100 Td (Quantum lesson) Tj ET\nendstream',
      '<< /S /JavaScript /JS (globalThis.PDF_EXECUTED=true) >>'
    ]
    let pdf = '%PDF-1.4\n'
    const offsets = [0]
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf))
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = Buffer.byteLength(pdf)
    pdf +=
      'xref\n0 7\n0000000000 65535 f \n' +
      offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
        .join('')
    pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    const input = { kind: 'pdf', source: Buffer.from(pdf).toString('base64') }
    const output = JSON.parse(
      await win.webContents.executeJavaScript(`parseDocument(${JSON.stringify(input)})`)
    )
    assert.match(output.text, /Quantum lesson/)
    assert.equal(output.pages.length, 1)
    assert.match(output.pages[0], /^data:image\/jpeg;base64,/)
    assert.equal(await win.webContents.executeJavaScript('globalThis.PDF_EXECUTED'), undefined)
    console.log('PASS PDF raster preview, text extraction and inactive embedded JavaScript')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    win?.destroy()
    app.exit(process.exitCode || 0)
  }
})
