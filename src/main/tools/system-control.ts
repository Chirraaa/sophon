import { createHash } from 'crypto'
import { systemControlWorker } from './system-control-worker'
import { assertRun, type RunContext } from '../security/run-manager'
import { blockedAppRule, protectedWindowRule } from '../permissions'
import { listWindows } from './windows'

type Audio = {
  endpoint: string
  session: string
  name: string
  pid: number
  volume: number
  muted: boolean
}
type Radio = { name: string; kind: 'WiFi' | 'Bluetooth'; state: string }
export type DeviceTarget = Audio | Radio

async function query<T>(request: Record<string, unknown>, run: RunContext): Promise<T[]> {
  assertRun(run)
  const response = (await systemControlWorker(request, run.signal)) as {
    ok: boolean
    error?: string
    items: T[]
  }
  assertRun(run)
  if (!response.ok) throw new Error(response.error || 'Windows device control failed.')
  if (!Array.isArray(response.items)) throw new Error('Invalid Windows device response.')
  return response.items
}
function audioRef(row: Audio): string {
  return row.session
    ? 'audio-' +
        createHash('sha256')
          .update(JSON.stringify([row.endpoint, row.session]))
          .digest('hex')
          .slice(0, 24)
    : 'system'
}
function allowed(row: Audio): boolean {
  if (!row.session) return true
  return (
    !blockedAppRule(row.name) &&
    !protectedWindowRule('', row.name) &&
    !listWindows().some(
      (w) => w.exe.toLowerCase() === row.name.toLowerCase() && protectedWindowRule(w.title, w.exe)
    )
  )
}
export async function listAudio(run: RunContext): Promise<string> {
  const rows = (await query<Audio>({ operation: 'audio' }, run)).filter(allowed)
  return JSON.stringify(
    rows.map((row) => ({
      target: audioRef(row),
      app: row.name,
      volume: row.volume,
      muted: row.muted
    }))
  )
}
export async function listRadios(run: RunContext): Promise<string> {
  return JSON.stringify(await query<Radio>({ operation: 'radios' }, run))
}
export async function prepareDeviceTarget(
  name: string,
  args: Record<string, unknown>,
  run: RunContext
): Promise<DeviceTarget> {
  if (name === 'set_volume') {
    const rows = await query<Audio>({ operation: 'audio' }, run)
    const target = String(args.target ?? 'system')
      .toLowerCase()
      .replace(/\.exe$/, '')
    const matches = rows.filter(
      (row) =>
        audioRef(row) === target ||
        (row.session && row.name.toLowerCase().replace(/\.exe$/, '') === target)
    )
    if (matches.length !== 1)
      throw new Error(
        'Audio target missing or ambiguous. Use list_audio and choose an exact audio- reference. Apps need an existing audio session.'
      )
    if (!allowed(matches[0])) throw new Error('This app is blocked or protected.')
    return matches[0]
  }
  const kind = args.kind === 'wifi' ? 'WiFi' : 'Bluetooth'
  const rows = await query<Radio>({ operation: 'radios' }, run)
  const matches = rows.filter(
    (row) => row.kind === kind && (args.name === undefined || row.name === args.name)
  )
  if (matches.length !== 1)
    throw new Error('Radio missing or ambiguous. Use list_radios and choose an exact device name.')
  return matches[0]
}
export async function revalidateDeviceTarget(target: DeviceTarget, run: RunContext): Promise<void> {
  if ('endpoint' in target) {
    const rows = await query<Audio>({ operation: 'audio' }, run)
    const now = rows.find(
      (row) =>
        row.endpoint === target.endpoint &&
        row.session === target.session &&
        row.pid === target.pid &&
        row.name === target.name
    )
    if (!now || !allowed(now))
      throw new Error('The approved audio target changed or is protected. Start a new action.')
  } else {
    const rows = await query<Radio>({ operation: 'radios' }, run)
    if (rows.filter((row) => row.kind === target.kind && row.name === target.name).length !== 1)
      throw new Error('The approved radio changed. Start a new action.')
  }
}
export async function setDevice(
  args: Record<string, unknown>,
  target: DeviceTarget | undefined,
  run: RunContext
): Promise<string> {
  if (!target) throw new Error('An approved device target is required.')
  await revalidateDeviceTarget(target, run)
  if ('endpoint' in target) {
    const rows = await query<Audio>(
      {
        operation: 'volume',
        endpoint: target.endpoint,
        session: target.session,
        volume: args.volume,
        muted: args.muted
      },
      run
    )
    const row = rows[0]
    if (
      !row ||
      (args.volume !== undefined && Math.abs(row.volume - Number(args.volume)) > 1) ||
      (args.muted !== undefined && row.muted !== args.muted)
    )
      return 'Unverified: Windows accepted the audio request, but read-back did not confirm the requested settings. List audio before retrying.'
    return JSON.stringify({
      verified: true,
      app: target.name,
      volume: row.volume,
      muted: row.muted
    })
  }
  const rows = await query<Radio>(
    { operation: 'radio', kind: target.kind, name: target.name, enabled: args.enabled },
    run
  )
  const row = rows[0]
  return JSON.stringify({
    verified: row?.state === (args.enabled ? 'On' : 'Off'),
    ...row,
    ...(row?.state !== (args.enabled ? 'On' : 'Off')
      ? {
          message:
            'Requested state not confirmed. Hardware or Windows policy may prevent the change.'
        }
      : {})
  })
}
