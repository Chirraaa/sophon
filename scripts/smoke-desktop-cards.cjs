const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { load, root } = require('./security/load.cjs')
const cards = load('src/shared/desktop-cards.ts')
const { parseDesktopCard, groupByDay, formatTimeRange, calendarEvent } = cards
const json = (value) => JSON.stringify(value)

const event = (over = {}) => ({
  id: 'e1',
  title: 'Standup',
  start: '2026-10-29T09:00:00Z',
  end: '2026-10-29T09:15:00Z',
  allDay: false,
  ...over
})
const note = (over = {}) => ({
  id: 'note-0123456789ab',
  title: 'Groceries',
  body: 'milk\neggs',
  createdAt: 1,
  updatedAt: 1793000000000,
  revision: 2,
  ...over
})

// Recognised results
assert.equal(parseDesktopCard(json({ kind: 'note', note: note() })).note.title, 'Groceries')
assert.deepEqual(
  parseDesktopCard(
    json({ kind: 'notes', total: 3, notes: [{ id: 'a', title: 'T', preview: 'p', updatedAt: 1 }] })
  ),
  { kind: 'notes', total: 3, notes: [{ id: 'a', title: 'T', preview: 'p', updatedAt: 1 }] }
)
const change = parseDesktopCard(
  json({ kind: 'note-change', operation: 'edit', verified: true, note: note() })
)
assert.equal(change.verified, true)
assert.equal(
  parseDesktopCard(json({ kind: 'note-change', operation: 'delete', verified: true, id: 'note-x' }))
    .id,
  'note-x'
)
assert.equal(
  parseDesktopCard(json({ kind: 'note-change', operation: 'edit', verified: 'yes', note: note() }))
    .verified,
  false,
  'only a literal true counts as verified'
)
assert.equal(parseDesktopCard(json({ kind: 'events', events: [event()] })).total, 1)

// Rejected input
for (const bad of [
  undefined,
  '',
  'plain text',
  '[]',
  '{"kind":"mcp-result"}',
  '{"kind":"note","note":{}}',
  '{"kind":"note-change","operation":"explode","verified":true,"id":"x"}',
  '{"kind":"note-change","operation":"edit","verified":true}',
  '{"kind":"events","events":"nope"}',
  '{"kind":"note"',
  json({ kind: 'note', note: note({ revision: 0 }) }),
  json({ kind: 'note', note: note({ body: 'x'.repeat(20001) }) }),
  '{' + ' '.repeat(400001) + '}'
])
  assert.equal(parseDesktopCard(bad), undefined, String(bad).slice(0, 40))

// Event validation drops malformed items and bounds lists
assert.equal(calendarEvent(event({ end: '2026-10-29T08:00:00Z' })), undefined, 'ends before start')
assert.equal(calendarEvent(event({ start: 'tomorrow' })), undefined)
assert.equal(calendarEvent(event({ allDay: true })), undefined, 'all-day needs date-only values')
assert.equal(calendarEvent(event({ start: '2026-10-29', end: '2026-10-30' })), undefined)
assert.equal(calendarEvent(event({ status: 'weird' })).status, undefined)
assert.equal(calendarEvent(event({ attendees: -2 })).attendees, undefined)
const mixed = parseDesktopCard(
  json({ kind: 'events', total: 70, events: [event(), { id: 'x' }, event({ id: 'e2' })] })
)
assert.deepEqual(
  mixed.events.map((e) => e.id),
  ['e1', 'e2']
)
assert.equal(mixed.total, 70)
const many = parseDesktopCard(
  json({ kind: 'events', events: Array.from({ length: 80 }, (_, i) => event({ id: 'e' + i })) })
)
assert.equal(many.events.length, cards.CARD_ITEM_LIMIT)

