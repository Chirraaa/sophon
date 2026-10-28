import { WorkflowController } from './controller'
import { CodingVerification } from './coding-verification'
import { CodingSession, wantsCodingSession } from './coding-session'
import type { ActionRecord } from './action-ledger'
import type { ToolOutcome } from './tool-outcome'

// Commit an action once, update all projections, then publish a coherent state.
export class TaskRuntime {
  readonly workflow: WorkflowController
  readonly coding: CodingVerification
  readonly session: CodingSession
  constructor(
    runId: string,
    mode: TaskMode,
    workspace: string,
    goal: string,
    previous: WorkflowState | undefined,
    publish: (state: WorkflowState) => void
  ) {
    this.workflow = new WorkflowController(runId, mode, workspace, goal, previous, publish, false)
    this.coding = new CodingVerification(this.workflow.actions)
    this.session = new CodingSession(
      wantsCodingSession(this.workflow.snapshot().goal, workspace),
      this.workflow.resumed ? this.workflow.snapshot().codingSession : undefined,
      this.workflow.actions
    )
    this.workflow.publishEvidence(
      this.workflow.resumed && this.session.active ? this.session.snapshot() : undefined
    )
  }
  record(actionId: string, outcome: ToolOutcome): ActionRecord {
    const record = this.workflow.afterAction(actionId, outcome, false)
    this.coding.record(record)
    this.session.record(record)
    this.workflow.publishEvidence(this.session.active ? this.session.snapshot() : undefined)
    return record
  }
  interrupt(): void {
    this.workflow.interrupt(false)
    this.workflow.publishEvidence(this.session.active ? this.session.snapshot() : undefined)
  }
}
