const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const runtime = require('builder-util-runtime')
const { load, root } = require('./security/load.cjs')

async function main() {
  const output = path.join(root, '.cache/update-regression')
  fs.mkdirSync(output, { recursive: true })
  const profile = fs.mkdtempSync(path.join(output, 'profile-'))
  let version = '1.0.0'
  let offline = false
  let noNotes = false
  let busy = false
  let diskFull = false
  let prepared = 0
  const requests = []
  const { UpdateService } = load('src/main/services/updates.ts', {
    electron: { app: { getVersion: () => version, getPath: () => profile } },
    fs: {
      ...fs,
      writeFileSync: (...args) => {
        if (diskFull) throw new Error('Disk full')
        return fs.writeFileSync(...args)
      }
    },
    path,
    '../network/json-request': {
      requestJson: async (url, options) => {
        requests.push({ url: url.href, options })
        assert.equal(options.headers.Authorization, undefined)
        if (noNotes) throw new Error('GitHub rate limit')
        return {
          name: 'A better Sophon',
          body: '## Fixes\n\n- **Faster** startup\n- Reliable downloads\n\n| Area | Change |\n| --- | --- |\n| Chat | Improved |'
        }
      }
    }
  })
  class FakeUpdater extends EventEmitter {
    latest = '1.1.0'
    downloads = 0
    installs = 0
    checks = 0
    hold = null
    setFeedURL(feed) {
      assert.deepEqual(feed, {
        provider: 'github',
        owner: 'Chirraaa',
        repo: 'sophon',
        private: false
      })
    }
    async checkForUpdates() {
      this.checks++
      this.emit('checking-for-update')
      if (this.hold) await this.hold
      if (offline) throw new Error('Disconnected')
      this.emit(this.latest === version ? 'update-not-available' : 'update-available', {
        version: this.latest
      })
      return { updateInfo: { version: this.latest } }
    }
    async downloadUpdate() {
      this.downloads++
      if (offline) {
        this.emit('error', new Error('Disconnected'))
        throw new Error('Disconnected')
      }
      this.emit('download-progress', {
        percent: 42,
        total: 100,
        transferred: 42,
        bytesPerSecond: 5
      })
      this.emit('update-downloaded', { version: this.latest })
      return ['installer.exe']
    }
    quitAndInstall(silent, run) {
      assert.equal(silent, true)
      assert.equal(run, true)
      this.installs++
    }
  }
  const updater = new FakeUpdater()
  const states = []
  const service = new UpdateService(
    updater,
    (state) => states.push(state),
    () => busy,
    () => prepared++
  )
  const stop = service.start()
  try {
    assert.equal(updater.autoDownload, false)
    assert.equal(updater.autoInstallOnAppQuit, false)
    assert.equal(updater.allowDowngrade, false)
    assert.equal(updater.allowPrerelease, false)
    assert.equal(updater.disableWebInstaller, true)
    let releaseCheck
    updater.hold = new Promise((resolve) => {
      releaseCheck = resolve
    })
    const check = service.check()
    assert.equal(service.get().status, 'checking')
    await service.check()
    assert.equal(updater.checks, 1, 'duplicate checks are ignored')
    releaseCheck()
    await check
    updater.hold = null
    assert.equal(service.get().status, 'available')
    assert.equal(service.get().release.title, 'A better Sophon')
    assert.match(requests[0].url, /releases\/tags\/v1\.1\.0$/)
    offline = true
    await service.download()
    assert.equal(service.get().status, 'error')
    assert.match(service.get().error, /connection/)
    offline = false
    diskFull = true
    await service.download()
    assert.equal(service.get().status, 'error')
    assert.match(service.get().error, /disk space/)
    await service.install()
    assert.equal(updater.installs, 0)
    diskFull = false
    await service.download()
    assert.equal(service.get().status, 'ready')
    assert(states.some((state) => state.progress?.percent === 42))
    await service.check()
    assert.equal(service.get().status, 'ready', 'a check cannot replace a downloaded update')
    const pending = JSON.parse(fs.readFileSync(path.join(profile, 'pending-update.json')))
    assert.match(pending.notes, /## Fixes/)
    assert.equal(
      new UpdateService(
        null,
        () => {},
        () => false,
        () => {}
      ).get().installedRelease,
      null,
      'old version never announces success'
    )
    busy = true
    await service.install()
    assert.equal(updater.installs, 0)
    assert.equal(service.get().status, 'ready')
    assert.match(service.get().error, /current task/)
    busy = false
    await service.install()
    assert.equal(updater.installs, 1)
    assert.equal(prepared, 1)
    version = '1.1.0'
    const restarted = new UpdateService(
      null,
      () => {},
      () => false,
      () => {}
    )
    assert.equal(restarted.get().installedRelease.version, version)
    assert.match(restarted.get().installedRelease.notes, /\*\*Faster\*\*/)
    await restarted.acknowledge()
    assert.equal(
      new UpdateService(
        null,
        () => {},
        () => false,
        () => {}
      ).get().installedRelease,
      null
    )
    assert(!fs.existsSync(path.join(profile, 'pending-update.json')))
  } finally {
    stop()
  }

  const next = new FakeUpdater()
  const current = new UpdateService(
    next,
    () => {},
    () => false,
    () => {}
  )
  const stopNext = current.start()
  try {
    await current.check()
    assert.equal(current.get().status, 'idle')
    next.latest = '1.2.0'
    noNotes = true
    await current.check()
    assert.equal(
      current.get().status,
      'available',
      'unavailable release notes cannot block updates'
    )
    assert.equal(current.get().release.notes, '')
    await current.download()
    assert.equal(current.get().status, 'ready')
    // Acknowledge older installed notes without erasing the newer pending update.
    await current.acknowledge()
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(profile, 'pending-update.json'))).version,
      '1.2.0'
    )
    const quitFlags = []
    const failingUpdater = new FakeUpdater()
    failingUpdater.latest = '1.2.0'
    const failingInstall = new UpdateService(
      failingUpdater,
      () => {},
      () => false,
      (flag) => quitFlags.push(flag)
    )
    await failingInstall.check()
    await failingInstall.download()
    failingUpdater.quitAndInstall = () => {
      throw new Error('Installer could not launch')
    }
    await failingInstall.install()
    assert.equal(failingInstall.get().status, 'error')
    assert.deepEqual(
      quitFlags,
      [true, false],
      'failed installation restores normal window-close behavior'
    )
    offline = true
    const another = new UpdateService(
      new FakeUpdater(),
      () => {},
      () => false,
      () => {}
    )
    await another.check()
    assert.equal(another.get().status, 'error')
    assert.equal(another.get().release, null)
  } finally {
    stopNext()
  }

  // Exercise the actual updater/provider with the Node transport, not a mocked
  // electron-updater implementation. No Electron net session or network required.
  const body = Buffer.from('a checksum-verified installer fixture')
  const hash = crypto.createHash('sha512').update(body).digest('base64')
  let networkCalls = 0
  const transport = load('src/main/services/update-transport.ts', {
    'electron-updater': require('electron-updater'),
    'builder-util-runtime': runtime,
    https: {
      request: (options, callback) => {
        networkCalls++
        const req = new EventEmitter()
        req.abort = () => {}
        req.end = () =>
          queueMicrotask(() => {
            const res = new PassThrough()
            res.statusCode = 200
            res.headers = {}
            let payload = ''
            if (options.path.endsWith('.atom'))
              payload =
                '<feed><entry><title>Release</title><link href="https://github.com/Chirraaa/sophon/releases/tag/v1.2.0"/><content>Notes</content></entry></feed>'
            else if (options.path.endsWith('/latest'))
              payload = JSON.stringify({ tag_name: 'v1.2.0' })
            else if (options.path.includes('latest.yml'))
              payload = `version: 1.2.0\nfiles:\n  - url: fixture.exe\n    sha512: ${hash}\n    size: ${body.length}\nreleaseDate: '2026-10-27T00:00:00Z'\n`
            else if (options.path === '/redirect') {
              res.statusCode = 302
              res.headers.location = 'https://evil.example/installer.exe'
            } else if (options.path === '/loop') {
              res.statusCode = 302
              res.headers.location = 'https://github.com/loop'
            } else payload = body
            res.headers['content-length'] = Buffer.byteLength(payload)
            callback(res)
            res.end(payload)
          })
        return req
      }
    }
  })
  const real = new transport.GithubUpdater(null, {
    version: '1.1.0',
    name: 'sophon-test',
    isPackaged: true,
    userDataPath: profile,
    baseCachePath: profile,
    appUpdateConfigPath: path.join(profile, 'app-update.yml'),
    whenReady: async () => {},
    onQuit: () => {}
  })
  real.logger = null
  real.autoDownload = false
  real.allowPrerelease = false
  real.setFeedURL({ provider: 'github', owner: 'Chirraaa', repo: 'sophon', private: false })
  assert(real.httpExecutor instanceof transport.GithubUpdateTransport)
  assert.equal((await real.checkForUpdates()).updateInfo.version, '1.2.0')
  assert(networkCalls >= 3, 'real provider must use injected transport for release metadata')
  const destination = path.join(profile, 'fixture.exe')
  const options = () => ({ cancellationToken: new runtime.CancellationToken(), sha512: hash })
  const progress = []
  await real.httpExecutor.download(new URL('https://github.com/installer.exe'), destination, {
    ...options(),
    onProgress: (value) => progress.push(value)
  })
  assert.deepEqual(fs.readFileSync(destination), body)
  assert(progress.some((value) => value.percent === 100))
  await assert.rejects(
    real.httpExecutor.download(new URL('https://github.com/installer.exe'), destination, {
      ...options(),
      sha512: Buffer.alloc(64).toString('base64')
    }),
    /sha512 checksum mismatch/
  )
  await assert.rejects(
    real.httpExecutor.download(new URL('https://github.com/redirect'), destination, options()),
    /approved GitHub/
  )
  await assert.rejects(
    real.httpExecutor.download(new URL('https://github.com/loop'), destination, options()),
    /Too many redirects/
  )
  await assert.rejects(
    real.httpExecutor.request({ protocol: 'https:', hostname: 'github.com', path: '/loop' }),
    /Too many redirects/
  )
  for (const url of [
    'http://github.com/file',
    'https://evil.example/file',
    'https://github.com:444/file',
    'https://127.0.0.1/file'
  ]) {
    await assert.rejects(
      real.httpExecutor.download(new URL(url), destination, options()),
      /approved GitHub/
    )
  }
  console.log(
    'Update checks, retries, progress, restart persistence, acknowledgement, real GitHub provider, checksums and transport restrictions passed.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
