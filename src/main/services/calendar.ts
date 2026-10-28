import { randomUUID } from 'crypto'
import { graphRequest, GraphError } from '../network/graph-request'
import type { CalendarEvent } from '../../shared/desktop-cards'

export const RANGE_DAYS_MAX = 62
export const LIST_DEFAULT = 50
export const LIST_MAX = 100
const DEFAULT_MINUTES = 60
const FIELDS =
  'id,subject,start,end,isAllDay,location,organizer,attendees,isOnlineMeeting,showAs,isCancelled,changeKey,type,bodyPreview'
const UTC = { Prefer: 'outlook.timezone="UTC"' }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/

export class CalendarError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'missing' | 'stale' | 'denied' | 'unavailable'
  ) {
    super(message)
  }
}
export type StoredEvent = CalendarEvent & {
  revision: string
  recurring?: boolean
  notes?: string
}
export type EventRecord = { event: StoredEvent; etag: string }

// ---- Text from calendars is untrusted; strip control and bidi-override characters.
const INVISIBLE_RANGES = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069]
]
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([from, to]) => String.fromCharCode(from) + '-' + String.fromCharCode(to)).join('')}]`,
  'g'
)
export const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(INVISIBLE, '').slice(0, max) : ''

// ---- Time
const pad = (n: number): string => String(n).padStart(2, '0')
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
function validDate(value: string, label: string): string {
  const ok = DATE.test(value) && addDays(value, 0) === value
  if (!ok) throw new CalendarError(`${label} must be a real date like 2026-10-29.`, 'invalid')
  return value
}
function localMidnight(date: string): Date {
  const [y, m, d] = validDate(date, 'Date').split('-').map(Number)
  return new Date(y, m - 1, d)
}
function validInstant(value: string, label: string): Date {
  if (!DATETIME.test(value))
    throw new CalendarError(
      `${label} must be a date and time like 2026-10-29T14:30 (local time) or 2026-10-29T14:30:00Z.`,
      'invalid'
    )
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw new CalendarError(`${label} is not a real date and time.`, 'invalid')
  return parsed
}
/** A list range. Date-only values cover whole local days; times without an offset are local. */
export function listRange(start: string, end: string): { start: Date; end: Date } {
  const from = DATE.test(start) ? localMidnight(start) : validInstant(start, 'Start')
  const to = DATE.test(end) ? localMidnight(addDays(end, 1)) : validInstant(end, 'End')
  if (to <= from) throw new CalendarError('The range must end after it starts.', 'invalid')
  if (to.getTime() - from.getTime() > RANGE_DAYS_MAX * 86400000)
    throw new CalendarError(`Ask for at most ${RANGE_DAYS_MAX} days at a time.`, 'invalid')
  return { start: from, end: to }
}

export type Times = { allDay: boolean; start: string; end: string }
type TimeInput = { start?: string; end?: string; allDay?: boolean }
/** Resolves requested times. All-day `end` is the inclusive last day; the result's end is exclusive. */
export function resolveTimes(input: TimeInput, current?: Times): Times {
  const allDay = input.allDay ?? current?.allDay ?? false
  const switching = current !== undefined && allDay !== current.allDay
  if (allDay) {
    let first: string
    let last: string
    if (current && !switching) {
      const span = daysBetween(current.start, current.end)
      first = input.start ? validDate(input.start, 'Start') : current.start
      last = input.end
        ? validDate(input.end, 'End')
        : input.start
          ? addDays(first, span - 1)
          : addDays(current.end, -1)
    } else {
      if (!input.start) throw new CalendarError('An all-day event needs a start date.', 'invalid')
      first = validDate(input.start, 'Start')
      last = input.end ? validDate(input.end, 'End') : first
    }
    if (last < first) throw new CalendarError('The event cannot end before it starts.', 'invalid')
    return { allDay: true, start: first, end: addDays(last, 1) }
  }
  if (input.start && DATE.test(input.start))
    throw new CalendarError('A timed event needs a time, like 2026-10-29T14:30.', 'invalid')
  if (!current || switching) {
    if (!input.start) throw new CalendarError('A timed event needs a start time.', 'invalid')
  }
  const startDate = input.start ? validInstant(input.start, 'Start') : new Date(current!.start)
  const keep =
    current && !switching ? new Date(current.end).getTime() - new Date(current.start).getTime() : 0
  const endDate = input.end
    ? validInstant(input.end, 'End')
    : new Date(startDate.getTime() + (keep > 0 ? keep : DEFAULT_MINUTES * 60000))
  if (endDate <= startDate)
    throw new CalendarError('The event must end after it starts.', 'invalid')
  return { allDay: false, start: startDate.toISOString(), end: endDate.toISOString() }
}
const graphTime = (value: string, allDay: boolean): { dateTime: string; timeZone: string } => ({
  dateTime: allDay ? `${value}T00:00:00` : value.slice(0, 19),
  timeZone: 'UTC'
})

// ---- Mapping
const STATUS: Record<string, CalendarEvent['status']> = {
  busy: 'busy',
  workingElsewhere: 'busy',
  free: 'free',
  tentative: 'tentative',
  oof: 'away'
}
type Json = Record<string, unknown>
const obj = (value: unknown): Json | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined
function moment(value: unknown, allDay: boolean): string | undefined {
  const v = obj(value)
  const dateTime = typeof v?.dateTime === 'string' ? v.dateTime : ''
  if (allDay) return DATE.test(dateTime.slice(0, 10)) ? dateTime.slice(0, 10) : undefined
  if (String(v?.timeZone).toUpperCase() !== 'UTC') return undefined
  const parsed = new Date(`${dateTime.replace(/(\.\d{3})\d+$/, '$1')}Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}
