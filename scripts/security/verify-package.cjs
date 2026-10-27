const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const { getCurrentFuseWire } = require('@electron/fuses')
const { load, root } = require('./load.cjs')
const directory = path.join(root, '.cache/security-package')
const unpacked = path.join(directory, 'win-unpacked')
const archive = path.join(unpacked, 'resources/app.asar')
const executable = path.join(unpacked, 'Sophon.exe')
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
async function review() {
  const files = asar.listPackage(archive).map((file) => file.replaceAll('\\', '/'))
  assert(
    files.every(
      (file) => /^\/(?:out|node_modules|resources)(?:\/|$)/.test(file) || file === '/package.json'
    ),
    'Package includes unexpected project files'
  )
  assert(!files.some((file) => /^\/(?:\.cache|\.git|src|scripts)(?:\/|$)/.test(file)))
  const allowedPackages = ['@electron-toolkit/utils', '@koromix/koffi-win32-x64', 'koffi']
  for (const file of files.filter((value) => value.startsWith('/node_modules/'))) {
    assert(
      ['/node_modules/@electron-toolkit', '/node_modules/@koromix'].includes(file) ||
        allowedPackages.some(
          (name) => file === `/node_modules/${name}` || file.startsWith(`/node_modules/${name}/`)
        ),
      `Unreviewed production package path: ${file}`
    )
    assert(
      !file.slice('/node_modules/'.length).includes('/node_modules/'),
      `Nested production module path: ${file}`
    )
  }
  const packageRoots = files.filter((file) =>
    /\/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file)
  )
  const packageNames = packageRoots
    .map((file) => {
      const match = file.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/)
      assert(match, `Nested production dependency is not allowed: ${file}`)
      const manifest = JSON.parse(
        asar.extractFile(archive, file.slice(1).split('/').join(path.sep))
      )
      assert.equal(manifest.name, match[1])
      return manifest.name
    })
    .sort()
  assert.deepEqual(
    packageNames,
    allowedPackages.sort(),
    'Production packages must match the reviewed exact allowlist'
  )

  const sbomInput = path.join(directory, 'sbom-input')
  for (const name of ['/package.json', ...packageRoots]) {
    const destination = path.join(sbomInput, name.slice(1))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(
      destination,
      asar.extractFile(archive, name.slice(1).split('/').join(path.sep))
    )
  }
  fs.mkdirSync(path.join(sbomInput, 'node_modules/electron'), { recursive: true })
  fs.writeFileSync(
    path.join(sbomInput, 'node_modules/electron/package.json'),
    JSON.stringify({ name: 'electron', version: require('electron/package.json').version })
  )
  for (const file of [
    'out/main/index.js',
    'out/preload/index.js',
    'out/renderer/index.html',
    'out/renderer/parser.html'
  ])
    assert(
      asar
        .extractFile(archive, file.split('/').join(path.sep))
        .equals(fs.readFileSync(path.join(root, file))),
      `${file} does not match the checked build`
    )
  const html = asar.extractFile(archive, path.join('out', 'renderer', 'index.html')).toString()
  assert(html.includes("connect-src 'none'") && !html.includes('ws://'))
  const fuses = await getCurrentFuseWire(executable)
  const expected = { 0: false, 1: true, 2: false, 3: false, 4: true, 5: true, 7: false }
  for (const [index, enabled] of Object.entries(expected))
    assert.equal(fuses[index], enabled ? 49 : 48, `Incorrect fuse ${index}`)
  const { VOICE_HASHES } = load('src/main/voice/integrity.ts', {
    './manifest.json': { default: require('../../src/main/voice/manifest.json') },
    electron: {},
    fs,
    'fs/promises': require('node:fs/promises'),
    crypto,
    path,
    '../security/workspace-handles': {}
  })
  for (const [name, hash] of Object.entries(VOICE_HASHES))
    assert.equal(
      digest(fs.readFileSync(path.join(unpacked, 'resources/whisper', name))),
      hash,
      name
    )
  const evidence = {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    executableSha256: digest(fs.readFileSync(executable)),
    asarSha256: digest(fs.readFileSync(archive)),
    mainSha256: digest(fs.readFileSync(path.join(root, 'out/main/index.js'))),
    fuses,
    nativeResources: VOICE_HASHES,
    asarFiles: files.length,
    productionPackages: packageNames,
    releaseStatus:
      'Local test package. Authenticode signing and deployment review are separate requirements.'
  }
  fs.writeFileSync(
    path.join(directory, 'security-evidence.json'),
    JSON.stringify(evidence, null, 2)
  )
  console.log(
    'PASS package contents, exact build hashes, production CSP, hardened fuse bytes, and all bundled Whisper/model hashes'
  )
  console.log('Evidence: ' + path.join(directory, 'security-evidence.json'))
}
review().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
