import { createHash } from 'crypto'

// What failed, independent of when it ran, how long it took or where a line moved to.
// Two failing runs with the same key gave the model no new information.
export type FailureFingerprint = Readonly<{
  key: string
  // Normalized diagnostic lines, in output order, for feedback and diagnosis.
  signals: readonly string[]
  // Best estimate of how many distinct things are failing; used to detect progress.
  count: number
  // Source files named by the diagnostics (workspace-relative where possible).
  paths: readonly string[]
}>

const SIGNAL =
  /\b(?:error|errors|fail|failed|failure|failures|failing|assert(?:ion)?(?:error)?|expected|exception|panic(?:ked)?|cannot|undefined is not|is not a function|not found|traceback|segmentation fault|TS\d{4}|CS\d{4}|E\d{4})\b|[✗✖×●]/i
// Summary lines carry the number of failures but are not themselves a failure.
const SUMMARY =
  /(\d+)\s+(?:tests?\s+)?(?:failed|failing|failures?|errors?)\b|#\s*fail\s+(\d+)|found\s+(\d+)\s+errors?|failures?:\s*(\d+)/gi
const SOURCE =
  /(?:[A-Za-z]:)?(?:[\w@.-]+[\\/])*[\w@.-]+\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|cs|fs|cpp|cc|c|hpp|h|rb|php|swift|vue|svelte)\b/g

function normalize(line: string): string {
  return (
    line
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<time>')
      .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
      .replace(/\(\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|m)\)/gi, '')
      .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds)\b/gi, '<duration>')
      // Line and column numbers move with every edit above the failure.
      .replace(/([\w)\]])[:(]\d+(?:[:,]\d+)?\)?/g, '$1')
      .replace(/\bline \d+\b/gi, 'line')
      .replace(/[A-Za-z]:\\(?:[^\\\s:'"]+\\)+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 240)
  )
}

// Diagnostic codes (TS2322, CS0103, E0382) identify the failure; other digits are noise.
const digits = (line: string): string =>
  line.replace(/\b([a-z]{1,3}\d{3,5})\b|\d+/gi, (_match, code: string | undefined) => code ?? '#')

function relative(path: string, workspace: string): string {
  const slash = path.replace(/\\/g, '/')
  const root = workspace.replace(/\\/g, '/').replace(/\/+$/, '')
  return root && slash.toLowerCase().startsWith(root.toLowerCase() + '/')
    ? slash.slice(root.length + 1)
    : slash.replace(/^\.\//, '')
}

export function failureFingerprint(output: string, workspace = ''): FailureFingerprint {
  const signals: string[] = []
  const seen = new Set<string>()
  let summarized = 0
  const paths = new Set<string>()
  const lines = output.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.length > 600) continue
    for (const match of line.matchAll(SUMMARY)) {
      const value = Number(match[1] ?? match[2] ?? match[3] ?? match[4])
      if (Number.isFinite(value)) summarized = Math.max(summarized, value)
    }
    if (!SIGNAL.test(line)) continue
    for (const match of line.matchAll(SOURCE)) {
      const path = relative(match[0], workspace)
      if (!/(?:^|\/)node_modules\//.test(path) && !/^node:/.test(path) && paths.size < 12)
        paths.add(path)
    }
    // Summary counts are compared separately; their digits would make every run unique.
    const normalized = digits(normalize(line))
    if (seen.has(normalized)) continue
    seen.add(normalized)
    if (signals.length < 40) signals.push(normalized)
  }
  const material = signals.length
    ? [...signals].sort()
    : lines
        .map((line) => digits(normalize(line)))
        .filter(Boolean)
        .slice(-5)
  return Object.freeze({
    key: createHash('sha256').update(material.join('\n')).digest('hex').slice(0, 16),
    signals: Object.freeze(signals.slice(0, 12)),
    count: Math.max(summarized, signals.length, 1),
    paths: Object.freeze([...paths])
  })
}

// Command tools return JSON with an enveloped output; anything else is used verbatim.
export function commandText(text: string): string {
  try {
    const result = JSON.parse(text)
    const output = result?.output
    if (typeof output === 'string') return output
    if (output && typeof output.content === 'string') return output.content
  } catch {
    /* Not a structured command result. */
  }
  return text
}
