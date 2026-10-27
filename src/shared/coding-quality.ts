import { retrieveCodingExamples } from './coding-examples'
export const CODING_QUALITY_CORE = `CODING TEACHER:
Apply these guides only to the authorized scope; a topic match is a reminder, not a request to add a feature. Respect project conventions and explicit exclusions. These built-in guides need no skill assignment: use skill "none" unless an actual catalog document was read.
Before edits, identify observable acceptance criteria, the smallest design, relevant failure cases and a verification approach. Record these in a saved plan only when one helps substantial multi-step work. Routine edits and project inspection need no checkpoint or reviewer call. Group scaffold, implementation and test setup into a working slice before marking a saved task implemented: the host checks task boundaries, so an unfinished default scaffold is not ready. Keep planning proportionate to the request.
Prefer clear names, cohesive functions/modules, explicit boundaries and one source of truth. Reuse sound existing dependencies; introduce an abstraction only when it removes real duplication or isolates a meaningful responsibility. Validate external input at trust boundaries, preserve useful types, and handle errors without swallowing them or exposing secrets.
For affected hot paths, define n (records, requests, bytes), estimate time/space and I/O costs, and consider the expected size. A simple O(n) scan is often right for a small list; repeated scans inside a large loop can become O(n^2). Use measured bottlenecks or clear scale requirements before adding caches, memoization or infrastructure. Explain estimates as estimates, never measurements.
Implement a small complete behavior, then check it. Add behavior tests for meaningful changes: normal flow, a boundary, and a likely failure/regression. Use existing test tools. Trace a counterexample before claiming a fix works. A test must fail for the relevant broken behavior; checking a keyword or mocked success alone is insufficient. For tiny cosmetic changes use an appropriate focused check. Report actual results and gaps. Do not invent library APIs or session accessor properties; use observed project helpers, or label a conceptual sketch as pseudocode when the actual API is unknown. Before finishing simplify unnecessary code and explain only consequential decisions.`

type Topic = {
  id: string
  matches: RegExp
  guide: string
  example?: string
  sources: string[]
}

const TOPICS: Topic[] = [
  {
    id: 'auth',
    matches:
      /\b(auth(?:entication|orization)?|login|log[ -]?in|sign[ -]?(?:in|up|out)|sessions?|passwords?|oauth|jwt|rbac|permissions?|tenants?|roles?)\b/i,
    guide:
      'AUTH: Separate identity, session validity and permission to this resource/action. Reuse a maintained compatible auth library/provider; do not invent crypto or password storage. Deny by default at protected server entry points and enforce ownership/tenant/role checks near data access, deriving identity from the verified session rather than request userId. UI hiding and redirects are UX, never the sole guard. Use server-managed sessions and HttpOnly/Secure cookies in production with an explicit SameSite policy; preserve provider CSRF/state/PKCE checks and validate return URLs. Do not put browser session credentials in localStorage, logs or client bundles. Handle expiry, logout/revocation and unauthenticated vs forbidden responses. Test direct API/action access, expired/tampered sessions and user A attempting to read/update user B resources; a redirect test alone is insufficient. Do not add auth to a guest-only app.',
    example:
      'AUTH CHECK: A cookie existing does not prove a valid session. Use the project auth library to verify it, not an invented request.authenticatedUser property. Include authorized owner/tenant in a mutation predicate or a correct transaction; a separate authorization read then an unscoped write can race. If the actual session API is unavailable, describe the fix as pseudocode.',
    sources: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html',
      'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html'
    ]
  },
  {
    id: 'nextjs',
    matches:
      /\b(next\.?js|nextjs|server actions?|route handlers?|app router|middleware|proxy\.ts)\b|\bnext\b(?=.*\b(?:react|app|framework)\b)/i,
    guide:
      'NEXT.JS: Inspect installed Next.js version and router before choosing APIs or file conventions; verify current official docs for that version. For Next.js 16 the middleware convention was renamed proxy.ts; older supported projects may use middleware.ts. Do not blindly migrate unrelated code. Middleware/Proxy can perform lightweight early session checks and redirects when useful; it is optional and cannot replace authorization in Server Actions, Route Handlers and a server-only data access layer. Check library/runtime compatibility. Keep secrets and private data server-side, return minimal DTOs, validate action inputs and avoid sharing user-specific cached data across users. Treat Server Actions as directly reachable endpoints; a layout check is insufficient. If docs are unavailable record the limit, do not invent installed-version evidence.',
    sources: [
      'https://nextjs.org/docs/app/guides/authentication',
      'https://nextjs.org/docs/app/api-reference/file-conventions/proxy'
    ]
  },
  {
    id: 'data',
    matches:
      /\b(database|sql|queries|query|postgres(?:ql)?|sqlite|prisma|drizzle|migration|transactions?|pagination|indexes|indexing)\b/i,
    guide:
      'DATA: Model invariants with appropriate types, constraints and transactions, not only UI checks. Parameterize queries; bound reads with pagination and select needed fields. Watch N+1 queries and unnecessary round trips; consider indexes against actual filters/order and inspect a query plan before claiming an improvement. Scope private queries to the verified owner/tenant. Preserve migration compatibility and existing data; explain destructive changes before acting. Test duplicate/conflicting writes, empty results and rollback/error paths where relevant.',
    sources: ['https://www.postgresql.org/docs/current/using-explain.html']
  },
  {
    id: 'performance',
    matches:
      /\b(complexity|algorithm|performance|optimi[sz]e|optimi[sz]ation|slow|scal(?:e|ing|ability)|large|million|deduplicat\w*|sort(?:ing)?|search(?:ing)?|batch(?:ing)?)\b/i,
    guide:
      'COMPLEXITY: Trace the actual loops, sorting and I/O. For repeated membership lookups, a Set/Map may reduce expected lookup cost at an O(n) memory/build cost; preserve output order, equality semantics and duplicates policy. Distinguish expected, worst-case and amortized bounds when they differ. Include output size and extra allocations, query/network counts and input limits. Compare a simple baseline on representative sizes only when a benchmark is needed and available. Test empty input, duplicates, large/boundary inputs and preserved semantics. Do not claim O(1) for an entire operation that builds an index or scans its output.',
    example:
      'COUNTEREXAMPLE: A Set filter without seen.add never removes duplicates. Correct update: if (!seen.has(value)) { seen.add(value); output.push(value) }. Trace ["a", "a"] and test it. Include variable string-length hashing/comparison costs when relevant. Do not describe unmeasured latency as instantaneous or invent numeric thresholds for caches.',
    sources: ['https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/']
  },
  {
    id: 'ui-design',
    matches:
      /\b(ui|ux|css|html|layout|design|styling|typography|theme|responsive|frontend|dashboard|website|forms?)\b|\b(?:todo|to-do) app\b/i,
    guide:
      'UI DESIGN: First identify the screen purpose, primary action and content hierarchy. Reuse the project design system/components; choose a restrained type scale, spacing scale, semantic colors and consistent radii as tokens. Group related controls, align content, distinguish primary/secondary/destructive actions and use whitespace rather than decorating every region as a card. Adapt layout to the content: a small form may use a readable column; a dashboard may need a responsive grid. Avoid fixed widths and heights that clip real content; check a narrow viewport and long/empty content. Include hover, visible keyboard focus, disabled, selected, loading, error and success states where relevant. Use semantic controls, explicit labels and sufficient contrast in both themes; honor reduced motion. Keep logic, persistence and rendering separable without unnecessary layers. Render user text safely (JSX text or textContent, not raw HTML). For visual work inspect an actual preview at desktop and mobile sizes if a supported preview tool exists; otherwise report that visual verification was unavailable. A build pass alone does not verify layout.',
    sources: []
  },
  {
    id: 'react',
    matches:
      /\b(react|next\.?js|nextjs|components?|hooks?|usestate|useeffect|forms?|todo|to-do|dashboard|frontend)\b/i,
    guide:
      'UI/STATE: Keep canonical state minimal; derive filtered lists/counts instead of synchronizing duplicate state. Use stable item IDs, immutable updates and functional state updates when based on previous state. Keep render pure; effects synchronize external systems and need cleanup/race handling. For browser persistence validate parsed data and handle corruption, storage errors and SSR/hydration safely. Include loading, empty, error and disabled/pending states. Use semantic controls, associated labels, keyboard access and visible focus. Test a real user interaction and persistence reload when applicable; do not add a state library or memoization without a need.',
    sources: ['https://react.dev/learn/choosing-the-state-structure']
  }
]

