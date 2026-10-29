// The assistant runs inside the chat it is asked to clear, so the clear is
// recorded here and carried out by the session once the reply has finished.
let requested = false

export function requestChatClear(): string {
  requested = true
  return 'Approved. The chat will be cleared as soon as this reply ends. Do not write more than one short sentence.'
}
export function takeChatClear(): boolean {
  const value = requested
  requested = false
  return value
}
