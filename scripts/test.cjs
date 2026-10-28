const { spawnSync } = require('node:child_process')
const path = require('node:path')

const suites = [
  'action-outcomes',
  'app-routing',
  'apps',
  'awareness',
  'browser',
  'capabilities',
  'chatgpt',
  'coding',
  'coding-harness',
  'coding-quality',
  'coding-resources',
  'commit-graph',
  'compaction',
  'controls',
  'conversation',
  'exa',
  'github',
  'github-api',
  'github-auth',
  'github-checkout',
  'github-checkout-git',
  'github-history-cache',
  'github-restore',
  'harness',
  'harness-outcomes',
  'harness-rollback',
  'harness-store',
  'icons',
  'licenses',
  'live-comparison',
  'long-task-memory',
  'memory',
  'model-insights',
  'npm',
  'pages',
  'plugins',
  'powershell-worker',
  'project-commands',
  'providers',
  'screen',
  'screen-glow',
  'security',
  'settings',
  'specialists',
  'streaming',
  'system-control',
  'time',
  'updates',
  'ui-hints',
  'ui-actions',
  'visual-replies',
  'voice-privacy',
  'web',
  'workflow'
]
let failures = 0
for (const name of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, `smoke-${name}.cjs`)], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  })
  if (result.status === 0) console.log(`PASS ${name}`)
  else {
    failures++
    console.error(`FAIL ${name}\n${result.stdout}${result.stderr}`)
    if (result.error) console.error(result.error.message)
  }
}
console.log(`${suites.length - failures}/${suites.length} offline suites passed`)
process.exitCode = failures ? 1 : 0
