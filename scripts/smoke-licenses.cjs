const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const generator = path.join(__dirname, 'third-party-notices.cjs')
const localRequire = createRequire(generator)
const source = fs.readFileSync(generator, 'utf8')
const output = path.join(root, 'THIRD_PARTY_NOTICES.txt')
function check(overrides = {}) {
  vm.runInNewContext(
    source,
    {
      require: (name) => (name === 'node:fs' ? { ...fs, ...overrides } : localRequire(name)),
      __dirname,
      process: { argv: [process.execPath, generator, '--check'] },
      Buffer,
      console: { log: () => undefined }
    },
    { filename: generator }
  )
}
check()
assert.throws(
  () =>
    check({
      readFileSync(file, ...args) {
        return file === output ? 'outdated notices' : fs.readFileSync(file, ...args)
      }
    }),
  /notices are stale/
)
assert.throws(
  () =>
    check({
      readFileSync(file, ...args) {
        return file === path.join(root, 'legal', 'upstream', 'whisper-model.txt')
          ? 'altered license'
          : fs.readFileSync(file, ...args)
      }
    }),
  /Supplemental license changed/
)
assert.throws(
  () =>
    check({
      readdirSync(directory, ...args) {
        const entries = fs.readdirSync(directory, ...args)
        return directory === path.join(root, 'node_modules', 'clsx')
          ? entries.filter((entry) => !/^license/i.test(entry.name ?? entry))
          : entries
      }
    }),
  /No license text found: clsx/
)
console.log(
  'PASS current notices, stale output rejection, supplemental license integrity, and missing license rejection'
)
