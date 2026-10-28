// Structured results from desktop tools (notes, calendar) that the chat renders as cards.
// Tool results are untrusted JSON: every field is checked and bounded before display.
export const CARD_ITEM_LIMIT = 50
const TEXT_LIMIT = 20000

export interface NoteSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
}
export interface NoteView {
  id: string
  title: string
  body: string
  updatedAt: number
  revision: number
}
export interface CalendarEvent {
  id: string
  title: string
  /** ISO instant, or YYYY-MM-DD for an all-day event. */
  start: string
  /** Exclusive end, in the same form as start. */
  end: string
  allDay: boolean
  location?: string
  organizer?: string
  attendees?: number
  onlineMeeting?: boolean
  status?: 'busy' | 'free' | 'tentative' | 'away'
  cancelled?: boolean
}
export type ChangeOperation = 'create' | 'edit' | 'delete'
export type DesktopCard =
  | { kind: 'notes'; total: number; notes: NoteSummary[] }
  | { kind: 'note'; note: NoteView }
  | {
      kind: 'note-change'
      operation: ChangeOperation
      verified: boolean
      note?: NoteView
      id?: string
    }
  | { kind: 'events'; total: number; events: CalendarEvent[] }
  | {
      kind: 'event-change'
      operation: ChangeOperation
      verified: boolean
      event?: CalendarEvent
      id?: string
    }

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : undefined
const str = (value: unknown, max = TEXT_LIMIT): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const OPERATIONS: ChangeOperation[] = ['create', 'edit', 'delete']
const STATUSES = ['busy', 'free', 'tentative', 'away']
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const validTime = (value: string, allDay: boolean): boolean =>
  allDay ? DATE_ONLY.test(value) : !DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value))

function note(value: unknown): NoteView | undefined {
  const v = rec(value)
  const id = str(v?.id, 80)
  const title = str(v?.title, 300)
  const body = str(v?.body)
  const updatedAt = num(v?.updatedAt)
  const revision = num(v?.revision)
  return id && title !== undefined && body !== undefined && updatedAt !== undefined && revision
    ? { id, title, body, updatedAt, revision }
    : undefined
}
function summary(value: unknown): NoteSummary | undefined {
  const v = rec(value)
  const id = str(v?.id, 80)
  const title = str(v?.title, 300)
  const preview = str(v?.preview, 1000)
  const updatedAt = num(v?.updatedAt)
  return id && title !== undefined && preview !== undefined && updatedAt !== undefined
    ? { id, title, preview, updatedAt }
    : undefined
}
export function calendarEvent(value: unknown): CalendarEvent | undefined {
  const v = rec(value)
  const id = str(v?.id, 400)
  const title = str(v?.title, 500)
  const start = str(v?.start, 40)
  const end = str(v?.end, 40)
  const allDay = v?.allDay === true
  if (!id || title === undefined || !start || !end) return undefined
  if (!validTime(start, allDay) || !validTime(end, allDay) || Date.parse(end) < Date.parse(start))
    return undefined
  const attendees = num(v?.attendees)
  return {
    id,
    title,
    start,
    end,
    allDay,
    ...(str(v?.location, 500) ? { location: str(v?.location, 500) } : {}),
    ...(str(v?.organizer, 300) ? { organizer: str(v?.organizer, 300) } : {}),
    ...(attendees !== undefined && attendees >= 0 ? { attendees: Math.floor(attendees) } : {}),
    ...(v?.onlineMeeting === true ? { onlineMeeting: true } : {}),
    ...(STATUSES.includes(String(v?.status))
      ? { status: v!.status as CalendarEvent['status'] }
      : {}),
    ...(v?.cancelled === true ? { cancelled: true } : {})
  }
}
function list<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .slice(0, CARD_ITEM_LIMIT)
    .map(read)
    .filter((item): item is T => item !== undefined)
}

/** Parses a tool result into a card, or undefined when it is not a recognised structured result. */
export function parseDesktopCard(detail: string | undefined): DesktopCard | undefined {
  if (!detail || detail.length > 400000 || !detail.trimStart().startsWith('{')) return undefined
  let data: Rec | undefined
  try {
    data = rec(JSON.parse(detail))
  } catch {
    return undefined
  }
  const kind = data?.kind
  if (kind === 'notes') {
    const notes = list(data?.notes, summary)
    return notes ? { kind, total: num(data?.total) ?? notes.length, notes } : undefined
  }
  if (kind === 'note') {
    const value = note(data?.note)
    return value ? { kind, note: value } : undefined
  }
  if (kind === 'events') {
    const events = list(data?.events, calendarEvent)
    return events ? { kind, total: num(data?.total) ?? events.length, events } : undefined
  }
  if (kind === 'note-change' || kind === 'event-change') {
    const operation = OPERATIONS.find((entry) => entry === data?.operation)
    if (!operation) return undefined
    const verified = data?.verified === true
    const id = str(data?.id, 400)
    if (kind === 'note-change') {
      const value = note(data?.note)
      return value || id ? { kind, operation, verified, note: value, id } : undefined
    }
    const event = calendarEvent(data?.event)
    return event || id ? { kind, operation, verified, event, id } : undefined
  }
  return undefined
}

const parts = (value: string, allDay: boolean): Date =>
  allDay ? new Date(`${value}T00:00:00`) : new Date(value)
/** Local calendar day key (YYYY-MM-DD) that an event starts on. */
export const dayKey = (event: CalendarEvent): string => {
  if (event.allDay) return event.start
  const d = new Date(event.start)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-')
}
export function groupByDay(events: CalendarEvent[]): { day: string; events: CalendarEvent[] }[] {
  const sorted = [...events].sort(
    (a, b) =>
      dayKey(a).localeCompare(dayKey(b)) ||
      Number(b.allDay) - Number(a.allDay) ||
      Date.parse(a.start) - Date.parse(b.start)
  )
  const groups: { day: string; events: CalendarEvent[] }[] = []
  for (const event of sorted) {
    const day = dayKey(event)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.events.push(event)
    else groups.push({ day, events: [event] })
  }
  return groups
}
export function formatDay(day: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(`${day}T00:00:00`)
  )
}
export function formatTimeRange(event: CalendarEvent, locale?: string): string {
  if (event.allDay) {
    const last = new Date(parts(event.end, true).getTime() - 86400000)
    const days = Math.round((last.getTime() - parts(event.start, true).getTime()) / 86400000)
    return days > 0 ? `All day · ${days + 1} days` : 'All day'
  }
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  return `${time.format(new Date(event.start))} – ${time.format(new Date(event.end))}`
}