export function toEvent(raw: unknown): EventRecord | undefined {
  const g = obj(raw)
  const id = typeof g?.id === 'string' && g.id.length <= 512 ? g.id : ''
  const revision = typeof g?.changeKey === 'string' ? g.changeKey.slice(0, 200) : ''
  if (!g || !id || !revision) return undefined
  const allDay = g.isAllDay === true
  const start = moment(g.start, allDay)
  const end = moment(g.end, allDay)
  if (!start || !end || end < start) return undefined
  const organizer = obj(obj(g.organizer)?.emailAddress)
  const location = clean(obj(g.location)?.displayName, 300).trim()
  const who = clean(organizer?.name || organizer?.address, 200).trim()
  const notes = clean(g.bodyPreview, 300).trim()
  const status = STATUS[String(g.showAs)]
  const event: StoredEvent = {
    id,
    revision,
    title: clean(g.subject, 300).trim(),
    start,
    end,
    allDay,
    ...(location ? { location } : {}),
    ...(who ? { organizer: who } : {}),
    ...(Array.isArray(g.attendees) && g.attendees.length ? { attendees: g.attendees.length } : {}),
    ...(g.isOnlineMeeting === true ? { onlineMeeting: true } : {}),
    ...(status ? { status } : {}),
    ...(g.isCancelled === true ? { cancelled: true } : {}),
    ...(g.type !== undefined && g.type !== 'singleInstance' ? { recurring: true } : {}),
    ...(notes ? { notes } : {})
  }
  const etag = typeof g['@odata.etag'] === 'string' ? g['@odata.etag'] : ''
  return { event, etag }
}

