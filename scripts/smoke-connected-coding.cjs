const { app, BrowserWindow, globalShortcut, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
assert(process.argv.includes('--live'), 'Pass --live to use the connected model')
const root = path.resolve(__dirname, '..')
const sourceProfile = path.join(app.getPath('appData'), 'sophon')
const saved = JSON.parse(fs.readFileSync(path.join(sourceProfile, 'settings.json'), 'utf8'))
assert.equal(saved.model.provider, 'chatgpt', 'This test uses the existing ChatGPT connection')
const output = path.join(root, '.cache/connected-coding', String(Date.now()))
const profile = path.join(output, 'profile')
fs.mkdirSync(profile, { recursive: true })
for (const name of ['Local State', 'chatgpt-auth.enc'])
  fs.copyFileSync(path.join(sourceProfile, name), path.join(profile, name))

const scratch = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Documents', 'SophonTests')
fs.mkdirSync(scratch, { recursive: true })
const projectRoot = fs.mkdtempSync(path.join(scratch, 'connected-coding-'))
const workspace = path.join(projectRoot, 'project')
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
const source = path.join(workspace, 'src/unique.cjs')
fs.writeFileSync(source, 'exports.uniqueStrings = function(values) { return values; };\n')
fs.mkdirSync(path.join(workspace, 'java'))
fs.writeFileSync(
  path.join(workspace, 'java/Hello.java'),
  'public class Hello { public static void main(String[] args) { System.out.println("wrong"); } }\n'
)
fs.mkdirSync(path.join(workspace, 'native'))
fs.writeFileSync(
  path.join(workspace, 'native/hello.c'),
  '#include <stdio.h>\nint main(void) { puts("42"); return 0; }\n'
)
fs.writeFileSync(
  path.join(workspace, 'native/hello.cpp'),
  '#include <iostream>\nint main() { std::cout << 42 << std::endl; }\n'
)
fs.writeFileSync(
  path.join(workspace, 'native/Makefile'),
  'all:\n\tgcc hello.c -o hello-c.exe\n\tg++ hello.cpp -o hello-cpp.exe\n'
)
fs.writeFileSync(
  path.join(workspace, 'package.json'),
  JSON.stringify(
    { name: 'connected-fixture', version: '1.0.0', scripts: { test: 'node ../oracle.cjs' } },
    null,
    2
  )
)
fs.writeFileSync(
  path.join(projectRoot, 'oracle.cjs'),
  `
const assert = require('node:assert/strict')
const { uniqueStrings } = require('./project/src/unique.cjs')
assert.deepEqual(uniqueStrings(['b','a','b','','__proto__','a','']), ['b','a','','__proto__'])
const input = ['a','b','a']; assert.deepEqual(uniqueStrings(input), ['a','b']); assert.deepEqual(input, ['a','b','a'])
assert.deepEqual(uniqueStrings([]), [])
for (const invalid of [null, {}, 'abc', [1], ['a', null]]) assert.throws(() => uniqueStrings(invalid), TypeError)
assert.equal(uniqueStrings(Array.from({ length: 20000 }, (_, i) => String(i % 100))).length, 100)
console.log('ORACLE PASS: unique, ordered, immutable, invalid inputs, large input')
`
)
const git = (args) =>
  execFileSync('git.exe', args, { cwd: workspace, windowsHide: true, encoding: 'utf8' }).trim()
git(['init', '--quiet'])
git(['config', 'user.name', 'Sophon Fixture'])
git(['config', 'user.email', 'fixture@example.invalid'])
git(['add', '.'])
git(['commit', '--quiet', '-m', 'Fixture baseline'])
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    policyVersion: 1,
    model: { ...saved.model, historyTurns: Math.max(saved.model.historyTurns ?? 0, 4) },
    behavior: { style: 'terse', systemPrompt: '', neverDo: '' },
    coding: { mode: 'ask-before-edit' },
    research: { enabled: false, provider: 'exa' },
    memory: { enabled: false, maxTokens: 600 },
    files: { workspace },
    rules: { blockedApps: [], protectedWindows: [] },
    tools: Object.fromEntries(
      ['list_files', 'read_file', 'edit_file', 'run_npm', 'run_command'].map((name) => [
        name,
        name === 'list_files' || name === 'read_file' ? 'allow' : 'ask'
      ])
    )
  })
)
app.setPath('userData', profile)
app.setAppPath(root)
delete process.env.ELECTRON_RENDERER_URL
globalShortcut.register = () => true
globalShortcut.unregister = () => {}
globalShortcut.unregisterAll = () => {}
let connectionError

