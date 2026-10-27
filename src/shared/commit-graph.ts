export interface GraphCommit {
  sha: string
  parents: string[]
}
interface Lane {
  sha: string
  color: number
}
export interface GraphEdge {
  from: number
  to: number
  half: 'top' | 'bottom'
  color: number
}
export interface GraphRow {
  lane: number
  color: number
  edges: GraphEdge[]
}

export function commitGraph(commits: GraphCommit[]): { rows: GraphRow[]; lanes: number } {
  const pending: Lane[] = []
  let nextColor = 0
  let width = 1
  const rows = commits.map((commit): GraphRow => {
    let lane = pending.findIndex((item) => item.sha === commit.sha)
    const edges: GraphEdge[] = pending.map((item, index) => ({
      from: index,
      to: index,
      half: 'top',
      color: item.color
    }))
    if (lane < 0) {
      lane = pending.length
      pending.push({ sha: commit.sha, color: nextColor++ % 5 })
    }
    const color = pending[lane].color
    const before = [...pending]
    pending.splice(lane, 1)
    const parents = [...new Set(commit.parents)]
    parents.forEach((sha, index) => {
      if (pending.some((item) => item.sha === sha)) return
      const item = { sha, color: index === 0 ? color : nextColor++ % 5 }
      if (index === 0) pending.splice(Math.min(lane, pending.length), 0, item)
      else pending.push(item)
    })
    before.forEach((item, index) => {
      if (index === lane) return
      edges.push({
        from: index,
        to: pending.findIndex((next) => next.sha === item.sha),
        half: 'bottom',
        color: item.color
      })
    })
    parents.forEach((sha) => {
      const target = pending.findIndex((item) => item.sha === sha)
      edges.push({ from: lane, to: target, half: 'bottom', color: pending[target].color })
    })
    width = Math.max(width, before.length, pending.length)
    return { lane, color, edges }
  })
  return { rows, lanes: width }
}
