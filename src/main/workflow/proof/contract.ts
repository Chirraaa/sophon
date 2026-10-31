import { createHash } from 'crypto'
import type { FailureFingerprint } from './fingerprint'
import {
  activeProbes,
  claimStatus,
  probeStatus,
  probeTestChanged,
  probeWitness
} from '../../../shared/proof'
import type {
  ClaimKind,
  ClaimStatus,
  ProbeObservation,
  ProbeSpec,
  ProbeStatus,
  ProofClaim,
  ProofProbe,
  ProofSource,
  ProofState
} from '../../../shared/proof'
export type {
  ClaimKind,
  ClaimStatus,
  ProbeObservation,
  ProbeSpec,
  ProbeStatus,
  ProofClaim,
  ProofProbe,
  ProofSource,
  ProofState
} from '../../../shared/proof'

// A verification contract turns "done" into falsifiable claims, each bound to executable
// probes. The host runs probes, records every observation against the mutation revision,
// and derives witnesses: a probe observed failing and later passing, with neither its
// definition nor its declared test files changed in between. Only that transition shows
// the change itself made the claim true; a probe that always passed is just a guard.

export const PROOF_LIMITS = {
  claims: 16,
  probes: 16,
  claimText: 300,
  command: 2000,
  script: 6000,
  files: 8,
  history: 8,
  amendments: 24,
  reason: 300
} as const

const ID = /^[a-z][a-z0-9-]{0,31}$/
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit && !value.includes('\0')
const relativePath = (value: unknown): value is string =>
  text(value, 400) &&
  !!value.trim() &&
  !/^(?:[A-Za-z]:|[\\/])/.test(value) &&
  !value.split(/[\\/]/).includes('..')

export function probeDefinition(spec: ProbeSpec): string {
  return hash({
    command: spec.command ?? null,
    script: spec.script ?? null,
    path: normalizePath(spec.path ?? '.'),
    files: [...(spec.files ?? [])].map(normalizePath).sort()
  })
}
export const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.'

function validClaim(value: unknown): value is ProofClaim {
  const claim = value as ProofClaim
  return (
    !!claim &&
    typeof claim === 'object' &&
    text(claim.id, 32) &&
    ID.test(claim.id) &&
    text(claim.text, PROOF_LIMITS.claimText) &&
    !!claim.text.trim() &&
    ['behavior', 'guard', 'manual'].includes(claim.kind) &&
    ['coordinator', 'falsifier'].includes(claim.source) &&
    (claim.withdrawn === undefined || text(claim.withdrawn, PROOF_LIMITS.reason))
  )
}

export function probeSpecIssue(spec: ProbeSpec): string | undefined {
  if (!spec || typeof spec !== 'object') return 'Each probe must be an object.'
  if (!text(spec.id, 32) || !ID.test(spec.id))
    return 'Probe ids are lowercase slugs such as p-empty-input.'
  if (!text(spec.claim, 32) || !ID.test(spec.claim))
    return `Probe ${spec.id} must name the id of the claim it tests.`
  if ((spec.command === undefined) === (spec.script === undefined))
    return `Probe ${spec.id} needs exactly one of command or script.`
  if (
    spec.command !== undefined &&
    (!text(spec.command, PROOF_LIMITS.command) || !spec.command.trim())
  )
    return `Probe ${spec.id} command must be 1-${PROOF_LIMITS.command} characters.`
  if (
    spec.script !== undefined &&
    (!spec.script ||
      !['node', 'python'].includes(spec.script.language) ||
      !text(spec.script.source, PROOF_LIMITS.script) ||
      !spec.script.source.trim())
  )
    return `Probe ${spec.id} script needs language node or python and 1-${PROOF_LIMITS.script} characters of source.`
  if (spec.path !== undefined && !relativePath(spec.path))
    return `Probe ${spec.id} path must be a workspace-relative folder.`
  if (
    spec.files !== undefined &&
    (!Array.isArray(spec.files) ||
      spec.files.length > PROOF_LIMITS.files ||
      !spec.files.every(relativePath))
  )
    return `Probe ${spec.id} files must be at most ${PROOF_LIMITS.files} workspace-relative paths.`
  if (
    spec.timeout_seconds !== undefined &&
    (!Number.isInteger(spec.timeout_seconds) ||
      spec.timeout_seconds < 1 ||
      spec.timeout_seconds > 600)
  )
    return `Probe ${spec.id} timeout_seconds must be an integer from 1 to 600.`
  return undefined
}

