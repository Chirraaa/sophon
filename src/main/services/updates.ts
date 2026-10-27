import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import type { NsisUpdater } from 'electron-updater'
import type { AppRelease, AppUpdateState } from '../../shared/updates'
import { requestJson } from '../network/json-request'

const repository = 'https://github.com/Chirraaa/sophon'

export class UpdateService {
  private state: AppUpdateState
  private readonly pendingFile = join(app.getPath('userData'), 'pending-update.json')

  constructor(
    private readonly updater: NsisUpdater | null,
    private readonly publish: (state: AppUpdateState) => void,
    private readonly busy: () => boolean,
    private readonly prepareToQuit: (quitting: boolean) => void
  ) {
    this.state = {
      currentVersion: app.getVersion(),
      status: updater ? 'idle' : 'disabled',
      release: null,
      installedRelease: null,
      progress: null,
      checkedAt: null,
      error: null
    }
    try {
      const pending = JSON.parse(readFileSync(this.pendingFile, 'utf8')) as AppRelease
      if (
        pending.version === this.state.currentVersion &&
        typeof pending.notes === 'string' &&
        pending.notes.length <= 200_000 &&
        typeof pending.title === 'string' &&
        pending.title.length <= 300 &&
        typeof pending.url === 'string' &&
        pending.url.startsWith(`${repository}/releases/`)
      )
        this.state.installedRelease = pending
    } catch {
      /* First launch or interrupted metadata write: no successful update to announce. */
    }
    if (!updater) return
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.logger = null
    updater.setFeedURL({ provider: 'github', owner: 'Chirraaa', repo: 'sophon', private: false })
    updater.on('error', () => this.fail())
    updater.on('checking-for-update', () => {
      this.availableVersion = null
    })
    updater.on('update-available', (info) => {
      this.availableVersion = info.version
    })
    updater.on('download-progress', (progress) =>
      this.set({
        progress: {
          percent: Math.max(0, Math.min(100, progress.percent)),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        }
      })
    )
    updater.on('update-downloaded', (info) => {
      const release = this.state.release
      if (!release || release.version !== info.version) return this.fail()
      try {
        // Persist before offering restart. A failed install cannot announce success:
        // the next launch must match this exact downloaded version.
        const temporary = `${this.pendingFile}.tmp`
        writeFileSync(temporary, JSON.stringify(release), { mode: 0o600 })
        renameSync(temporary, this.pendingFile)
        this.set({ status: 'ready', progress: null, error: null })
      } catch {
        this.fail(
          'Could not save the update details. Check available disk space, then retry the download.'
        )
      }
    })
  }

  get = (): AppUpdateState => structuredClone(this.state)

  private set(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.publish(this.get())
  }

  private fail(
    message = 'The update could not be completed. Check your connection and try again. If it keeps failing, download the latest installer from GitHub Releases.'
  ): void {
    if (this.state.status === 'installing') this.prepareToQuit(false)
    this.set({ status: 'error', progress: null, error: message })
  }

  check = async (): Promise<AppUpdateState> => {
    if (
      !this.updater ||
      ['checking', 'downloading', 'ready', 'installing'].includes(this.state.status)
    )
      return this.get()
    this.set({ status: 'checking', release: null, error: null, progress: null })
    try {
      const result = await this.updater.checkForUpdates()
      if (!result) throw new Error('Updater unavailable')
      const info = result.updateInfo
      // The updater makes the semantic-version/OS/staged-rollout decision.
      // checkForUpdates emits update-available only when this installation qualifies.
      if (!this.availableVersion || this.availableVersion !== info.version) {
        this.set({ status: 'idle', release: null, checkedAt: new Date().toISOString() })
      } else {
        const release = await this.releaseDetails(info.version)
        this.set({ status: 'available', release, checkedAt: new Date().toISOString() })
      }
    } catch {
      this.fail()
    }
    return this.get()
  }

  private availableVersion: string | null = null

  start(): () => void {
    const initial = setTimeout(() => void this.check(), 15_000)
    const periodic = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
    initial.unref()
    periodic.unref()
    return () => {
      clearTimeout(initial)
      clearInterval(periodic)
    }
  }

  private async releaseDetails(version: string): Promise<AppRelease> {
    for (const tag of [`v${version}`, version]) {
      try {
        const details = (await requestJson(
          new URL(
            `https://api.github.com/repos/Chirraaa/sophon/releases/tags/${encodeURIComponent(tag)}`
          ),
          {
            headers: { 'User-Agent': 'Sophon-updater', Accept: 'application/vnd.github+json' },
            timeout: 10_000,
            maxBytes: 500_000
          }
        )) as { body?: unknown; name?: unknown; draft?: boolean; prerelease?: boolean }
        if (details.draft || details.prerelease) continue
        return {
          version,
          title:
            typeof details.name === 'string' ? details.name.slice(0, 300) : `Sophon ${version}`,
          notes: typeof details.body === 'string' ? details.body.slice(0, 200_000) : '',
          url: `${repository}/releases/tag/${encodeURIComponent(tag)}`
        }
      } catch {
        /* Try tags without v; release-note availability must not block updates. */
      }
    }
    return { version, title: `Sophon ${version}`, notes: '', url: `${repository}/releases` }
  }

  download = async (): Promise<AppUpdateState> => {
    if (!this.updater || !this.state.release || !['available', 'error'].includes(this.state.status))
      return this.get()
    this.set({ status: 'downloading', error: null, progress: null })
    try {
      await this.updater.downloadUpdate()
    } catch {
      this.fail()
    }
    return this.get()
  }

  install = async (): Promise<AppUpdateState> => {
    if (!this.updater || this.state.status !== 'ready') return this.get()
    if (this.busy()) {
      this.set({ error: 'Finish or stop the current task and voice recording before restarting.' })
      return this.get()
    }
    this.set({ status: 'installing', error: null })
    try {
      this.prepareToQuit(true)
      this.updater.quitAndInstall(true, true)
    } catch {
      this.fail()
    }
    return this.get()
  }

  acknowledge = async (): Promise<AppUpdateState> => {
    try {
      // Never erase a newer pending download when acknowledging older notes.
      if (this.state.installedRelease && existsSync(this.pendingFile)) {
        const pending = JSON.parse(readFileSync(this.pendingFile, 'utf8')) as AppRelease
        if (pending.version === this.state.installedRelease.version) unlinkSync(this.pendingFile)
      }
      this.set({ installedRelease: null })
    } catch {
      this.set({
        error: 'Could not dismiss the release notes. Check available disk space and try again.'
      })
    }
    return this.get()
  }
}
