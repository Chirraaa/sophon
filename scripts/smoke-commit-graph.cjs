const assert = require('node:assert/strict')
const { load } = require('./security/load.cjs')
const { commitGraph } = load('src/shared/commit-graph.ts')
const history = [
  { sha: 'merge', parents: ['left', 'right'] },
  { sha: 'left', parents: ['base'] },
  { sha: 'right', parents: ['base'] },
  { sha: 'base', parents: [] }
]
const graph = commitGraph(history)
assert.equal(graph.lanes, 2)
assert.equal(
  graph.rows[0].edges.filter((edge) => edge.half === 'bottom').length,
  2,
  'Merge splits into its actual parents'
)
assert.equal(graph.rows[2].lane, 1, 'Side commit keeps its own lane')
assert(
  graph.rows[2].edges.some((edge) => edge.from === 1 && edge.to === 0 && edge.half === 'bottom'),
  'Side ancestry rejoins the shared base'
)
assert.equal(
  graph.rows[3].edges.filter((edge) => edge.half === 'bottom').length,
  0,
  'Root has no invented parent'
)
assert.deepEqual(
  commitGraph(history.slice(0, 2)).rows,
  graph.rows.slice(0, 2),
  'Pagination preserves already drawn parent edges'
)
const linear = commitGraph([
  { sha: 'head', parents: ['root'] },
  { sha: 'root', parents: [] }
])
assert.equal(linear.lanes, 1)
assert.equal(linear.rows[1].edges[0].half, 'top')
assert.deepEqual(commitGraph([]), { rows: [], lanes: 1 })
const duplicateParents = commitGraph([{ sha: 'head', parents: ['base', 'base'] }])
assert.equal(
  duplicateParents.rows[0].edges.length,
  1,
  'Duplicate parent metadata never invents duplicate lanes'
)
console.log(
  'PASS commit graph: real merge parents, branch convergence, roots, pagination continuity and linear history'
)