function validObservation(value: unknown): value is ProbeObservation {
  const o = value as ProbeObservation
  return (
    !!o &&
    typeof o === 'object' &&
    Number.isSafeInteger(o.revision) &&
    o.revision >= 0 &&
    typeof o.passed === 'boolean' &&
    (o.exitCode === null || Number.isInteger(o.exitCode)) &&
    text(o.definition, 32) &&
    text(o.deps, 32) &&
    text(o.fingerprint, 32) &&
    Array.isArray(o.signals) &&
    o.signals.length <= 12 &&
    o.signals.every((signal) => text(signal, 240)) &&
    Number.isSafeInteger(o.count) &&
    typeof o.at === 'number' &&
    Number.isFinite(o.at) &&
    (o.historical === undefined || typeof o.historical === 'boolean')
  )
}

export function validProofState(value: unknown): value is ProofState {
  const state = value as ProofState
  if (!state || typeof state !== 'object' || state.version !== 1) return false
  if (
    !Array.isArray(state.claims) ||
    state.claims.length > PROOF_LIMITS.claims ||
    !state.claims.every(validClaim) ||
    new Set(state.claims.map((claim) => claim.id)).size !== state.claims.length
  )
    return false
  if (
    !Array.isArray(state.probes) ||
    state.probes.length > PROOF_LIMITS.probes ||
    new Set(state.probes.map((probe) => probe.id)).size !== state.probes.length
  )
    return false
  for (const probe of state.probes)
    if (
      probeSpecIssue(probe) ||
      !state.claims.some((claim) => claim.id === probe.claim) ||
      probe.definition !== probeDefinition(probe) ||
      !['coordinator', 'falsifier'].includes(probe.source) ||
      typeof probe.approved !== 'boolean' ||
      !Number.isSafeInteger(probe.createdRevision) ||
      !Array.isArray(probe.history) ||
      probe.history.length > PROOF_LIMITS.history ||
      !probe.history.every(validObservation) ||
      (probe.withdrawn !== undefined && !text(probe.withdrawn, PROOF_LIMITS.reason))
    )
      return false
  const f = state.falsification
  return (
    Array.isArray(state.amendments) &&
    state.amendments.length <= PROOF_LIMITS.amendments &&
    state.amendments.every((entry) => text(entry, 400)) &&
    !!f &&
    [f.rounds, f.admitted, f.survived].every((n) => Number.isSafeInteger(n) && n >= 0)
  )
}

const emptyState = (): ProofState => ({
  version: 1,
  claims: [],
  probes: [],
  amendments: [],
  falsification: { rounds: 0, admitted: 0, survived: 0 }
})

export type ContractSubmission = {
  claims?: { id: string; text: string; kind: ClaimKind }[]
  probes?: ProbeSpec[]
  withdraw?: { id: string; reason: string }[]
}

export class ProofContract {
  private state: ProofState

  constructor(previous?: ProofState) {
    if (previous && validProofState(previous)) {
      // A resumed task keeps its contract and observation history, but no approval
      // carries over and no earlier observation counts as current evidence.
      this.state = structuredClone(previous)
      for (const probe of this.state.probes) {
        probe.approved = false
        for (const observation of probe.history) observation.historical = true
      }
    } else this.state = emptyState()
  }

