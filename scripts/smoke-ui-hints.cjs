const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const labels = load('src/shared/action-label.ts')
const { actionError, actionHint, actionLabel } = load(
  'src/renderer/src/lib/action-presentation.ts',
  {
    '../../../shared/action-label': labels
  }
)
const action = {
  id: 'read',
  name: 'read_file',
  label: 'Read files and pictures',
  status: 'done',
  detail: JSON.stringify({
    sourceId: 'internal-id',
    kind: 'local-file-excerpt',
    trust: 'untrusted-data',
    content: '<main>Private file contents</main>'
  })
}
assert.equal(actionHint(action), 'Read files and pictures · Complete')
for (const [name, label] of [
  ['discover_tools', 'Load tool instructions'],
  ['coding_resources', 'Adjust coding working sizes'],
  ['coding_checkpoint', 'Save coding progress'],
  ['future_tool', 'Future tool'],
  ['', 'Action']
]) {
  const saved = { ...action, name, label: 'Unknown action' }
  assert.equal(actionLabel(saved), label)
  assert.equal(actionHint(saved), `${label} · Complete`)
  assert.equal(actionLabel({ ...saved, label: '' }), label)
}
assert.equal(actionLabel(action), action.label, 'Preserve existing descriptive labels')
assert.equal(actionError(action), undefined)
for (const detail of [action.detail, action.detail.slice(0, 80), '[{"result":"raw"}]']) {
  const failed = { ...action, status: 'failed', detail }
  assert.equal(actionError(failed), 'The action could not be completed.')
  assert.doesNotMatch(actionHint(failed), /sourceId|content|internal-id|raw/)
}
assert.equal(
  actionError({ ...action, status: 'failed', detail: 'Denied by the user.' }),
  'Denied by the user.'
)
assert.equal(
  actionError({ ...action, status: 'failed', detail: 'Request\n  timed out.' }),
  'Request timed out.'
)
assert.equal(actionError({ ...action, status: 'failed', detail: 'x'.repeat(1000) }).length, 220)
assert.equal(actionError({ ...action, status: 'failed', detail: '' }), undefined)
assert.match(actionHint({ ...action, status: 'running' }), /In progress$/)
assert.match(actionHint({ ...action, status: 'waiting' }), /Awaiting approval$/)
console.log('PASS action hints exclude raw tool results and bound readable failures')
