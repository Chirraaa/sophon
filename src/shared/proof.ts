// Data shapes of a coding task's verification contract. The main process owns the logic
// (src/main/workflow/proof); the renderer only displays these.

export type ClaimKind = 'behavior' | 'guard' | 'manual'
export type ProofSource = 'coordinator' | 'falsifier'
export type ProbeLanguage = 'node' | 'python'

export interface ProofClaim {
  id: string
  text: string
  kind: ClaimKind
  source: ProofSource
  withdrawn?: string
}

export interface ProbeSpec {
  id: string
  claim: string
  command?: string
  script?: { language: ProbeLanguage; source: string }
  path?: string
  files?: string[]
  timeout_seconds?: number
}

export interface ProbeObservation {
  revision: number
  passed: boolean
  exitCode: number | null
  definition: string
  deps: string
  fingerprint: string
  signals: string[]
  count: number
  at: number
  // Recorded in an earlier request: still history for witnesses, never current evidence.
  historical?: boolean
}

export interface ProofProbe extends ProbeSpec {
  definition: string
  source: ProofSource
  approved: boolean
  createdRevision: number
  history: ProbeObservation[]
  withdrawn?: string
}

export interface ProofState {
  version: 1
  claims: ProofClaim[]
  probes: ProofProbe[]
  amendments: string[]
  falsification: { rounds: number; admitted: number; survived: number }
}

export type ProbeStatus = 'unapproved' | 'unrun' | 'stale' | 'green' | 'red'
export type ClaimStatus =
  'witnessed' | 'unwitnessed' | 'held' | 'open' | 'unprobed' | 'manual' | 'withdrawn'

// Pure evidence rules, shared by the main process and the coding card.

export const activeProbes = (state: ProofState): ProofProbe[] =>
  state.probes.filter(
    (probe) =>
      !probe.withdrawn && !state.claims.find((claim) => claim.id === probe.claim)?.withdrawn
  )

export function probeStatus(probe: ProofProbe, revision: number): ProbeStatus {
  if (!probe.approved) return 'unapproved'
  const last = probe.history.at(-1)
  if (!last) return 'unrun'
  if (last.historical || last.revision !== revision || last.definition !== probe.definition)
    return 'stale'
  return last.passed ? 'green' : 'red'
}

// The red observation the current green transitioned from, if the transition is clean:
// same probe definition and same declared test files on both sides.
export function probeWitness(probe: ProofProbe): { red: number; green: number } | undefined {
  const green = probe.history.at(-1)
  if (!green?.passed || green.definition !== probe.definition) return undefined
  const red = probe.history.findLast(
    (item) =>
      !item.passed &&
      item.revision < green.revision &&
      item.definition === green.definition &&
      item.deps === green.deps
  )
  return red ? { red: red.revision, green: green.revision } : undefined
}

// A red→green transition exists, but the probe's own test files changed between them.
export function probeTestChanged(probe: ProofProbe): boolean {
  const green = probe.history.at(-1)
  return (
    !!green?.passed &&
    probe.history.some(
      (item) =>
        !item.passed &&
        item.revision < green.revision &&
        item.definition === green.definition &&
        item.deps !== green.deps
    )
  )
}

export function claimStatus(claim: ProofClaim, state: ProofState, revision: number): ClaimStatus {
  if (claim.withdrawn) return 'withdrawn'
  if (claim.kind === 'manual') return 'manual'
  const probes = activeProbes(state).filter((probe) => probe.claim === claim.id)
  if (!probes.length) return 'unprobed'
  if (probes.some((probe) => probeStatus(probe, revision) !== 'green')) return 'open'
  if (claim.kind === 'guard') return 'held'
  return probes.some((probe) => probeWitness(probe)) ? 'witnessed' : 'unwitnessed'
}