  snapshot(): ProofState {
    return structuredClone(this.state)
  }
  get hasClaims(): boolean {
    return this.state.claims.some((claim) => !claim.withdrawn)
  }
  get hasProbes(): boolean {
    return this.activeProbes().length > 0
  }
  get falsification(): ProofState['falsification'] {
    return { ...this.state.falsification }
  }
  claim(id: string): ProofClaim | undefined {
    return this.state.claims.find((claim) => claim.id === id)
  }
  probe(id: string): ProofProbe | undefined {
    return this.state.probes.find((probe) => probe.id === id)
  }
  activeProbes(): ProofProbe[] {
    return activeProbes(this.state)
  }
  behaviorClaims(): ProofClaim[] {
    return this.state.claims.filter((claim) => claim.kind === 'behavior' && !claim.withdrawn)
  }

  private amend(entry: string): void {
    this.state.amendments = [...this.state.amendments, entry.slice(0, 400)].slice(
      -PROOF_LIMITS.amendments
    )
  }

  // Validates the whole submission before changing anything. Returns probes that are new
  // or redefined: they need approval before the host may run them.
  submit(
    input: ContractSubmission,
    revision: number,
    source: ProofSource = 'coordinator'
  ): ProofProbe[] {
    const next = structuredClone(this.state)
    const changed: ProofProbe[] = []
    for (const entry of input.withdraw ?? []) {
      if (!entry || !text(entry.id, 32) || !text(entry.reason, PROOF_LIMITS.reason))
        throw new Error('withdraw entries need an id and a reason of at most 300 characters.')
      if (entry.reason.trim().length < 8)
        throw new Error(`Explain why ${entry.id} is withdrawn; the reason appears in the proof.`)
      const claim = next.claims.find((item) => item.id === entry.id)
      const probe = next.probes.find((item) => item.id === entry.id)
      if (!claim && !probe) throw new Error(`Nothing named ${entry.id} exists to withdraw.`)
      if (claim) claim.withdrawn = entry.reason.trim()
      if (probe) probe.withdrawn = entry.reason.trim()
      next.amendments = [
        ...next.amendments,
        `r${revision}: withdrew ${claim ? 'claim' : 'probe'} ${entry.id} — ${entry.reason.trim()}`
      ].slice(-PROOF_LIMITS.amendments)
    }
    for (const input_claim of input.claims ?? []) {
      const claim: ProofClaim = {
        id: input_claim?.id,
        text: typeof input_claim?.text === 'string' ? input_claim.text.trim() : '',
        kind: input_claim?.kind,
        source
      }
      if (!validClaim(claim))
        throw new Error(
          'Each claim needs an id slug, text of at most 300 characters and kind behavior, guard or manual.'
        )
      const old = next.claims.find((item) => item.id === claim.id)
      if (old) {
        if (old.text !== claim.text || old.kind !== claim.kind) {
          next.amendments = [
            ...next.amendments,
            `r${revision}: restated claim ${claim.id} as ${claim.kind}: ${claim.text}`
          ].slice(-PROOF_LIMITS.amendments)
          old.text = claim.text
          old.kind = claim.kind
        }
        delete old.withdrawn
      } else next.claims.push(claim)
    }
    if (next.claims.length > PROOF_LIMITS.claims)
      throw new Error(`A contract holds at most ${PROOF_LIMITS.claims} claims.`)
    for (const spec of input.probes ?? []) {
      const issue = probeSpecIssue(spec)
      if (issue) throw new Error(issue)
      const claim = next.claims.find((item) => item.id === spec.claim)
      if (!claim) throw new Error(`Probe ${spec.id} names unknown claim ${spec.claim}.`)
      if (claim.kind === 'manual')
        throw new Error(`Claim ${claim.id} is manual; restate it as behavior or guard to probe it.`)
      const clean: ProbeSpec = {
        id: spec.id,
        claim: spec.claim,
        ...(spec.command !== undefined ? { command: spec.command } : {}),
        ...(spec.script !== undefined
          ? { script: { language: spec.script.language, source: spec.script.source } }
          : {}),
        ...(spec.path !== undefined ? { path: normalizePath(spec.path) } : {}),
        ...(spec.files?.length ? { files: spec.files.map(normalizePath) } : {}),
        ...(spec.timeout_seconds !== undefined ? { timeout_seconds: spec.timeout_seconds } : {})
      }
      const definition = probeDefinition(clean)
      const index = next.probes.findIndex((item) => item.id === spec.id)
      const old = next.probes[index]
      if (old && old.definition === definition && old.claim === clean.claim) {
        delete old.withdrawn
        // Unchanged, but not approved (declined, or carried over from an earlier request):
        // resubmitting asks the user again, with its history kept.
        if (!old.approved) changed.push(old)
        continue
      }
      const probe: ProofProbe = {
        ...clean,
        definition,
        source,
        approved: false,
        createdRevision: revision,
        history: []
      }
      if (old) {
        next.amendments = [
          ...next.amendments,
          `r${revision}: redefined probe ${spec.id}; its earlier observations no longer count`
        ].slice(-PROOF_LIMITS.amendments)
        next.probes[index] = probe
      } else next.probes.push(probe)
      changed.push(probe)
    }
    if (next.probes.length > PROOF_LIMITS.probes)
      throw new Error(
        `A contract holds at most ${PROOF_LIMITS.probes} probes; withdraw or redefine existing ones.`
      )
    if (!validProofState(next)) throw new Error('The contract is outside its bounds.')
    this.state = next
    return changed.map((probe) => structuredClone(probe))
  }

