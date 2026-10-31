// Composer placeholder for a message sent while the chat is working.
export const routePlaceholder = (route: AgentRoute): string =>
  route === 'steer'
    ? 'Add to the current request…'
    : route === 'parallel'
      ? 'Start another task in parallel…'
      : 'Ask for something else, or change the running task…'
