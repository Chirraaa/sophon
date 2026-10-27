import { createServer, type Server } from 'net'
import type { Session, WebContents } from 'electron'

let sink: Server | undefined
let ready: Promise<number> | undefined
async function denyProxy(): Promise<number> {
  ready ??= new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy())
    sink = server
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not create Chromium deny proxy.'))
        return
      }
      server.unref()
      resolve(address.port)
    })
  })
  return ready
}
export async function lockChromiumSession(session: Session, development?: URL): Promise<void> {
  const port = await denyProxy()

  await session.setProxy({
    mode: 'fixed_servers',
    proxyRules: `http://127.0.0.1:${port}`,
    proxyBypassRules: ['<-loopback>', ...(development ? [development.host] : [])].join(';')
  })
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.on('will-download', (event) => event.preventDefault())
}
export function lockWebRtc(contents: WebContents): void {
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
}
export function closeChromiumEgress(): void {
  sink?.close()
  sink = undefined
  ready = undefined
}
