const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { builtinModules } = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const lock = require('../package-lock.json')
const output = path.join(root, 'THIRD_PARTY_NOTICES.txt')
const roots = new Set(Object.keys(pkg.dependencies))
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
const assetsOnly = new Set(['shadcn', 'tailwindcss', 'tw-animate-css'])
const excluded = (name) =>
  name === 'electron' || name === 'vite' || name.startsWith('@napi-rs/canvas')
const normalize = (value) => value.replaceAll('\r\n', '\n').trim()

function addImport(name) {
  if (
    name.startsWith('.') ||
    name.startsWith('@/') ||
    name.startsWith('@renderer/') ||
    name.startsWith('virtual:') ||
    builtins.has(name.replace(/^node:/, ''))
  )
    return
  roots.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0])
}
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name)
    if (item.isDirectory()) scan(file)
    else if (/\.(tsx?|js)$/.test(item.name)) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          !node.importClause?.isTypeOnly
        )
          addImport(node.moduleSpecifier.text)
        if (
          ts.isExportDeclaration(node) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          !node.isTypeOnly
        )
          addImport(node.moduleSpecifier.text)
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        )
          addImport(node.arguments[0].text)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
}
scan(path.join(root, 'src'))
for (const name of ['@fontsource-variable/geist', ...assetsOnly]) roots.add(name)

function resolvePackage(name, from) {
  let directory = from
  while (true) {
    const file = path.join(directory, 'node_modules', name, 'package.json')
    if (fs.existsSync(file)) return path.dirname(file)
    if (directory === root) return undefined
    const parent = path.dirname(directory)
    if (parent === directory || path.relative(root, parent).startsWith('..')) return undefined
    directory = parent
  }
}
const packages = new Map()
function include(directory) {
  if (!directory || packages.has(directory)) return
  const info = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (excluded(info.name)) return
  const relative = path.relative(root, directory).replaceAll('\\', '/')
  if (lock.packages[relative]?.version !== info.version)
    throw new Error('Installed dependency differs from lockfile: ' + relative)
  packages.set(directory, info)
  if (assetsOnly.has(info.name)) return
  for (const name of Object.keys(info.dependencies ?? {})) {
    if (excluded(name)) continue
    const dependency = resolvePackage(name, directory)
    if (!dependency) throw new Error('Missing installed dependency: ' + info.name + ' -> ' + name)
    include(dependency)
  }
  for (const name of Object.keys(info.optionalDependencies ?? {}))
    if (!excluded(name)) include(resolvePackage(name, directory))
}
for (const name of [...roots].sort()) {
  if (excluded(name)) continue
  const directory = resolvePackage(name, root)
  if (!directory) throw new Error('Missing imported package: ' + name)
  include(directory)
}

