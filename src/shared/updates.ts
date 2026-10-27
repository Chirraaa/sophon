export interface AppRelease {
  version: string
  title: string
  notes: string
  url: string
}

export interface AppUpdateState {
  currentVersion: string
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error'
  release: AppRelease | null
  installedRelease: AppRelease | null
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null
  checkedAt: string | null
  error: string | null
}

export interface UpdatesApi {
  get: () => Promise<AppUpdateState>
  check: () => Promise<AppUpdateState>
  download: () => Promise<AppUpdateState>
  install: () => Promise<AppUpdateState>
  acknowledge: () => Promise<AppUpdateState>
  onChange: (callback: (state: AppUpdateState) => void) => () => void
}
