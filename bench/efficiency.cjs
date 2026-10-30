// Per-run efficiency measures taken from the recorded model requests. They need no live model:
// scripted responses give the same numbers, so changes to prompt layout or tool batching can be
// compared offline.

// Tools that only read. Whether a call also needs approval depends on the user's permission
// settings (every one of these defaults to "ask"), so this counts what could run side by side
// at most.
const READ_ONLY = new Set([
  'read_file',
  'list_files',
  'web_search',
  'web_fetch',
  'notes_list',
  'notes_read',
  'calendar_list',
  'list_windows',
  'list_apps',
  'list_audio'
])

function batchOf(request) {
  const message = request.response?.choices?.[0]?.message
  if (message) return (message.tool_calls ?? []).map((call) => call.function?.name)
  return (request.response?.output ?? [])
    .filter((item) => item.type === 'function_call')
    .map((item) => item.name)
}

// What a prompt cache can see, in wire order: tool schemas first, then the messages.
function prompt(body) {
  const items = body?.messages ?? body?.input ?? []
  return JSON.stringify(body?.tools ?? []) + items.map((item) => JSON.stringify(item)).join('')
}

function sharedPrefix(a, b) {
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index++
  return index
}

function efficiency(requests) {
  const batches = requests.map(batchOf).filter((names) => names.length)
  const multi = batches.filter((names) => names.length > 1)
  const parallelizable = multi.filter((names) => names.every((name) => READ_ONLY.has(name)))
  const prompts = requests.filter((request) => request.body).map((request) => prompt(request.body))
  let reused = 0
  let previous = 0
  for (let index = 1; index < prompts.length; index++) {
    reused += sharedPrefix(prompts[index - 1], prompts[index])
    previous += prompts[index - 1].length
  }
  const usage = requests.map((request) => request.response?.usage)
  const cached = usage.reduce(
    (sum, u) =>
      sum +
      (u?.prompt_tokens_details?.cached_tokens ??
        u?.input_tokens_details?.cached_tokens ??
        u?.cache_read_input_tokens ??
        0),
    0
  )
  return {
    modelCalls: requests.length,
    toolBatches: batches.length,
    multiCallBatches: multi.length,
    // Batches whose calls are all read-only, so they could overlap.
    parallelizableBatches: parallelizable.length,
    parallelizableCalls: parallelizable.reduce((sum, names) => sum + names.length, 0),
    // Share of the previous request's prompt that the next request repeats from its start.
    // 1 means a prompt cache could reuse everything already processed.
    prefixReuse: previous ? reused / previous : null,
    cachedTokens: cached
  }
}

module.exports = { efficiency, READ_ONLY }