export type CodingQualitySignals = {
  plan?: string
  docs?: string
  tasks?: { title: string }[]
  inspections?: string[]
}

export function codingQualityTopics(goal: string, state: CodingQualitySignals = {}): Topic[] {
  const signals = [
    goal.slice(0, 6000),
    state.plan?.slice(0, 2000),
    state.docs?.slice(0, 2000),
    state.tasks
      ?.slice(0, 12)
      .map((task) => task.title.slice(0, 200))
      .join('\n'),
    state.inspections?.slice(-12).join('\n').slice(0, 2400)
  ].join('\n')
  return TOPICS.filter((topic) => topic.matches.test(signals)).slice(0, 4)
}

export function codingQualityGuide(goal: string, state: CodingQualitySignals = {}): string {
  const topics = codingQualityTopics(goal, state)
  const guide = [
    CODING_QUALITY_CORE,
    ...topics.map((topic) => [topic.guide, topic.example].filter(Boolean).join('\n')),
    'Reference starting points (built-in guidance reviewed 2026-10-25; links are not evidence of a live lookup or the installed version): ' +
      [...new Set(topics.flatMap((topic) => topic.sources))].join(' ')
  ].join('\n')
  const exampleQuery = [
    goal,
    state.plan,
    state.docs,
    state.tasks?.map((task) => task.title).join('\n')
  ].join('\n')
  const examples = retrieveCodingExamples(exampleQuery, Math.max(0, 6500 - guide.length - 1))
  return examples ? guide + '\n' + examples : guide
}

export function codingToolFeedback(
  tool: string,
  args: Record<string, unknown>,
  result: string
): string {
  if (tool !== 'run_npm') return ''
  try {
    const command = JSON.parse(result)
    if (command.stopped || !Number.isInteger(command.exitCode)) return ''
    if (command.exitCode === 0 && (args.args as string[])?.[0] === 'init')
      return 'CODING NEXT STEP: npm init succeeded; do not run initialization again. Read package.json. Create the requested implementation and configure meaningful verification scripts with edit_file before marking the scaffold implemented. The generated default npm test placeholder is not a behavior check. Use one working task that includes implementation and test setup when the project is small.'
    const output = typeof command.output === 'string' ? command.output : command.output?.content
    if (command.exitCode !== 0 && typeof output === 'string' && /no test specified/i.test(output))
      return 'CODING REPAIR LESSON: npm reported its default "no test specified" placeholder. The test runner is not configured. Read package.json and use edit_file to replace that placeholder with the actual behavior-test command; create the required implementation/test files before rerunning npm run test. npm init will not repair this failure. Update the active task tool mapping if edit_file is missing. Keep any existing real tests; do not replace them with an echo, no-op or forced success.'
  } catch {
    // Invalid or denied results do not become recovery instructions.
  }
  return ''
}
