// The assistant runs inside the chat it is asked to clear, so the clear is
// recorded here and carried out by the session once the reply has finished.
// Requests are kept per run: with parallel agents, one run's clear must never be
// taken by another run that happens to finish first.
const requested = new Set<string>()

export function requestChatClear(runId = ''): string {
  requested.add(runId)
  return 'Approved. The chat will be cleared as soon as this reply ends. Do not write more than one short sentence.'
}
export function takeChatClear(runId = ''): boolean {
  return requested.delete(runId)
}