  approve(ids: string[]): void {
    for (const probe of this.state.probes) if (ids.includes(probe.id)) probe.approved = true
  }

  observe(
    id: string,
    result: {
      revision: number
      exitCode: number | null
      passed: boolean
      deps: string
      fingerprint: FailureFingerprint
    }
  ): ProbeObservation {
    const probe = this.probe(id)
    if (!probe) throw new Error(`Unknown probe ${id}.`)
    const observation: ProbeObservation = {
      revision: result.revision,
      passed: result.passed,
      exitCode: result.exitCode,
      definition: probe.definition,
      deps: result.deps,
      fingerprint: result.passed ? '' : result.fingerprint.key,
      signals: result.passed ? [] : [...result.fingerprint.signals],
      count: result.passed ? 0 : result.fingerprint.count,
      at: Date.now()
    }
    // Keep the earliest observation so a baseline red is never pushed out by retries.
    const [first, ...rest] = [...probe.history, observation]
    probe.history =
      rest.length >= PROOF_LIMITS.history
        ? [first, ...rest.slice(-(PROOF_LIMITS.history - 1))]
        : [first, ...rest]
    return structuredClone(observation)
  }

  private latest(probe: ProofProbe): ProbeObservation | undefined {
    return probe.history.at(-1)
  }

  probeStatus(probe: ProofProbe, revision: number): ProbeStatus {
    return probeStatus(probe, revision)
  }

  witness(probe: ProofProbe): { red: number; green: number } | undefined {
    return probeWitness(probe)
  }

  private testChanged(probe: ProofProbe): boolean {
    return probeTestChanged(probe)
  }

  claimStatus(claim: ProofClaim, revision: number): ClaimStatus {
    return claimStatus(claim, this.state, revision)
  }

  // Approved probes whose evidence does not describe the current code.
  pending(revision: number): ProofProbe[] {
    return this.activeProbes().filter((probe) =>
      ['unrun', 'stale'].includes(this.probeStatus(probe, revision))
    )
  }

  // What stops the contract from being proven at this revision.
  openIssue(revision: number): string | undefined {
    const issues: string[] = []
    for (const probe of this.activeProbes()) {
      const status = this.probeStatus(probe, revision)
      if (status === 'red') {
        const last = this.latest(probe)!
        issues.push(
          `probe ${probe.id} (claim ${probe.claim}) fails` +
            (last.signals.length ? `: ${last.signals.slice(0, 3).join(' | ')}` : '')
        )
      } else if (status === 'unapproved')
        issues.push(`probe ${probe.id} was not approved to run, so it proves nothing`)
      else if (status !== 'green') issues.push(`probe ${probe.id} has not run on the current code`)
    }
    // Claims without a probe are reported as unverified rather than blocking completion.
    return issues.length ? issues.join('; ') + '.' : undefined
  }

