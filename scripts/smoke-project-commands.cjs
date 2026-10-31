const { record } = require('./security/action-fixture.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { load, root } = require('./security/load.cjs')
fs.mkdirSync(path.join(root, '.cache'), { recursive: true })
const directory = fs.mkdtempSync(path.join(root, '.cache/project-commands-'))
const workspace = path.join(directory, 'project with spaces')
fs.mkdirSync(workspace)
const settings = { files: { workspace }, coding: { mode: 'auto' } }
let controller = new AbortController()
const run = { id: 'commands-fixture', mode: 'assistant', workspace, signal: controller.signal }
const manager = {
  currentRun: () => run,
  assertRun: () => run.signal.throwIfAborted(),
  consumeToolBudget: () => {}
}
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
  crypto
})
const envelope = load('src/main/llm/untrusted-data.ts', { crypto })
const files = load('src/main/tools/files.ts', {
  'fs/promises': fsp,
  path,
  '../settings': { getSettings: () => settings },
  '../security/workspace-policy': policy,
  '../security/workspace-handles': handles,
  '../security/run-manager': manager,
  '../llm/untrusted-data': envelope,
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
const schemas = load('src/main/tools/schemas.ts', {
  '../harness/schemas': load('src/main/harness/schemas.ts'),
  './windows': { POSITIONS: [] }
})
const contracts = load('src/main/security/tool-contracts.ts', { '../tools/schemas': schemas })
const command = load('src/main/tools/command.ts', {
  child_process: require('node:child_process'),
  path,
  'fs/promises': fsp,
  string_decoder: require('node:string_decoder'),
  './files': files,
  '../security/run-manager': manager,
  '../security/worker-job': load('src/main/security/worker-job.ts', { koffi: require('koffi') }),
  '../llm/untrusted-data': envelope
})
let decision = 'deny',
  approvals = 0,
  executions = 0,
  preview = ''
const runner = load('src/main/llm/run-tool.ts', {
  '../tools': {
    executeTool: async (_name, args) => {
      executions++
      return command.runCommand(args, run)
    }
  },
  '../permissions': {
    toolPermission: () => 'allow',
    requestApproval: async () => {
      approvals++
      return decision
    }
  },
  '../security/policy': { authorizeTool: () => {} },
  '../security/run-manager': manager,
  '../security/tool-contracts': contracts,
  '../security/audit': { securityEvent: () => {} },
  '../security/local-action': binding,
  '../services/screen-glow': { hideScreenGlow: () => {} },
  '../settings': { getSettings: () => settings },
  '../harness/store': {}
})
const verification = load('src/main/workflow/coding-verification.ts')
const results = load('src/main/workflow/results.ts')
const event = (e) => {
  if (e.type === 'tool_wait') assert.equal(e.canAlwaysAllow, false)
  if (e.type === 'tool_preview') preview = e.preview
}
async function execute(commandText, purpose = 'check', extra = {}) {
  const args = { command: commandText, purpose, ...extra }
  const result = (await runner.runTool('run_command', args, crypto.randomUUID(), event)).text
  assert(!result.startsWith('Denied'), result)
  return JSON.parse(result)
}
async function main() {
  for (const timeout_seconds of [0, 601, 1.5])
    assert.throws(() =>
      contracts.validateToolArguments('run_command', {
        command: 'git status',
        purpose: 'inspect',
        timeout_seconds
      })
    )
  assert.throws(() =>
    contracts.validateToolArguments('run_command', { command: ' ', purpose: 'inspect' })
  )
  assert.throws(() =>
    contracts.validateToolArguments('run_command', { command: 'git status', purpose: 'unknown' })
  )
  const gitInit = { command: 'git init --quiet', purpose: 'change' }
  assert.match((await runner.runTool('run_command', gitInit, 'denied', event)).text, /^Denied/)
  assert.equal(executions, 0)
  assert(!fs.existsSync(path.join(workspace, '.git')))
  decision = 'once'
  assert.equal((await execute(gitInit.command, 'change')).exitCode, 0)
  assert.match(preview, /PowerShell|account access/)
  assert(fs.existsSync(path.join(workspace, '.git')))
  assert.equal(approvals, 2, 'Command approval is one-use even under Always allow')
  assert.equal(
    (
      await execute(
        'git -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty --quiet -m "command fixture"',
        'change'
      )
    ).exitCode,
    0
  )
  assert.equal((await execute('git status --porcelain', 'inspect')).exitCode, 0)
  assert.equal(
    (await execute("git clone --quiet --no-hardlinks . 'cloned project'", 'change')).exitCode,
    0
  )
  assert.equal(
    (await execute('git log -1 --format=%s', 'inspect', { path: 'cloned project' })).exitCode,
    0
  )

  for (const [filename, content] of [
    [
      'Hello.java',
      'public class Hello { public static void main(String[] args) { System.out.println(42); } }'
    ],
    ['hello.c', '#include <stdio.h>\nint main(void) { puts("42"); return 0; }\n'],
    ['hello.cpp', '#include <iostream>\nint main() { std::cout << 42 << std::endl; }\n'],
    ['Makefile', 'all:\n\tgcc hello.c -o make-hello.exe\n'],
    [
      'CMakeLists.txt',
      'cmake_minimum_required(VERSION 3.16)\nproject(Fixture C)\nadd_executable(hello hello.c)\n'
    ]
  ]) {
    await files.writeWorkspaceFile({ path: filename, content })
    assert.match(await files.readWorkspaceFile({ path: filename }), /local-file/)
  }
  for (const [compile, launch] of [
    ['javac Hello.java', 'java Hello'],
    ['gcc hello.c -o hello-c.exe', '.\\hello-c.exe'],
    ['g++ hello.cpp -o hello-cpp.exe', '.\\hello-cpp.exe'],
    ['mingw32-make', '.\\make-hello.exe']
  ]) {
    const built = await execute(compile)
    assert.equal(built.exitCode, 0, JSON.stringify(built))
    const output = await execute(launch)
    assert.equal(output.exitCode, 0, JSON.stringify(output))
    assert.match(output.output.content, /42/)
  }
  const cmake = await execute(
    'Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source',
    'inspect'
  )
  if (cmake.exitCode === 0 && cmake.output.content.trim()) {
    assert.equal((await execute('cmake -S . -B build -G "MinGW Makefiles"')).exitCode, 0)
    assert.equal((await execute('cmake --build build')).exitCode, 0)
  } else
    console.log(
      'SKIP real CMake build: cmake is not installed/on PATH; command failure is reported for diagnosis'
    )
  const nonzero = await execute('exit 7')
  assert.equal(nonzero.exitCode, 7)
  assert.equal(results.assessResult('run_command', {}, JSON.stringify(nonzero)).status, 'reported')
  assert.equal((await execute('sophon_missing_compiler_fixture')).exitCode, 1)
  const streamed = []
  const bounded = JSON.parse(
    await command.runCommand(
      { command: "1..10000 | ForEach-Object { 'output line ' + $_ }", purpose: 'inspect' },
      run,
      (text) => streamed.push(text)
    )
  )
  assert.equal(bounded.exitCode, 0)
  assert.match(bounded.output.content, /truncated/)
  assert(bounded.output.content.length < 17000)
  assert(streamed.length > 0)
  const timeout = await execute('Start-Sleep -Seconds 20', 'inspect', { timeout_seconds: 1 })
  assert.equal(timeout.stopped, true)
  assert.equal(results.assessResult('run_command', {}, JSON.stringify(timeout)).status, 'uncertain')
  const blocked = (
    await runner.runTool(
      'run_command',
      { command: 'git status', purpose: 'inspect', path: '../outside' },
      'outside',
      event
    )
  ).text
  assert.match(blocked, /^Denied/)

  const gate = new verification.CodingVerification()
  const check = { command: 'javac Hello.java', purpose: 'check' }
  record(gate, 'write_file', { path: 'Hello.java' }, 'saved', 'verified')
  record(gate, 'list_files', {}, '[file] Hello.java', 'observed')
  record(gate, 'run_command', check, JSON.stringify({ exitCode: 0, stopped: false }), 'verified')
  assert.deepEqual(gate.next(), { done: true })
  record(gate, 'edit_file', { path: 'Hello.java' }, 'saved', 'verified')
  record(gate, 'list_files', {}, '[file] Hello.java', 'observed')
  assert.equal(gate.next().tool, 'run_command')
  const failing = JSON.stringify({
    exitCode: 1,
    stopped: false,
    output: 'Hello.java:3: error: cannot find symbol'
  })
  // Re-running unchanged code is not a repair attempt, and the host will not re-run it.
  for (let i = 0; i < 8; i++) record(gate, 'run_command', check, failing, 'reported')
  assert.equal(gate.next().unchanged, 'javac Hello.java in .')
  assert.equal(gate.limitIssue(), undefined)
  // Edits that keep reproducing the same failure stall; six such attempts stop the repair.
  for (let attempt = 1; attempt <= 6; attempt++) {
    record(gate, 'edit_file', { path: 'Hello.java' }, 'saved', 'verified')
    record(gate, 'list_files', {}, '[file] Hello.java', 'observed')
    record(gate, 'run_command', check, failing, 'reported')
    if (attempt < 6) assert.equal(gate.limitIssue(), undefined, `attempt ${attempt} may continue`)
  }
  assert.match(gate.next().blocked, /same failure after 6 fix attempts/)
  assert.match(gate.limitIssue(), /not converging/)
  // A repair that changes the failure keeps going, and one that shrinks it is progress.
  const moving = new verification.CodingVerification()
  record(moving, 'write_file', { path: 'Hello.java' }, 'saved', 'verified')
  record(moving, 'list_files', {}, '[file] Hello.java', 'observed')
  for (let attempt = 0; attempt < 9; attempt++) {
    record(moving, 'edit_file', { path: 'Hello.java' }, 'saved', 'verified')
    record(moving, 'list_files', {}, '[file] Hello.java', 'observed')
    record(
      moving,
      'run_command',
      check,
      JSON.stringify({
        exitCode: 1,
        stopped: false,
        output: `Hello.java: error: cannot find symbol ${['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota'][attempt]}`
      }),
      'reported'
    )
  }
  assert.equal(moving.limitIssue(), undefined, 'Distinct failures are new information')
  record(moving, 'edit_file', { path: 'Hello.java' }, 'saved', 'verified')
  record(moving, 'list_files', {}, '[file] Hello.java', 'observed')
  record(moving, 'run_command', check, failing, 'reported')
  assert.match(moving.limitIssue(), /without the failure shrinking/)
  const mixed = new verification.CodingVerification()
  record(mixed, 'edit_file', { path: 'Hello.java' }, 'saved', 'verified')
  record(
    mixed,
    'read_file',
    { path: 'package.json' },
    envelope.untrustedData(
      'local-file',
      'package.json',
      JSON.stringify({ scripts: { test: 'node test.cjs' } })
    ),
    'observed'
  )
  record(
    mixed,
    'run_npm',
    { args: ['run', 'test'] },
    JSON.stringify({ exitCode: 0, stopped: false }),
    'verified'
  )
  record(mixed, 'run_command', check, JSON.stringify({ exitCode: 1, stopped: false }), 'reported')
  assert.equal(
    mixed.next().unchanged,
    'javac Hello.java in .',
    'Passing npm cannot hide a failed compiler check'
  )

  fs.writeFileSync(
    path.join(workspace, 'wait.cjs'),
    'require("fs").writeFileSync("child-pid.txt", String(process.pid));setInterval(() => {}, 1000)'
  )
  const pending = command.runCommand({ command: 'node wait.cjs', purpose: 'inspect' }, run)
  const deadline = Date.now() + 10000
  while (!fs.existsSync(path.join(workspace, 'child-pid.txt')) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50))
  assert(fs.existsSync(path.join(workspace, 'child-pid.txt')))
  const pid = Number(fs.readFileSync(path.join(workspace, 'child-pid.txt'), 'utf8'))
  controller.abort()
  assert.equal(JSON.parse(await pending).stopped, true)
  assert.throws(() => process.kill(pid, 0), 'Cancelled command killed the native child')
  await assert.rejects(command.runCommand({ command: 'git status', purpose: 'inspect' }, run))
  console.log(
    'PASS project commands: real Git init/commit/status/local clone, Java, C/C++, Make, exact approval/denial, paths with spaces, exit codes, bounded streaming, timeout, stale checks, retry cap and native process-tree cancellation'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