// ---- Graph operations
const eventPath = (id: string): string => `/me/events/${encodeURIComponent(id)}`
export async function readEvent(
  token: string,
  id: string,
  signal?: AbortSignal
): Promise<EventRecord> {
  try {
    const { body } = await graphRequest({
      method: 'GET',
      path: `${eventPath(id)}?$select=${FIELDS}`,
      token,
      headers: UTC,
      signal
    })
    const record = toEvent(body)
    if (!record)
      throw new CalendarError('Microsoft returned an event Sophon cannot read.', 'unavailable')
    return record
  } catch (error) {
    throw translate(error, 'read')
  }
}
export async function listEvents(
  token: string,
  range: { start: Date; end: Date },
  options: { query?: string; limit?: number },
  signal?: AbortSignal
): Promise<{ events: StoredEvent[]; total: number; truncated: boolean; skipped: number }> {
  const params = [
    `startDateTime=${encodeURIComponent(range.start.toISOString())}`,
    `endDateTime=${encodeURIComponent(range.end.toISOString())}`,
    `$select=${FIELDS}`,
    '$orderby=start/dateTime',
    `$top=${LIST_MAX}`
  ].join('&')
  try {
    const { body } = await graphRequest({
      method: 'GET',
      path: `/me/calendarView?${params}`,
      token,
      headers: UTC,
      signal
    })
    const rows = Array.isArray(body?.value) ? body.value : []
    const parsed = rows.map(toEvent)
    const needle = options.query?.trim().toLowerCase()
    const events = parsed
      .flatMap((record) => (record ? [record.event] : []))
      .filter(
        (event) =>
          !needle ||
          [event.title, event.location, event.notes].some((text) =>
            text?.toLowerCase().includes(needle)
          )
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    const limit = Math.min(Math.max(1, options.limit ?? LIST_DEFAULT), LIST_MAX)
    return {
      events: events.slice(0, limit),
      total: events.length,
      truncated: events.length > limit || typeof body?.['@odata.nextLink'] === 'string',
      skipped: parsed.filter((record) => !record).length
    }
  } catch (error) {
    throw translate(error, 'read')
  }
}

export type Draft = {
  title: string
  times: Times
  location?: string
  notes?: string
  attendees?: string[]
}
function payload(draft: Partial<Draft> & { times?: Times }): Json {
  const out: Json = {}
  if (draft.title !== undefined) out.subject = draft.title
  if (draft.times) {
    out.isAllDay = draft.times.allDay
    out.start = graphTime(draft.times.start, draft.times.allDay)
    out.end = graphTime(draft.times.end, draft.times.allDay)
  }
  if (draft.location !== undefined) out.location = { displayName: draft.location }
  if (draft.notes !== undefined) out.body = { contentType: 'text', content: draft.notes }
  if (draft.attendees?.length)
    out.attendees = draft.attendees.map((address) => ({
      emailAddress: { address },
      type: 'required'
    }))
  return out
}
export async function createEvent(
  token: string,
  draft: Draft,
  signal?: AbortSignal
): Promise<string> {
  try {
    const { body } = await graphRequest({
      method: 'POST',
      path: '/me/events',
      token,
      // A transaction ID makes an accidental repeat of this exact request harmless.
      body: { ...payload(draft), transactionId: randomUUID() },
      headers: UTC,
      signal
    })
    const id = body?.id
    if (typeof id !== 'string' || !id) throw new Error('Microsoft did not return the new event.')
    return id
  } catch (error) {
    throw translate(error, 'write')
  }
}
export async function updateEvent(
  token: string,
  id: string,
  etag: string,
  changes: Partial<Draft>,
  signal?: AbortSignal
): Promise<void> {
  try {
    await graphRequest({
      method: 'PATCH',
      path: eventPath(id),
      token,
      body: payload(changes),
      headers: { ...UTC, ...(etag ? { 'If-Match': etag } : {}) },
      signal
    })
  } catch (error) {
    throw translate(error, 'write')
  }
}
export async function deleteEvent(
  token: string,
  id: string,
  etag: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await graphRequest({
      method: 'DELETE',
      path: eventPath(id),
      token,
      headers: etag ? { 'If-Match': etag } : {},
      signal
    })
  } catch (error) {
    throw translate(error, 'write')
  }
}

/** True when the request definitely did not change anything (the service refused it). */
export const refused = (error: unknown): boolean =>
  error instanceof CalendarError ||
  (error instanceof GraphError && error.status < 500 && error.status !== 408)

function translate(error: unknown, kind: 'read' | 'write'): unknown {
  if (!(error instanceof GraphError)) return error
  if (
    error.status === 404 ||
    error.code === 'ErrorItemNotFound' ||
    error.code === 'ErrorInvalidIdMalformed'
  )
    return new CalendarError('That event no longer exists. List the calendar again.', 'missing')
  if (error.status === 412)
    return new CalendarError(
      'The event changed since it was read. Read it again before changing it.',
      'stale'
    )
  if (error.status === 401)
    return new CalendarError(
      'Microsoft rejected the sign-in. Reconnect the account in Settings.',
      'denied'
    )
  if (error.status === 403)
    return new CalendarError(
      `Microsoft did not allow this ${kind === 'read' ? 'calendar read' : 'calendar change'}. Calendar permission may be missing or blocked by your organization.`,
      'denied'
    )
  if (error.status === 429)
    return new CalendarError(
      `Microsoft is rate limiting requests${error.retryAfter ? `; try again in ${error.retryAfter} seconds` : ''}.`,
      'unavailable'
    )
  if (error.status === 400)
    return new CalendarError(
      `Microsoft rejected the request${error.code ? ` (${error.code})` : ''}.`,
      'invalid'
    )
  return error
}

/** Do the stored and requested values agree? Used to read a change back. */
export function sameEvent(
  actual: StoredEvent,
  expected: { title?: string; times?: Times; location?: string }
): boolean {
  return (
    (expected.title === undefined || actual.title === expected.title.trim()) &&
    (expected.times === undefined ||
      (actual.allDay === expected.times.allDay &&
        actual.start === expected.times.start &&
        actual.end === expected.times.end)) &&
    (expected.location === undefined || (actual.location ?? '') === expected.location.trim())
  )
}
