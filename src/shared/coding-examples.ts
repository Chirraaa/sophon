type Example = {
  id: string
  source: string
  language: string
  tags: string[]
  pattern: string
  code: string
  framework?: 'dom' | 'react'
}

export const CODING_EXAMPLES: readonly Example[] = [
  {
    id: 'design-tokens',
    source: 'examples/css/design_tokens.css',
    language: 'css',
    tags: ['theme', 'dark', 'color', 'tokens', 'design', 'css'],
    pattern:
      'Use semantic color roles; dark mode changes tokens instead of duplicating every component.',
    code: `:root { color-scheme: light dark; --bg: #fff; --text: #1b1f24; --muted: #5b6573; --accent: #2563eb; --border: #d5dae1; --radius: .5rem; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #12161c; --text: #e8ebf0; --muted: #9aa5b4; --accent: #6ea0ff; --border: #2b3340; }
}
body { background: var(--bg); color: var(--text); }`
  },
  {
    id: 'responsive-layout',
    source: 'examples/css/layout_stack.css',
    language: 'css',
    tags: ['layout', 'responsive', 'spacing', 'mobile', 'overflow', 'width', 'css'],
    pattern:
      'A readable centered column and wrapping actions adapt to narrow screens and long content.',
    code: `.page { width: min(100% - 2rem, 40rem); margin-inline: auto; display: flex; flex-direction: column; gap: 1rem; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.row > :first-child { flex: 1; min-width: 0; }
.task-title { overflow-wrap: anywhere; }`
  },
  {
    id: 'control-states',
    source: 'examples/css/buttons_focus.css',
    language: 'css',
    tags: ['button', 'focus', 'keyboard', 'disabled', 'accessibility', 'controls', 'css'],
    pattern:
      'Controls need visible keyboard focus and meaningful hover, disabled and selected states.',
    code: `button { min-height: 2.5rem; padding: 0 1rem; font: inherit; cursor: pointer; }
button:hover { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: not-allowed; }
button[aria-pressed="true"] { font-weight: 700; border-color: var(--accent); }`
  },
  {
    id: 'accessible-form',
    source: 'examples/html/accessible_form.html',
    language: 'html',
    framework: 'dom',
    tags: ['form', 'input', 'label', 'validation', 'error', 'submit', 'html'],
    pattern: 'A label, submit event and announced error support keyboard and assistive technology.',
    code: `<form id="add-form">
  <label for="new-todo">New task</label>
  <input id="new-todo" name="title" maxlength="200" required aria-describedby="add-error">
  <button type="submit">Add</button>
  <p id="add-error" role="alert"></p>
</form>`
  },
  {
    id: 'react-form',
    source: 'examples/html/accessible_form.html (React adaptation)',
    language: 'jsx',
    framework: 'react',
    tags: ['form', 'input', 'label', 'validation', 'error', 'submit'],
    pattern:
      'Inside a React component, associate labels/errors and handle submission on the form. The handler validates input and sets error state.',
    code: `// Inside an existing component; inputId comes from React.useId().
<form onSubmit={handleSubmit}>
  <label htmlFor={inputId}>New task</label>
  <input id={inputId} value={title} onChange={event => setTitle(event.target.value)}
    required maxLength={200} aria-describedby={inputId + "-error"} />
  <button type="submit">Add</button>
  <p id={inputId + "-error"} role="alert">{error}</p>
</form>`
  },
  {
    id: 'react-state',
    source: 'examples/js/pure_state.js (React adaptation)',
    language: 'tsx',
    framework: 'react',
    tags: ['state', 'toggle', 'todo', 'filter', 'count', 'immutability'],
    pattern: 'Use functional immutable updates and derive counts instead of duplicating state.',
    code: `// Inside an existing component with todos/setTodos state:
const openCount = todos.filter(todo => !todo.done).length;
function toggleTodo(id: string) {
  setTodos(current => current.map(todo =>
    todo.id === id ? { ...todo, done: !todo.done } : todo
  ));
}
// Render user text as JSX text: <span>{todo.title}</span>.`
  },
  {
    id: 'safe-storage',
    source: 'examples/js/local_storage.js (shape validation added)',
    language: 'js',
    tags: ['storage', 'localstorage', 'persist', 'save', 'reload', 'corrupt', 'json'],
    pattern:
      'Storage data is untrusted. Validate its shape and report save failures; in SSR apps call only after client initialization.',
    code: `function loadTodos(storage) {
  try {
    const value = JSON.parse(storage.getItem("todos.v1") ?? "[]");
    return Array.isArray(value) ? value.filter(item => item &&
      typeof item.id === "string" && typeof item.title === "string" &&
      typeof item.done === "boolean") : [];
  } catch { return []; }
}
function saveTodos(storage, todos) {
  try { storage.setItem("todos.v1", JSON.stringify(todos)); return true; }
  catch { return false; } // Caller must show that changes were not saved.
}`
  },
  {
    id: 'safe-dom-text',
    source: 'examples/js/render_list.js',
    language: 'js',
    framework: 'dom',
    tags: ['render', 'dom', 'xss', 'html', 'textcontent', 'list', 'injection'],
    pattern:
      'User content becomes text, never executable markup; use framework rendering in React instead.',
    code: `function renderTitle(title) {
  const label = document.createElement("span");
  label.textContent = title;
  return label;
}`
  }
]

const STOP = new Set(
  'the and for with this that from build create implement using project function code app'.split(
    ' '
  )
)
const words = (text: string): string[] =>
  [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((word) => !STOP.has(word))

export function retrieveCodingExamples(query: string, budgetChars = 1800): string {
  const web =
    /\b(react|next\.?js|nextjs|javascript|typescript|js|tsx|jsx|html|css|frontend|browser|localstorage|website)\b/i.test(
      query
    )
  if (!web && /\b(c|cpp|python|rust|golang|java|swift|kotlin)\b|c\+\+/i.test(query)) return ''
  const tokens = words(query.slice(0, 10000))
  if (!tokens.length || budgetChars <= 0) return ''
  const react = /\b(react|next\.?js|nextjs|tsx|jsx)\b/i.test(query)
  const prefix =
    'TEACHING EXAMPLES (adapt the pattern to this project, not a full app or a new feature):\n'
  const candidates = CODING_EXAMPLES.filter(
    (example) => example.framework !== (react ? 'dom' : 'react')
  )
    .map((example) => ({
      example,
      score: example.tags.reduce((sum, tag) => sum + (tokens.includes(tag) ? 1 : 0), 0)
    }))
    .filter((entry) => entry.score >= 1)
    .sort((a, b) => b.score - a.score || a.example.id.localeCompare(b.example.id))
  const picked: string[] = []
  for (const { example } of candidates) {
    const block = `Example ${example.id} [${example.source}]: ${example.pattern}\n\`\`\`${example.language}\n${example.code}\n\`\`\``
    if (prefix.length + [...picked, block].join('\n\n').length > Math.min(1800, budgetChars))
      continue
    picked.push(block)
    if (picked.length === 2) break
  }
  return picked.length ? prefix + picked.join('\n\n') : ''
}