// Grouping uses the viewer's local day; all-day events lead their day
const day = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString()
const groups = groupByDay([
  event({ id: 'late', start: day(2026, 11, 2, 15), end: day(2026, 11, 2, 16) }),
  event({ id: 'early', start: day(2026, 11, 2, 8), end: day(2026, 11, 2, 9) }),
  event({ id: 'allday', allDay: true, start: '2026-11-02', end: '2026-11-03' }),
  event({ id: 'next', start: day(2026, 11, 3, 10), end: day(2026, 11, 3, 11) })
])
assert.deepEqual(
  groups.map((g) => g.day),
  ['2026-11-02', '2026-11-03']
)
assert.deepEqual(
  groups[0].events.map((e) => e.id),
  ['allday', 'early', 'late']
)
assert.equal(formatTimeRange(groups[0].events[0]), 'All day')
assert.equal(
  formatTimeRange(event({ allDay: true, start: '2026-11-02', end: '2026-11-05' })),
  'All day · 3 days'
)
assert.match(formatTimeRange(groups[0].events[1], 'en-US'), /8:00\s?AM\s–\s9:00\s?AM/)

// Real component output, bundled with the renderer's own toolchain
async function renderer() {
  const { build } = await import('vite')
  const out = path.join(root, '.cache/desktop-cards')
  fs.mkdirSync(out, { recursive: true })
  const entry = path.join(out, 'entry.tsx')
  fs.writeFileSync(
    entry,
    `import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopResults, NotePreview } from '@/components/chat/DesktopCards'
export const results = (actions: ToolAction[]): string => renderToStaticMarkup(<DesktopResults actions={actions} />)
export const preview = (note: Record<string, unknown>): string => renderToStaticMarkup(<NotePreview note={note} />)
`
  )
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
    oxc: { jsx: { runtime: 'automatic' } },
    ssr: { noExternal: true },
    build: {
      ssr: entry,
      outDir: out,
      emptyOutDir: false,
      minify: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'render.cjs' } }
    }
  })
  return { render: require(path.join(out, 'render.cjs')), out }
}
;(async () => {
  const { render, out } = await renderer()
  const action = (id, detail, status = 'done') => ({ id, name: 'x', label: 'x', status, detail })
  const html = render.results([
    action(
      '1',
      json({
        kind: 'events',
        total: 2,
        events: [
          event({ title: '<b>Plan</b>', location: 'Room 4' }),
          event({ id: 'e2', title: 'Lunch', cancelled: true })
        ]
      })
    ),
    action('2', json({ kind: 'note', note: note({ body: '<script>alert(1)</script>' }) })),
    action('3', json({ kind: 'note-change', operation: 'edit', verified: false, note: note() })),
    action('4', json({ kind: 'note-change', operation: 'delete', verified: true, id: 'note-x' })),
    action(
      '5',
      json({ kind: 'event-change', operation: 'create', verified: true, event: event() })
    ),
    action(
      '6',
      json({
        kind: 'notes',
        total: 1,
        notes: [{ id: 'n', title: 'Listed', preview: 'pv', updatedAt: 1 }]
      })
    ),
    action('7', json({ kind: 'note', note: note() }), 'failed'),
    action('8', 'Tool error: boom')
  ])
  assert.match(html, /2 events/)
  assert.match(html, /Room 4/)
  assert.match(html, /line-through/)
  assert.match(html, /Not confirmed/)
  assert.match(html, /Deleted/)
  assert.match(html, /Created/)
  assert.match(html, /Listed/)
  assert(!html.includes('<script>') && !html.includes('<b>Plan'), 'untrusted text is escaped')
  assert.match(html, /&lt;script&gt;/)
  assert.equal(
    (html.match(/aria-label="Note: Groceries"/g) ?? []).length,
    2,
    'failed action shows no card'
  )
  assert.equal(render.results([action('9', 'Tool error')]), '')
  const edit = render.preview({
    operation: 'edit',
    before: { title: 'A', body: 'old' },
    after: { title: 'A', body: 'new' }
  })
  assert.match(edit, /Before/)
  assert.match(edit, /After/)
  assert.match(edit, /old/)
  assert.match(edit, /new/)
  assert.match(
    render.preview({ operation: 'delete', title: 'Gone', body: 'b' }),
    /Permanently delete/
  )
  fs.rmSync(out, { recursive: true, force: true })
  console.log('desktop cards smoke passed')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
