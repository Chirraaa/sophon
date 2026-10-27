import koffi from 'koffi'
import { request } from 'http'
const getTable = koffi
  .load('iphlpapi.dll')
  .func(
    'uint32 __stdcall GetExtendedTcpTable(void *table, _Inout_ uint32_t *size, bool order, uint32 family, int type, uint32 reserved)'
  )
export function ownsConnection(port: number, clientPort: number, pid: number): boolean {
  const size = new Uint32Array(1)
  getTable(null, size, false, 2, 5, 0)
  if (!size[0] || size[0] > 1024 * 1024) return false
  const bytes = Buffer.alloc(size[0])
  if (getTable(bytes, size, false, 2, 5, 0)) return false
  const count = bytes.readUInt32LE(0)
  for (let index = 0; index < count && 4 + (index + 1) * 24 <= bytes.length; index++) {
    const offset = 4 + index * 24
    if (
      bytes.readUInt32LE(offset) === 5 &&
      bytes.readUInt32LE(offset + 4) === 0x0100007f &&
      bytes.readUInt16BE(offset + 8) === port &&
      bytes.readUInt32LE(offset + 12) === 0x0100007f &&
      bytes.readUInt16BE(offset + 16) === clientPort &&
      bytes.readUInt32LE(offset + 20) === pid
    )
      return true
  }
  return false
}
export async function ownedJson(
  port: number,
  path: string,
  pid: number,
  signal: AbortSignal,
  body?: Buffer,
  contentType?: string
): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body ? 'POST' : 'GET',
        agent: false,
        signal,
        maxHeaderSize: 8192,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          ...(body ? { 'Content-Type': contentType!, 'Content-Length': body.length } : {})
        }
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !/^application\/json\b/i.test(response.headers['content-type'] ?? '') ||
          response.headers['content-encoding']
        ) {
          response.destroy()
          reject(new Error('Invalid response from owned voice service.'))
          return
        }
        let length = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          length += chunk.length
          if (length > 32768) {
            response.destroy(new Error('Voice response too large.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!data || typeof data !== 'object' || Array.isArray(data))
              throw new Error('Invalid voice JSON.')
            resolve(data)
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('socket', (socket) => {
      socket.once('connect', () => {
        if (!ownsConnection(port, socket.localPort!, pid)) {
          req.destroy(new Error('Voice socket is not owned by the verified process.'))
          return
        }
        req.end(body)
      })
    })
  })
}
