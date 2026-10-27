const assert = require('node:assert/strict')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { load } = require('./security/load.cjs')

const rows = [
  { Name: 'Google Chrome', AppID: 'Chrome', Executable: 'chrome.exe' },
  { Name: 'Visual Studio Code', AppID: 'Microsoft.VisualStudioCode' },
  { Name: 'Visual Studio', AppID: 'Microsoft.VisualStudio' },
  { Name: 'Éditeur (日本語)', AppID: 'Example_123!App' },
  { Name: 'Duplicate', AppID: 'Duplicate.One' },
  { Name: 'Duplicate', AppID: 'Duplicate.Two' }
]
let blocked = ''
let active = true
const runs = {
  currentRun: () => (active ? { id: 'test' } : undefined),
  assertRun: () => {
    if (!active) throw new Error('Task cancelled')
  }
}
const permissions = {
  blockedAppRule: (...names) =>
    blocked && names.some((name) => name.toLowerCase().includes(blocked)) ? blocked : null
}
let discoveries = 0
const catalog = load('src/main/tools/app-catalog.ts', {
  child_process: {
    execFile: (file, args, options, callback) => {
      discoveries++
      assert.equal(path.basename(file), 'powershell.exe')
      assert.equal(options.windowsHide, true)
      assert.equal(args[2], '-EncodedCommand')
      const script = Buffer.from(args[3], 'base64').toString('utf16le')
      assert.match(script, /Get-StartApps/)
      assert.doesNotMatch(script, /Chrome|Visual Studio/)
      callback(null, JSON.stringify(rows))
    }
  },
  crypto,
  path,
  '../permissions': permissions,
  '../security/run-manager': runs
})
const launched = []
const windows = {
  windowReference: () => 'win-owned-chrome',
  listWindows: () => [
    { hwnd: 1, exe: 'chrome.exe', title: 'Chrome', state: 'normal', width: 800, height: 600 }
  ]
}
const launcher = load('src/main/tools/openApp.ts', {
  child_process: {
    spawn: (file, args, options) => {
      launched.push({ file, args, options })
      const child = new EventEmitter()
      child.unref = () => {}
      setImmediate(() => child.emit('spawn'))
      return child
    }
  },
  path,
  './windows': windows,
  './app-catalog': catalog,
  '../permissions': permissions,
  '../security/run-manager': runs
})
const local = load('src/main/security/local-action.ts', {
  '../network/search-provider': {},
  '../tools/windows': windows,
  '../tools/openApp': launcher,
  '../tools/win32': {},
  '../permissions': permissions,
  '../tools/automation/controls': {},
  '../tools/files': {},
  '../tools/screen': {},
  'fs/promises': {},
  path,
  './run-manager': runs,
  './workspace-policy': {}
})

async function main() {
  const apps = await catalog.installedApps()
  assert.equal(apps.length, rows.length)
  assert.equal(catalog.matchingApps(apps, 'Code')[0].name, 'Visual Studio Code')
  assert.equal(catalog.matchingApps(apps, 'Visual Studio')[0].appId, 'Microsoft.VisualStudio')
  assert.equal(catalog.matchingApps(apps, 'Visual').length, 2)
  assert.equal(catalog.matchingApps(apps, 'Duplicate').length, 2)
  assert.equal(catalog.matchingApps(apps, '日本語')[0].name, 'Éditeur (日本語)')
  assert.equal(catalog.matchingApps(apps, apps[0].id)[0].id, apps[0].id)
  assert.deepEqual(catalog.parseApps('null'), [])
  assert.deepEqual(
    catalog.parseApps(
      JSON.stringify([
        { Name: 'Bad\nname', AppID: 'x' },
        { Name: 'Bad', AppID: 'a"b' }
      ])
    ),
    []
  )
  assert.equal(catalog.parseApps(JSON.stringify(rows[0])).length, 1)
  assert.equal(
    catalog.parseApps(JSON.stringify({ Name: 'Tool', AppID: '{folder}\\Vendor\\tool.exe' }))[0]
      .executable,
    'tool.exe'
  )
  assert.equal(apps.find((app) => app.name === 'Google Chrome').executable, 'chrome.exe')
  assert.match(await catalog.listApps('Code'), /Visual Studio Code/)
  assert.equal(discoveries, 1, 'Catalog cached')
  blocked = 'chrome'
  assert.doesNotMatch(await catalog.listApps(), /Google Chrome/)
  assert.match(await launcher.openApp('Chrome'), /^Blocked/)
  blocked = ''
  assert.match(await launcher.openApp('Visual'), /^Could not choose/)
  for (const query of ['__proto__', 'constructor', 'cmd /c calc', 'Chrome & calc', 'C:\\evil.exe'])
    assert.match(await launcher.openApp(query), /^Failed to find installed app/)
  assert.equal(launched.length, 0)

  const bound = await local.bindLocalAction('open_app', { name: 'Chrome' }, { id: 'test' })
  assert.match(bound.preview, /Google Chrome/)
  assert.equal(bound.scope.app.appId, 'Chrome')
  blocked = 'chrome'
  await assert.rejects(bound.revalidate(), /blocked/)
  blocked = ''
  await bound.revalidate()
  assert.equal(
    await launcher.openApp('Chrome', bound.scope.app),
    'Opened Google Chrome. Window: win-owned-chrome "Chrome".'
  )
  assert.equal(path.basename(launched[0].file), 'explorer.exe')
  assert.deepEqual(launched[0].args, ['shell:AppsFolder\\Chrome'])
  assert.equal(launched[0].options.shell, false)
  assert.equal(launched[0].options.windowsHide, false)
  active = false
  assert.match(await launcher.openApp('Chrome'), /^Denied/)
  assert.match(await catalog.listApps(), /^Denied/)
  await assert.rejects(bound.revalidate(), /cancelled/)
  assert.equal(launched.length, 1)
  console.log(
    'Installed app discovery, resolution, launch identity, blocked rules and cancellation checks passed.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
