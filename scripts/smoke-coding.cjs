const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { load, root } = require('./security/load.cjs')
const directory = fs.mkdtempSync(path.join(root, '.cache/coding-'))
const workspace = path.join(directory, 'project')
fs.mkdirSync(workspace)
const settings = { files: { workspace } }
const controller = new AbortController()
const run = { signal: controller.signal }
const manager = { currentRun: () => run, assertRun: () => controller.signal.throwIfAborted() }
const policy = load('src/main/security/workspace-policy.ts', {
  electron: {
    app: {
      getPath: (name) => path.join(directory, name),
      getAppPath: () => path.join(directory, 'app')
    }
  },
  'fs/promises': fsp,
  path
})
const handles = load('src/main/security/workspace-handles.ts', {
  koffi: require('koffi'),
  path,
  crypto: require('node:crypto')
})
const untrusted = load('src/main/llm/untrusted-data.ts', { crypto: require('node:crypto') })
const files = load('src/main/tools/files.ts', {
  'fs/promises': fsp,
  path,
  '../settings': { getSettings: () => settings },
  '../security/workspace-policy': policy,
  '../security/workspace-handles': handles,
  '../security/run-manager': manager,
  '../llm/untrusted-data': untrusted,
  '../services/isolated-parser': {}
})
const binding = load('src/main/security/local-action.ts', {
  '../tools/windows': {},
  '../tools/win32': {},
  '../permissions': {},
  '../tools/automation/controls': {},
  '../tools/files': files,
  'fs/promises': fsp,
  './run-manager': manager,
  path,
  './workspace-policy': policy,
  '../network/search-provider': {},
  '../tools/screen': {},
  '../tools/openApp': {}
})
const npm = load('src/main/tools/npm.ts', {
  electron: { app: { on: () => {} } },
  net: require('node:net'),
  child_process: require('node:child_process'),
  util: require('node:util'),
  path,
  'fs/promises': fsp,
  './files': files,
  '../security/run-manager': manager,
  '../security/worker-job': load('src/main/security/worker-job.ts', { koffi: require('koffi') }),
  '../llm/untrusted-data': untrusted
})
async function main() {
  const absolute = path.join(workspace, 'result.html')
  const boundAbsolute = await binding.bindLocalAction(
    'write_file',
    {
      path: absolute,
      content: '<!DOCTYPE html><title>Fixture</title>'
    },
    run
  )
  await files.writeWorkspaceFile(
    { path: absolute, content: '<!DOCTYPE html><title>Fixture</title>' },
    boundAbsolute.scope.file
  )
  assert.equal(await fsp.readFile(absolute, 'utf8'), '<!DOCTYPE html><title>Fixture</title>')
  assert.equal(await files.workspacePath(absolute), absolute)
  for (const target of [
    path.join(directory, 'outside.html'),
    path.join(workspace + '-sibling', 'result.html'),
    workspace + '\\..\\project\\ambiguous.html',
    absolute + ':stream',
    path.join(workspace, 'folder. ', 'result.html'),
    '\\\\localhost\\share\\result.html',
    path.join(workspace, '.git', 'config')
  ])
    await assert.rejects(files.workspacePath(target, true), /Blocked|relative/)
  console.log(
    'PASS absolute paths inside the authorized workspace; outside, traversal, ADS, UNC, ambiguous and sensitive paths remain blocked'
  )
  const schema = load('src/main/tools/schemas.ts', {
    './windows': { POSITIONS: [] },
    '../harness/schemas': load('src/main/harness/schemas.ts')
  })
  const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schema })
  let approvals = 0
  let executions = 0
  let decision = 'deny'
  let executionError
  let executeDeletion = false
  let approvalHook
  const runner = load('src/main/llm/run-tool.ts', {
    '../harness/store': {},
    '../settings': { getSettings: () => ({ coding: { mode: 'auto' } }) },
    '../tools': {
      executeTool: async (name, args, _run, scope) => {
        executions++
        if (executionError) throw executionError
        if (executeDeletion)
          return files.deleteWorkspaceEntry(args, name === 'delete_directory', scope.deletion)
        return 'ok'
      }
    },
    '../permissions': {
      toolPermission: () => 'allow',
      requestApproval: async () => {
        approvals++
        await approvalHook?.()
        return decision
      }
    },
    '../security/policy': { authorizeTool: () => {} },
    '../security/run-manager': { ...manager, consumeToolBudget: () => {} },
    '../security/tool-contracts': contracts,
    '../security/audit': { securityEvent: () => {} },
    '../security/local-action': binding,
    '../services/screen-glow': { hideScreenGlow: () => {} }
  })
  assert.match(
    (
      await runner.runTool(
        'write_file',
        { path: 'missing-parent/file.ts', content: 'hello' },
        'missing'
      )
    ).text,
    /^Missing workspace path: no action was executed/
  )
  assert.equal(executions, 0, 'Missing-parent preflight never executes the action')
  assert.equal(approvals, 0, 'Missing-parent recovery does not fabricate an approval')
  assert.match((await runner.runTool('run_npm', { args: ['--version'] }, 'denied')).text, /Denied/)
  assert.equal(executions, 0)
  decision = 'once'
  await runner.runTool('run_npm', { args: ['--version'] }, 'approved')
  assert.equal(approvals, 2, 'npm asks even when a saved permission says allow')
  assert.equal(executions, 1)
  fs.writeFileSync(path.join(workspace, 'approved-delete.txt'), 'fixture')
  const deleting = { path: 'approved-delete.txt' }
  decision = 'deny'
  assert.match(
    (await runner.runTool('delete_file', deleting, 'delete-denied')).text,
    /Denied by the user/
  )
  assert(fs.existsSync(path.join(workspace, deleting.path)))
  assert.equal(executions, 1)
  decision = 'once'
  executeDeletion = true
  const deletionEvents = []
  assert.match(
    (
      await runner.runTool('delete_file', deleting, 'delete-approved', (e) =>
        deletionEvents.push(e)
      )
    ).text,
    /Verified path is absent/
  )
  assert(!fs.existsSync(path.join(workspace, deleting.path)))
  assert.equal(approvals, 4, 'Deletion asks even if settings say allow')
  assert.equal(deletionEvents.find((e) => e.type === 'tool_wait').canAlwaysAllow, false)
  fs.writeFileSync(path.join(workspace, 'stale-delete.txt'), 'original')
  approvalHook = () => {
    fs.writeFileSync(path.join(workspace, 'stale-delete.txt'), 'changed during approval')
    fs.utimesSync(path.join(workspace, 'stale-delete.txt'), new Date(), new Date(Date.now() + 2000))
  }
  assert.match(
    (await runner.runTool('delete_file', { path: 'stale-delete.txt' }, 'delete-stale')).text,
    /changed/
  )
  assert.equal(
    fs.readFileSync(path.join(workspace, 'stale-delete.txt'), 'utf8'),
    'changed during approval'
  )
  approvalHook = undefined
  executeDeletion = false
  contracts.validateToolArguments('run_npm', { args: ['run', 'build'] })
  contracts.validateToolArguments('edit_file', {
    path: 'file.ts',
    edits: [{ old_text: 'old', new_text: '' }]
  })
  const call = (args) => [
    {
      id: 'large-edit',
      type: 'function',
      function: { name: 'edit_file', arguments: JSON.stringify(args) }
    }
  ]
  const large = 'const component = "😀";\n'.repeat(2200)
  assert(large.length > 2000)
  const largeEdit = {
    path: 'file.ts',
    old_text: large,
    new_text: large.replace('component', 'view')
  }
  assert(call(largeEdit)[0].function.arguments.length > 70000)
  contracts.parseToolCalls(call(largeEdit))
  contracts.validateToolArguments('edit_file', {
    path: 'file.ts',
    edits: [largeEdit].map(({ old_text, new_text }) => ({ old_text, new_text }))
  })
  for (const key of ['old_text', 'new_text']) {
    contracts.validateToolArguments('edit_file', {
      path: 'file.ts',
      old_text: 'old',
      new_text: '',
      [key]: 'x'.repeat(65536)
    })
    assert.throws(
      () =>
        contracts.parseToolCalls(
          call({
            path: 'file.ts',
            old_text: 'old',
            new_text: '',
            [key]: 'x'.repeat(65537)
          })
        ),
      /65537 characters; maximum 65536/
    )
    assert.throws(
      () =>
        contracts.validateToolArguments('edit_file', {
          path: 'file.ts',
          edits: [{ old_text: 'old', new_text: '', [key]: 'x'.repeat(65537) }]
        }),
      /65537 characters; maximum 65536/
    )
    assert.throws(
      () =>
        contracts.validateToolArguments('edit_file', {
          path: 'file.ts',
          old_text: 'old',
          new_text: '',
          [key]: 'a\0b'
        }),
      /Argument contains NUL/
    )
  }
  const oversizedBatch = {
    path: 'file.ts',
    edits: Array.from({ length: 12 }, () => ({
      old_text: 'a'.repeat(12000),
      new_text: 'b'.repeat(12000)
    }))
  }
  assert.throws(
    () => contracts.validateToolArguments('edit_file', oversizedBatch),
    /maximum 262144/
  )
  assert.throws(
    () => contracts.parseToolCalls(call(oversizedBatch)),
    contracts.InvalidToolArgumentsError
  )

  assert.throws(
    () =>
      contracts.parseToolCalls(
        call({
          path: 'file.ts',
          old_text: '\n'.repeat(65536),
          new_text: '"'.repeat(65536)
        })
      ),
    /maximum 262144/
  )
  assert.throws(
    () =>
      contracts.validateToolArguments('read_file', {
        path: 'x'.repeat(2001)
      }),
    /maximum 2000/
  )
  for (const invalid of [
    { path: 'file.ts' },
    { path: 'file.ts', edits: [] },
    { path: 'file.ts', edits: [{ old_text: '', new_text: 'x' }] },
    { path: 'file.ts', old_text: 'x', new_text: 'y', edits: [{ old_text: 'x', new_text: 'y' }] }
  ])
    assert.throws(() => contracts.validateToolArguments('edit_file', invalid))
  assert.throws(() => contracts.validateToolArguments('run_npm', { args: 'run build' }))
  assert.throws(() => contracts.validateToolArguments('run_npm', { args: [] }))
  for (const unsupported of ['remove_directory']) {
    assert(!schema.toolSchemas.some((tool) => tool.function.name === unsupported))
    assert.throws(() => contracts.validateToolArguments(unsupported, { path: 'src' }))
  }
  contracts.validateToolArguments('delete_file', { path: 'old.ts' })
  contracts.validateToolArguments('delete_directory', { path: 'old', recursive: true })
  assert.throws(() =>
    contracts.validateToolArguments('delete_file', { path: 'old.ts', recursive: true })
  )
  assert.throws(() =>
    contracts.validateToolArguments('delete_directory', { path: 'old', recursive: 'true' })
  )
  await files.createWorkspaceDirectory({ path: 'npm-project' })
  const initArgs = { path: 'npm-project', args: ['init', '-y'] }
  const initApproval = await binding.bindLocalAction('run_npm', initArgs, run)
  await initApproval.revalidate()
  const initialized = JSON.parse(await npm.runNpm(initArgs, run))
  assert.equal(initialized.exitCode, 0, 'Real npm init -y succeeds in a newly created directory')
  assert.equal(initialized.stopped, false)
  assert(JSON.parse(fs.readFileSync(path.join(workspace, 'npm-project/package.json'), 'utf8')).name)
  await files.createWorkspaceDirectory({ path: 'npm-project/fixture-dep' })
  await files.writeWorkspaceFile({
    path: 'npm-project/fixture-dep/package.json',
    content: JSON.stringify({ name: 'sophon-fixture-dep', version: '1.0.0', main: 'index.js' })
  })
  await files.writeWorkspaceFile({
    path: 'npm-project/fixture-dep/index.js',
    content: 'module.exports = 42'
  })
  const installArgs = {
    path: 'npm-project',
    args: ['install', './fixture-dep', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']
  }
  const installApproval = await binding.bindLocalAction('run_npm', installArgs, run)
  await installApproval.revalidate()
  const installed = JSON.parse(await npm.runNpm(installArgs, run))
  assert.equal(installed.exitCode, 0, 'Real npm install accepts a local offline fixture dependency')
  assert(fs.existsSync(path.join(workspace, 'npm-project/package-lock.json')))
  assert.equal(require(path.join(workspace, 'npm-project/node_modules/sophon-fixture-dep')), 42)
  await files.createWorkspaceDirectory({ path: 'src' })
  await files.createWorkspaceDirectory({ path: 'src/app' })
  await files.writeWorkspaceFile({
    path: 'src/large.ts',
    content: '// preserve header\n' + large + '// preserve footer\n'
  })
  const bounded = JSON.parse(
    await files.readWorkspaceFile({ path: 'src/large.ts', max_chars: 200 })
  )
  assert(bounded.content.startsWith('// preserve header\n'))
  assert.match(bounded.content, /Truncated at 200 characters/)
  assert(!bounded.content.includes('// preserve footer'))
  const boundedLines = JSON.parse(
    await files.readWorkspaceFile({
      path: 'src/large.ts',
      start_line: 2,
      line_count: 100,
      max_chars: 80
    })
  )
  assert.match(boundedLines.content, /Excerpt truncated at 80 characters/)
  for (const max_chars of [0, 60001, 1.5])
    assert.throws(
      () =>
        contracts.validateToolArguments('read_file', {
          path: 'src/large.ts',
          max_chars
        }),
      /max_chars must be an integer/
    )
  const parsedLarge = contracts.parseToolCalls(call({ ...largeEdit, path: 'src/large.ts' }))[0].args
  const largeBound = await binding.bindLocalAction('edit_file', parsedLarge, run)
  await largeBound.revalidate()
  await files.editWorkspaceFile(parsedLarge, largeBound.scope.file)
  assert.equal(
    fs.readFileSync(path.join(workspace, 'src/large.ts'), 'utf8'),
    '// preserve header\n' + largeEdit.new_text + '// preserve footer\n',
    'Large Unicode patches preserve all surrounding bytes'
  )
  await files.writeWorkspaceFile({
    path: 'src/app/page.tsx',
    content: 'export default function Page() { return <h1>Hello</h1> }'
  })
  await files.writeWorkspaceFile({
    path: 'package.json',
    content: JSON.stringify({
      scripts: { build: 'node -e "console.log(12345)"', fail: 'node -e "process.exit(7)"' }
    })
  })
  assert.match(await files.readWorkspaceFile({ path: 'package.json' }), /scripts/)
  const args = { path: 'src/app/page.tsx', content: 'short', overwrite: true }
  const bound = await binding.bindLocalAction('write_file', args, run)
  await bound.revalidate()
  await files.writeWorkspaceFile(args, bound.scope.file)
  assert.equal(fs.readFileSync(path.join(workspace, args.path), 'utf8'), 'short')
  const edit = { path: args.path, old_text: 'short', new_text: 'changed' }
  const editBound = await binding.bindLocalAction('edit_file', edit, run)
  await files.editWorkspaceFile(edit, editBound.scope.file)
  assert.equal(fs.readFileSync(path.join(workspace, args.path), 'utf8'), 'changed')
  const multi = {
    path: args.path,
    edits: [
      { old_text: 'changed', new_text: 'first\nsecond\nkept' },
      { old_text: 'second', new_text: 'updated' }
    ]
  }
  const multiBound = await binding.bindLocalAction('edit_file', multi, run)
  await files.editWorkspaceFile(multi, multiBound.scope.file)
  assert.equal(fs.readFileSync(path.join(workspace, args.path), 'utf8'), 'first\nupdated\nkept')
  const excerpt = JSON.parse(
    await files.readWorkspaceFile({ path: args.path, start_line: 2, line_count: 1 })
  )
  assert.equal(excerpt.kind, 'local-file-excerpt')
  assert.match(excerpt.content, /lines 2-2 of 3.*\nupdated/s)
  assert(!excerpt.content.includes('kept'))
  assert.throws(() =>
    contracts.validateToolArguments('read_file', { path: 'file.ts', start_line: 0 })
  )
  assert.throws(() =>
    contracts.validateToolArguments('read_file', { path: 'file.ts', line_count: 501 })
  )
  const badPatch = {
    path: args.path,
    edits: [
      { old_text: 'first', new_text: 'must not save' },
      { old_text: 'missing match', new_text: 'no' }
    ]
  }
  const badBound = await binding.bindLocalAction('edit_file', badPatch, run)
  await assert.rejects(files.editWorkspaceFile(badPatch, badBound.scope.file), (error) => {
    assert.match(error.message, /No patch was saved/)
    assert.equal(error.code, 'PATCH_NOT_APPLIED')
    return true
  })
  executionError = Object.assign(new Error('Expected exactly one match. No patch was saved.'), {
    code: 'PATCH_NOT_APPLIED'
  })
  assert.match(
    (await runner.runTool('edit_file', badPatch, 'no-patch')).text,
    /^Patch not applied: no file was changed/
  )
  executionError = Object.assign(new Error('Access denied'), { code: 'EACCES' })
  assert.equal(
    (await runner.runTool('edit_file', badPatch, 'access-denied')).status,
    'uncertain',
    'A post-dispatch exception must not masquerade as a permission denial'
  )
  executionError = undefined
  assert.equal(
    fs.readFileSync(path.join(workspace, args.path), 'utf8'),
    'first\nupdated\nkept',
    'A failed later hunk must leave all bytes unchanged'
  )
  await assert.rejects(files.writeWorkspaceFile(args, bound.scope.file), /changed/)
  await assert.rejects(bound.revalidate(), /changed/)
  await assert.rejects(
    files.writeWorkspaceFile({ path: args.path, content: 'unapproved replacement' })
  )
  await assert.rejects(files.createWorkspaceDirectory({ path: '../outside' }), /unsafe/)
  await assert.rejects(files.createWorkspaceDirectory({ path: '.git' }), /unsafe/)
  await assert.rejects(files.writeWorkspaceFile({ path: '.env', content: 'secret' }), /unsafe/)
  fs.writeFileSync(path.join(workspace, 'repeat.txt'), 'same same')
  const repeated = await binding.bindLocalAction('edit_file', { path: 'repeat.txt' }, run)
  await assert.rejects(
    files.editWorkspaceFile(
      { path: 'repeat.txt', old_text: 'same', new_text: 'x' },
      repeated.scope.file
    ),
    /exactly one/
  )
  const preview = await binding.bindLocalAction('run_npm', { args: ['run', 'build'] }, run)
  assert.match(preview.preview, /outside this folder/)
  await preview.revalidate()
  const result = await npm.runNpm({ args: ['run', 'build'] }, run)
  assert.equal(JSON.parse(result).exitCode, 0)
  assert.match(result, /12345/)
  const failure = await npm.runNpm({ args: ['run', 'fail'] }, run)
  assert.equal(JSON.parse(failure).exitCode, 7)
  const results = load('src/main/workflow/results.ts')
  assert.equal(results.assessResult('run_npm', {}, result).status, 'verified')
  assert.equal(results.assessResult('run_npm', {}, failure).status, 'reported')
  assert.equal(
    results.assessResult('run_npm', {}, JSON.stringify({ stopped: true })).status,
    'uncertain'
  )
  await deletionTests(binding, files, handles, workspace, run)
  fs.writeFileSync(
    path.join(workspace, 'wait.cjs'),
    'require("fs").writeFileSync("ready.txt", String(process.pid));setInterval(() => {}, 1000)'
  )
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ scripts: { wait: 'node wait.cjs' } })
  )
  const pending = npm.runNpm({ args: ['run', 'wait'] }, run)
  const deadline = Date.now() + 5000
  while (!fs.existsSync(path.join(workspace, 'ready.txt')) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50))
  const ready = fs.existsSync(path.join(workspace, 'ready.txt'))
  controller.abort()
  const stopped = JSON.parse(await pending)
  assert(ready, 'npm lifecycle child started before cancellation')
  assert.equal(stopped.stopped, true)
  const childPid = Number(fs.readFileSync(path.join(workspace, 'ready.txt'), 'utf8'))
  assert.throws(() => process.kill(childPid, 0), 'Stop killed the npm lifecycle child')
  await assert.rejects(npm.runNpm({ args: ['run', 'build'] }, run))
  console.log(
    'PASS coding: folders, real npm init -y and offline dependency install, manifests, native replacement/truncation, exact edits, stale identity, protected paths, npm preview, real npm scripts/exit codes, cancellation and native approved deletion'
  )
}
async function deletionTests(binding, files, handles, workspace, run) {
  const fixture = path.join(workspace, 'delete-tests')
  fs.mkdirSync(fixture)
  const args = { path: 'delete-tests/old.ts' }
  fs.writeFileSync(path.join(workspace, args.path), 'old')
  fs.writeFileSync(path.join(fixture, 'keep.ts'), 'keep')
  const bound = await binding.bindLocalAction('delete_file', args, run)
  assert.match(bound.preview, /Permanent deletion/)
  await bound.revalidate()
  assert.match(
    (await files.deleteWorkspaceEntry(args, false, bound.scope.deletion)).text,
    /Verified path is absent/
  )
  assert(!fs.existsSync(path.join(workspace, args.path)))
  assert.equal(fs.readFileSync(path.join(fixture, 'keep.ts'), 'utf8'), 'keep')
  await assert.rejects(
    files.deleteWorkspaceEntry({ path: 'delete-tests/keep.ts' }, false),
    /approved snapshot/
  )
  for (const name of [
    'empty',
    'tree/nested',
    'changed',
    'protected',
    'partial',
    'cancelled',
    'over-limit'
  ])
    fs.mkdirSync(path.join(fixture, name), { recursive: true })
  const emptyArgs = { path: 'delete-tests/empty' }
  const empty = await binding.bindLocalAction('delete_directory', emptyArgs, run)
  await files.deleteWorkspaceEntry(emptyArgs, true, empty.scope.deletion)
  assert(!fs.existsSync(path.join(workspace, emptyArgs.path)))
  fs.writeFileSync(path.join(fixture, 'tree/a.ts'), 'a')
  fs.writeFileSync(path.join(fixture, 'tree/nested/b.ts'), 'b')
  await assert.rejects(
    files.prepareWorkspaceDeletion({ path: 'delete-tests/tree' }, true),
    /not empty/
  )
  const treeArgs = { path: 'delete-tests/tree', recursive: true }
  const tree = await binding.bindLocalAction('delete_directory', treeArgs, run)
  assert.equal(tree.scope.deletion.entries.length, 4)
  await tree.revalidate()
  assert.match(
    (await files.deleteWorkspaceEntry(treeArgs, true, tree.scope.deletion)).text,
    /Verified path is absent/
  )
  assert(!fs.existsSync(path.join(workspace, treeArgs.path)))
  fs.writeFileSync(path.join(fixture, 'changed/a.ts'), 'a')
  const changed = await files.prepareWorkspaceDeletion(
    { path: 'delete-tests/changed', recursive: true },
    true
  )
  fs.writeFileSync(path.join(fixture, 'changed/added.ts'), 'new after approval')
  await assert.rejects(
    files.deleteWorkspaceEntry({ path: changed.path, recursive: true }, true, changed),
    /changed/
  )
  assert(fs.existsSync(path.join(fixture, 'changed/a.ts')))
  fs.writeFileSync(path.join(fixture, 'protected/.env'), 'protected fixture')
  fs.writeFileSync(path.join(fixture, 'protected/normal.ts'), 'keep')
  await assert.rejects(
    files.prepareWorkspaceDeletion({ path: 'delete-tests/protected', recursive: true }, true),
    /unsafe|sensitive/
  )
  assert(fs.existsSync(path.join(fixture, 'protected/normal.ts')))
  for (const target of ['.', '..', '../outside', '.git', 'delete-tests/*.ts'])
    await assert.rejects(files.prepareWorkspaceDeletion({ path: target, recursive: true }, true))
  fs.linkSync(path.join(fixture, 'keep.ts'), path.join(fixture, 'hard.ts'))
  await assert.rejects(
    files.prepareWorkspaceDeletion({ path: 'delete-tests/hard.ts' }, false),
    /linked/
  )
  fs.symlinkSync(path.join(fixture, 'changed'), path.join(fixture, 'junction'), 'junction')
  await assert.rejects(
    files.prepareWorkspaceDeletion({ path: 'delete-tests/junction', recursive: true }, true),
    /linked/
  )
  for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(fixture, `over-limit/${i}.ts`), '')
  await assert.rejects(
    files.prepareWorkspaceDeletion({ path: 'delete-tests/over-limit', recursive: true }, true),
    /250 entries/
  )
  fs.writeFileSync(path.join(fixture, 'partial/a.ts'), 'a')
  fs.writeFileSync(path.join(fixture, 'partial/b.ts'), 'b')
  const partial = await files.prepareWorkspaceDeletion(
    { path: 'delete-tests/partial', recursive: true },
    true
  )
  let checks = 0
  await assert.rejects(
    handles.deleteLockedEntries(
      partial.root,
      partial.entries,
      () => {
        if (++checks > partial.entries.length + 2) throw Error('Synthetic cancellation')
      },
      () => files.revalidateWorkspaceDeletion(partial)
    ),
    (error) => error.code === 'DELETE_PARTIAL'
  )
  assert(fs.existsSync(path.join(fixture, 'partial/a.ts')))
  assert(!fs.existsSync(path.join(fixture, 'partial/b.ts')))
  const cancelled = await files.prepareWorkspaceDeletion({ path: 'delete-tests/cancelled' }, true)
  await assert.rejects(
    handles.deleteLockedEntries(
      cancelled.root,
      cancelled.entries,
      () => {
        throw Error('Stopped')
      },
      async () => {}
    ),
    /Stopped/
  )
  assert(fs.existsSync(path.join(fixture, 'cancelled')))
  console.log(
    'PASS deletion: exact file, empty/recursive folder, approved contents, stale snapshot rejection, protected descendants, root/traversal/wildcards, links, limits, cancellation and partial-result detection'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