app.whenReady().then(() => {
  try {
    const file = path.join(profile, 'chatgpt-auth.enc')
    const store = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
    const active = store.accounts.find((account) => account.id === store.activeId)
    assert(
      active?.accessToken && active.expiresAt > Date.now() + 60000,
      'The connected access token needs refreshing in the main app before this isolated test'
    )
    delete active.refreshToken
    delete active.idToken
    store.accounts = [active]
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(store)))
  } catch (error) {
    connectionError = error
    fs.rmSync(path.join(profile, 'chatgpt-auth.enc'), { force: true })
  }
})
require(path.join(root, 'out/main/index.js'))
const report = { model: saved.model.modelId, workspace, scenarios: [] }
let main,
  evaluate,
  approving = false
const seen = new Set()
const save = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
async function wait(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}
async function approvePending() {
  if (!evaluate || approving) return
  approving = true
  try {
    const state = await evaluate('window.api.getSession()')
    for (const action of state.items.at(-1)?.actions ?? []) {
      if (!seen.has(action.id)) {
        seen.add(action.id)
        console.log('ACTION', action.name)
      }
      if (action.status !== 'waiting') continue
      const args = JSON.parse(action.preview).arguments
      let allow =
        action.name === 'edit_file' &&
        ['src/unique.cjs', 'java/Hello.java'].includes(args.path.replace(/\\/g, '/'))
      if (action.name === 'run_npm')
        allow =
          JSON.stringify(args.args) === '["run","test"]' || JSON.stringify(args.args) === '["test"]'
      if (action.name === 'run_command')
        allow =
          args.command
            .split(';')
            .every((part) =>
              /^(?:git\s+(?:status|diff|log|show|rev-parse|add|commit)\b|npm(?:\.cmd)?\s+(?:run\s+)?test\b|javac(?:\.exe)?\s+(?:Hello\.java|java[\\/]Hello\.java)$|java(?:\.exe)?\s+(?:-cp\s+(?:\.|java)\s+)?Hello$|mingw32-make(?:\.exe)?(?:\s+-C\s+native)?$|\.[\\/](?:native[\\/])?hello-c(?:pp)?\.exe$|Get-Command\s+(?:git|java|javac|gcc|mingw32-make)\b)/i.test(
                part.trim()
              )
            ) &&
          !/[\r\n&|<>$`]/.test(args.command) &&
          !/\b(?:push|fetch|pull|clone|reset|clean)\b/.test(args.command) &&
          (!args.path || ['.', 'java', 'native'].includes(args.path))
      assert(
        allow,
        'Unexpected action in disposable live fixture: ' + action.name + ' ' + JSON.stringify(args)
      )
      await evaluate(`window.api.approve(${JSON.stringify(action.id)}, 'once')`)
    }
  } finally {
    approving = false
  }
}
async function scenario(name, prompt) {
  console.log('SCENARIO', name)
  const entry = { name, prompt, startedAt: Date.now() }
  report.scenarios.push(entry)
  save()
  await evaluate(`window.api.send(${JSON.stringify(prompt)})`)
  const state = await evaluate('window.api.getSession()')
  const item = state.items.at(-1)
  entry.reply = item.text
  entry.actions = item.actions.map(({ name, status, preview, detail }) => ({
    name,
    status,
    preview,
    detail
  }))
  entry.workflow = item.workflow
  entry.usage = item.usage
  entry.elapsedMs = Date.now() - entry.startedAt
  save()
  assert(!/^Error:|^Stopped|Coding work is incomplete|not verified/.test(item.text), item.text)
  assert(!['blocked', 'interrupted', 'needs_review'].includes(item.workflow?.outcome), item.text)
  console.log('PASS', name, '(' + entry.actions.length + ' actions)')
  return item
}
async function review() {
  await app.whenReady()
  if (connectionError) throw connectionError
  await wait(() => BrowserWindow.getAllWindows().length >= 2, 'production windows')
  main = BrowserWindow.getAllWindows().find((win) => win.isResizable())
  main.webContents.setBackgroundThrottling(false)
  evaluate = (code) => main.webContents.executeJavaScript(code, true)
  await wait(() => evaluate('!!document.querySelector("textarea")'), 'renderer')
  const expected = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  await scenario(
    'Inspect only',
    'Take a look at the code base, get familiar with it, and say "done" when you are. Do not edit or run tests yet.'
  )
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), expected)
  assert.equal(git(['status', '--porcelain']), '')
  await scenario(
    'Fix and verify',
    'Fix uniqueStrings in src/unique.cjs: accept only arrays of strings (otherwise throw TypeError), remove duplicates while preserving first occurrence order, preserve the original input, and handle large arrays efficiently. Use the existing npm test script. Keep package.json and the trusted oracle unchanged. Do the work and verify it; do not commit yet.'
  )
  execFileSync('node.exe', [path.join(projectRoot, 'oracle.cjs')], {
    cwd: workspace,
    windowsHide: true
  })
  assert.match(git(['status', '--porcelain']), /src\/unique.cjs/)
  await scenario(
    'Git commit',
    'Check git status and the diff. Commit only src/unique.cjs with message "Fix unique string handling". Do not push.'
  )
  assert.equal(git(['log', '-1', '--format=%s']), 'Fix unique string handling')
  assert.equal(git(['status', '--porcelain']), '')
  const before = git(['rev-list', '--count', 'HEAD'])
  await scenario('Short follow-up', 'try again')
  assert.equal(
    git(['rev-list', '--count', 'HEAD']),
    before,
    'Follow-up must not duplicate a completed commit'
  )
  await scenario(
    'Conversation follow-up',
    'Which file did you change and what tests actually passed? Answer briefly.'
  )
  await scenario(
    'Java edit, compile and run',
    'Fix the Java project in java/Hello.java to print exactly 42 followed by a newline. Compile it with javac Hello.java and run java Hello from the java folder. Preserve all other source files and build configuration. Report the actual compile/run results.'
  )
  assert.equal(
    execFileSync('java.exe', ['-cp', 'java', 'Hello'], {
      cwd: workspace,
      windowsHide: true,
      encoding: 'utf8'
    }).trim(),
    '42'
  )
  await scenario(
    'Build C and C++ with Make',
    'Run mingw32-make from the native folder to build the existing C and C++ fixtures. Then run ./hello-c.exe and ./hello-cpp.exe from that folder and report their actual output. Do not edit files or commit.'
  )
  for (const executable of ['hello-c.exe', 'hello-cpp.exe'])
    assert.equal(
      execFileSync(path.join(workspace, 'native', executable), [], {
        cwd: workspace,
        windowsHide: true,
        encoding: 'utf8'
      }).trim(),
      '42'
    )
  console.log(
    'PASS connected ChatGPT coding and prompting; report:',
    path.join(output, 'report.json')
  )
}
const ticker = setInterval(() => {
  void approvePending().catch((error) => {
    report.error = error.message
    save()
    console.error(error.message)
    cleanup()
    app.exit(1)
  })
}, 150)
const timeout = setTimeout(() => {
  report.error = 'Live test exceeded ten minutes'
  save()
  cleanup()
  app.exit(1)
}, 600000)
function cleanup() {
  clearInterval(ticker)
  clearTimeout(timeout)
  for (const name of ['chatgpt-auth.enc', 'chatgpt-auth.enc.tmp'])
    fs.rmSync(path.join(profile, name), { force: true })
}
app.on('will-quit', cleanup)
review()
  .then(() => {
    cleanup()
    app.exit(0)
  })
  .catch((error) => {
    report.error = error.message
    save()
    console.error(error.message)
    cleanup()
    app.exit(1)
  })