  // Behavior claims that pass but never failed: nothing shows the change made them true.
  unwitnessed(revision: number): ProofClaim[] {
    return this.behaviorClaims().filter(
      (claim) => this.claimStatus(claim, revision) === 'unwitnessed'
    )
  }

  recordFalsification(admitted: number, survived: number): void {
    this.state.falsification = {
      rounds: this.state.falsification.rounds + 1,
      admitted: this.state.falsification.admitted + admitted,
      survived: this.state.falsification.survived + survived
    }
  }

  // Falsifier probes that passed become guards: the attack failed, the property holds.
  settleFalsifierProbe(id: string, held: boolean, revision: number): void {
    const probe = this.probe(id)
    const claim = probe && this.claim(probe.claim)
    if (!probe || !claim || claim.source !== 'falsifier') return
    if (held) claim.kind = 'guard'
    this.amend(
      `r${revision}: falsifier probe ${id} ${held ? 'did not break the change (kept as a guard)' : 'broke the change (admitted as a behavior claim)'}`
    )
  }

  // Compact model-facing view: enough to act on, nothing it can mistake for permission.
  context(revision: number): string {
    return JSON.stringify({
      revision,
      claims: this.state.claims.map((claim) => ({
        id: claim.id,
        kind: claim.kind,
        source: claim.source,
        status: this.claimStatus(claim, revision),
        text: claim.text.slice(0, 160)
      })),
      probes: this.activeProbes().map((probe) => {
        const last = this.latest(probe)
        const witness = this.witness(probe)
        return {
          id: probe.id,
          claim: probe.claim,
          status: this.probeStatus(probe, revision),
          ...(witness ? { witness: `red r${witness.red} -> green r${witness.green}` } : {}),
          ...(last && !last.passed ? { failure: last.signals.slice(0, 4) } : {})
        }
      }),
      ...(this.state.amendments.length ? { amendments: this.state.amendments.slice(-3) } : {})
    })
  }

  report(revision: number): string {
    const label: Record<ClaimStatus, string> = {
      witnessed: 'witnessed',
      unwitnessed: 'passes, but never observed failing (not a witness of the change)',
      held: 'holds',
      open: 'not proven',
      unprobed: 'no probe',
      manual: 'manual check, not automated',
      withdrawn: 'withdrawn'
    }
    const lines = this.state.claims.map((claim) => {
      const status = this.claimStatus(claim, revision)
      const probes = this.activeProbes().filter((probe) => probe.claim === claim.id)
      const evidence = probes
        .map((probe) => {
          const witness = this.witness(probe)
          const state = this.probeStatus(probe, revision)
          return witness && state === 'green'
            ? `${probe.id} red at r${witness.red} → green at r${witness.green}`
            : this.testChanged(probe) && state === 'green'
              ? `${probe.id} green; its test files changed after it failed`
              : `${probe.id} ${state}`
        })
        .join(', ')
      return (
        `- ${claim.source === 'falsifier' ? '[falsifier] ' : ''}${claim.id}: ${claim.text} — ${label[status]}` +
        (claim.withdrawn ? ` (${claim.withdrawn})` : evidence ? ` (${evidence})` : '')
      )
    })
    const f = this.state.falsification
    if (f.rounds)
      lines.push(
        `- Falsification: ${f.rounds} round${f.rounds === 1 ? '' : 's'}, ${f.admitted} probe${f.admitted === 1 ? '' : 's'} broke the change and became claims, ${f.survived} did not break it.`
      )
    for (const entry of this.state.amendments.slice(-4)) lines.push(`- Amendment ${entry}`)
    return lines.join('\n')
  }
}
