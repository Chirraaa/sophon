import { app, screen } from 'electron'
import { cpus, freemem, totalmem, type, release, arch } from 'os'
export async function hardwareInfo(): Promise<HardwareInfo> {
  const processors = cpus()
  const info = await app.getGPUInfo('complete').catch(() => ({}))
  const gpu = info as {
    gpuDevice?: {
      deviceString?: string
      vendorString?: string
      vendorId?: number
      deviceId?: number
    }[]
  }
  const vendors: Record<number, string> = { 4318: 'NVIDIA', 4098: 'AMD', 32902: 'Intel' }
  return {
    os: `${type()} ${release()} · ${arch()}`,
    cpu: processors[0]?.model.trim() || 'Unknown processor',
    logicalCores: processors.length,
    memoryTotal: totalmem(),
    memoryFree: freemem(),
    graphics: (gpu.gpuDevice ?? []).map(
      (device) =>
        device.deviceString ||
        device.vendorString ||
        `${vendors[device.vendorId ?? 0] ?? 'Graphics adapter'} · ${device.deviceId?.toString(16) ?? 'unknown'}`
    ),
    displays: screen.getAllDisplays().map((display) => ({
      name: display.label || 'Display ' + display.id,
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
      scale: display.scaleFactor,
      refreshRate: display.displayFrequency,
      primary: display.id === screen.getPrimaryDisplay().id
    }))
  }
}