function licenseFiles(directory, level = 0) {
  const result = []
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink() || item.name === 'node_modules' || item.name.startsWith('.')) continue
    const file = path.join(directory, item.name)
    if (item.isDirectory() && level < 3) result.push(...licenseFiles(file, level + 1))
    else if (item.isFile() && /^(licen[cs]e|copying|notice|copyright)([._-]|$)/i.test(item.name))
      result.push(file)
  }
  return result.sort()
}
const sections = [
  'SOPHON THIRD-PARTY NOTICES',
  'Sophon original material is licensed separately under LICENSE. The original licenses below govern third-party components; Sophon does not impose its noncommercial restriction on those components.',
  'Generated from installed, lockfile-matched production dependencies and source imports, plus CSS/font and copied UI component notices. Transitive dependencies may include material removed by bundling; inclusion is not a claim that every listed file ships. Build tools are not traversed solely because they produce output.',
  'Electron and Chromium notices accompany the installer as LICENSE.electron.txt and LICENSES.chromium.html. Keep those files with any portable distribution.',
  fs.readFileSync(path.join(root, 'legal', 'SOURCE_AVAILABILITY.md'), 'utf8')
]
const records = []
for (const [directory, info] of [...packages].sort(
  (a, b) => a[1].name.localeCompare(b[1].name) || a[1].version.localeCompare(b[1].version)
)) {
  let files = licenseFiles(directory)
  if (info.name === 'dompurify')
    files = files.filter((file) => path.basename(file) !== 'LICENSE-MPL')
  if (info.name === 'type-fest')
    files = files.filter((file) => path.basename(file) !== 'license-cc0')
  const blocks = files.map(
    (file) =>
      path.relative(directory, file).replaceAll('\\', '/') +
      '\n\n' +
      normalize(fs.readFileSync(file, 'utf8'))
  )
  if (!blocks.length && ['remark-math', 'rehype-katex'].includes(info.name))
    blocks.push(fs.readFileSync(path.join(root, 'legal', 'upstream', 'remark-math.txt'), 'utf8'))
  if (!blocks.length && info.name.startsWith('@koromix/koffi-'))
    blocks.push(fs.readFileSync(path.join(root, 'node_modules', 'koffi', 'LICENSE.txt'), 'utf8'))
  if (!blocks.length && info.name === 'lazy-val' && info.version === '1.0.5') {
    const mit = fs.readFileSync(
      path.join(root, 'node_modules', '@electron-toolkit', 'utils', 'LICENSE'),
      'utf8'
    )
    const at = mit.indexOf('Permission is hereby granted')
    if (at < 0) throw new Error('MIT reference text unavailable.')
    blocks.push(
      'Upstream lazy-val 1.0.5 package metadata declares MIT and author Vladimir Krivosheev. No separate license file is supplied in the npm package. Standard text of the declared MIT license follows; this attribution is from package metadata, not an invented upstream copyright notice.\n\n' +
        mit.slice(at)
    )
  }
  if (!blocks.length) throw new Error('No license text found: ' + info.name + '@' + info.version)
  let license = typeof info.license === 'string' ? info.license : info.license?.type
  if (!license && blocks.some((text) => /The MIT License|MIT License/.test(text)))
    license = 'MIT (identified from license file)'
  if (!license) throw new Error('Unidentified license: ' + info.name)
  const repo = typeof info.repository === 'string' ? info.repository : info.repository?.url
  records.push({
    name: info.name,
    version: info.version,
    license,
    repository: repo ?? info.homepage ?? ''
  })
  sections.push(
    [
      info.name + '@' + info.version,
      'Declared license: ' + license,
      'Source: ' + (repo ?? info.homepage ?? 'https://www.npmjs.com/package/' + info.name),
      ...blocks
    ].join('\n\n')
  )
}
const upstream = path.join(root, 'legal', 'upstream')
for (const item of require('../legal/upstream/sources.json')) {
  const contents = fs.readFileSync(path.join(upstream, item.file), 'utf8')
  if (crypto.createHash('sha256').update(contents).digest('hex') !== item.sha256)
    throw new Error('Supplemental license changed: ' + item.file)
  sections.push(item.file + '\nSource: ' + item.url + '\n\n' + normalize(contents))
}
function fontNotices() {
  const notices = new Set()
  const dir = path.join(root, 'node_modules', 'katex', 'dist', 'fonts')
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.ttf'))) {
    const bytes = fs.readFileSync(path.join(dir, file))
    for (let i = 0; i < bytes.readUInt16BE(4); i++) {
      const entry = 12 + i * 16
      if (bytes.toString('ascii', entry, entry + 4) !== 'name') continue
      const table = bytes.readUInt32BE(entry + 8)
      const strings = table + bytes.readUInt16BE(table + 4)
      for (let j = 0; j < bytes.readUInt16BE(table + 2); j++) {
        const record = table + 6 + j * 12
        if (![0, 13, 14].includes(bytes.readUInt16BE(record + 6))) continue
        const start = strings + bytes.readUInt16BE(record + 10)
        const data = Buffer.from(bytes.subarray(start, start + bytes.readUInt16BE(record + 8)))
        const platform = bytes.readUInt16BE(record)
        notices.add(
          platform === 0 || platform === 3
            ? data.swap16().toString('utf16le')
            : data.toString('latin1')
        )
      }
    }
  }
  if (![...notices].some((text) => text.includes('SIL Open Font License')))
    throw new Error('KaTeX font license metadata missing.')
  const geist = fs.readFileSync(
    path.join(root, 'node_modules', '@fontsource-variable', 'geist', 'LICENSE'),
    'utf8'
  )
  const ofl = geist.indexOf('SIL OPEN FONT LICENSE Version 1.1')
  if (ofl < 0) throw new Error('OFL reference text unavailable.')
  return [...notices].sort().join('\n\n') + '\n\n' + geist.slice(ofl)
}
sections.push('KaTeX fonts (SIL OFL-1.1; embedded font notices)\n\n' + fontNotices())
const text = sections.map(normalize).join('\n\n' + '='.repeat(78) + '\n\n') + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || normalize(fs.readFileSync(output, 'utf8')) !== normalize(text))
    throw new Error('Third-party notices are stale. Run npm run licenses:generate.')
} else fs.writeFileSync(output, text)
console.log(
  'Third-party notices: ' +
    records.length +
    ' installed packages, native/model licenses, and KaTeX font notices.'
)
