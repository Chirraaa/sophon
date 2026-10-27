const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { load, root } = require('./security/load.cjs')

// Scan application buttons, including form submissions and composed shadcn triggers.
const failures = []
let buttons = 0
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'ui') scan(file)
      continue
    }
    if (!file.endsWith('.tsx')) continue
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      99,
      true,
      ts.ScriptKind.TSX
    )
    const attribute = (node, name) =>
      node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.text === name)
    const ancestors = (node) => {
      const result = []
      for (let parent = node.parent; parent; parent = parent.parent) result.push(parent)
      return result
    }
    function visit(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ['Button', 'PillButton', 'button'].includes(node.tagName.getText(source))
      ) {
        buttons++
        const parents = ancestors(node)
        const handler = attribute(node, 'onClick')
        const delegated =
          node.attributes.properties.some(ts.isJsxSpreadAttribute) ||
          parents.some((p) => ts.isJsxAttribute(p) && p.name.text === 'render')
        const submit =
          attribute(node, 'type')?.initializer?.text === 'submit' &&
          parents.some(
            (p) =>
              ts.isJsxElement(p) &&
              ['form', 'GithubForm'].includes(p.openingElement.tagName.getText(source)) &&
              attribute(p.openingElement, 'onSubmit')
          )
        const emptyHandler =
          handler?.initializer &&
          ts.isJsxExpression(handler.initializer) &&
          handler.initializer.expression &&
          (ts.isArrowFunction(handler.initializer.expression) ||
            ts.isFunctionExpression(handler.initializer.expression)) &&
          ts.isBlock(handler.initializer.expression.body) &&
          handler.initializer.expression.body.statements.length === 0
        if ((!handler && !delegated && !submit) || emptyHandler) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          failures.push(`${path.relative(root, file)}:${line}: button has no action`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
scan(path.join(root, 'src/renderer/src'))
assert.deepEqual(failures, [])
assert(buttons > 100, 'The sweep must cover the application')

// Real filesystem behavior: empty history, deletion scope, and repeat deletion.
const output = path.join(root, '.cache/ui-actions')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
const audit = (filesystem = fs) =>
  load('src/main/security/audit.ts', {
    electron: { app: { getPath: () => profile } },
    fs: filesystem,
    path
  })
assert.equal(audit().clearSecurityEvents(), 0)
const directory = path.join(profile, 'security-events')
fs.mkdirSync(directory)
for (const name of ['2026-01-01.jsonl', '2026-01-02.jsonl', 'keep.txt'])
  fs.writeFileSync(path.join(directory, name), 'synthetic diagnostic')
assert.equal(audit().clearSecurityEvents(), 2)
assert.deepEqual(fs.readdirSync(directory), ['keep.txt'])
assert.equal(audit().clearSecurityEvents(), 0)
assert.throws(
  () =>
    audit({
      ...fs,
      readdirSync: () => {
        throw Object.assign(new Error('Denied'), { code: 'EACCES' })
      }
    }).clearSecurityEvents(),
  /Could not read security diagnostics.*try again/
)
fs.writeFileSync(path.join(directory, '2026-01-03.jsonl'), 'synthetic diagnostic')
assert.throws(
  () =>
    audit({
      ...fs,
      unlinkSync: () => {
        throw Object.assign(new Error('Locked'), { code: 'EPERM' })
      }
    }).clearSecurityEvents(),
  /Could not delete all security diagnostics.*try again/
)
assert.equal(audit().clearSecurityEvents(), 1, 'Deletion can be retried after failure')
console.log(
  `PASS ${buttons} button action bindings; diagnostics deletion, empty history, scope and errors`
)
