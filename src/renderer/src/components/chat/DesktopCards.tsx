import { CalendarClock, CalendarX, MapPin, StickyNote, Users, Video } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  dayKey,
  formatDay,
  formatTimeRange,
  groupByDay,
  parseDesktopCard,
  type CalendarEvent,
  type ChangeOperation,
  type DesktopCard,
  type NoteSummary,
  type NoteView,
  calendarEvent
} from '../../../../shared/desktop-cards'

const when = (value: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
const VERB: Record<ChangeOperation, [string, string]> = {
  create: ['Created', 'create'],
  edit: ['Updated', 'update'],
  delete: ['Deleted', 'delete']
}

function Confirmation({
  operation,
  verified
}: {
  operation: ChangeOperation
  verified: boolean
}): React.JSX.Element {
  return verified ? (
    <Badge variant="secondary">{VERB[operation][0]}</Badge>
  ) : (
    <Badge variant="destructive">Not confirmed</Badge>
  )
}

export function EventRow({ event }: { event: CalendarEvent }): React.JSX.Element {
  return (
    <li className="flex gap-3 py-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatTimeRange(event)}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span
          className={`block text-sm font-medium [overflow-wrap:anywhere] ${event.cancelled ? 'line-through text-muted-foreground' : ''}`}
        >
          {event.title || '(No title)'}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {event.location && (
            <span className="flex items-center gap-1 [overflow-wrap:anywhere]">
              <MapPin aria-hidden="true" className="size-3" />
              {event.location}
            </span>
          )}
          {event.onlineMeeting && (
            <span className="flex items-center gap-1">
              <Video aria-hidden="true" className="size-3" />
              Online meeting
            </span>
          )}
          {!!event.attendees && (
            <span className="flex items-center gap-1">
              <Users aria-hidden="true" className="size-3" />
              {plural(event.attendees, 'attendee')}
            </span>
          )}
          {event.status && event.status !== 'busy' && (
            <Badge variant="outline">
              {event.status === 'away'
                ? 'Away'
                : event.status[0].toUpperCase() + event.status.slice(1)}
            </Badge>
          )}
          {event.cancelled && <Badge variant="outline">Cancelled</Badge>}
        </span>
      </span>
    </li>
  )
}

export function AgendaCard({
  events,
  total,
  heading = 'Calendar',
  account,
  truncated = false
}: {
  events: CalendarEvent[]
  total: number
  heading?: string
  account?: string
  truncated?: boolean
}): React.JSX.Element {
  const groups = groupByDay(events)
  return (
    <Card size="sm" className="w-full max-w-xl" aria-label={heading}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock aria-hidden="true" className="size-4 text-muted-foreground" />
          {heading}
        </CardTitle>
        <CardDescription>
          {events.length ? plural(total, 'event') : 'No events in this range'}
          {total > events.length && ` · showing ${events.length}`}
          {truncated && ' · more events exist than were read'}
          {account && ` · ${account}`}
        </CardDescription>
      </CardHeader>
      {groups.length > 0 && (
        <CardContent className="space-y-3">
          {groups.map((group) => (
            <section key={group.day} aria-label={formatDay(group.day)}>
              <h3 className="text-xs font-medium text-muted-foreground">{formatDay(group.day)}</h3>
              <ul className="divide-y divide-border">
                {group.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

function EventChangeCard({
  card
}: {
  card: Extract<DesktopCard, { kind: 'event-change' }>
}): React.JSX.Element {
  const [past, verb] = VERB[card.operation]
  return (
    <Card size="sm" className="w-full max-w-xl" aria-label={`${past} event`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {card.operation === 'delete' ? (
            <CalendarX aria-hidden="true" className="size-4 text-muted-foreground" />
          ) : (
            <CalendarClock aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
          Event
          <Confirmation operation={card.operation} verified={card.verified} />
        </CardTitle>
        {!card.verified ? (
          <CardDescription>
            The calendar did not confirm the request to {verb} this event. Check it before trying
            again.
            {card.account && ` · ${card.account}`}
          </CardDescription>
        ) : (
          card.account && <CardDescription>{card.account}</CardDescription>
        )}
      </CardHeader>
      {card.event && (
        <CardContent>
          <ul>
            <EventRow event={card.event} />
          </ul>
          <p className="text-xs text-muted-foreground">{formatDay(dayKey(card.event))}</p>
        </CardContent>
      )}
    </Card>
  )
}

function Body({ text }: { text: string }): React.JSX.Element {
  return text ? (
    <ScrollArea className="max-h-64 rounded-md bg-muted" orientation="both">
      <p className="selectable whitespace-pre-wrap p-2.5 text-sm [overflow-wrap:anywhere]">
        {text}
      </p>
    </ScrollArea>
  ) : (
    <p className="text-xs text-muted-foreground">(Empty note)</p>
  )
}

export function NoteCard({
  note,
  badge
}: {
  note: NoteView
  badge?: React.ReactNode
}): React.JSX.Element {
  return (
    <Card size="sm" className="w-full max-w-xl" aria-label={`Note: ${note.title}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [overflow-wrap:anywhere]">
          <StickyNote aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {note.title}
          {badge}
        </CardTitle>
        <CardDescription>Updated {when(note.updatedAt)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Body text={note.body} />
      </CardContent>
    </Card>
  )
}

export function NotesList({
  notes,
  total
}: {
  notes: NoteSummary[]
  total: number
}): React.JSX.Element {
  return (
    <Card size="sm" className="w-full max-w-xl" aria-label="Notes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StickyNote aria-hidden="true" className="size-4 text-muted-foreground" />
          Notes
        </CardTitle>
        <CardDescription>
          {notes.length ? plural(notes.length, 'note') : 'No matching notes'}
          {total > notes.length && ` of ${total}`}
        </CardDescription>
      </CardHeader>
      {notes.length > 0 && (
        <CardContent>
          <ul className="divide-y divide-border">
            {notes.map((note) => (
              <li key={note.id} className="space-y-0.5 py-2">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{note.title}</p>
                {note.preview && (
                  <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {note.preview}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">{when(note.updatedAt)}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  )
}

function NoteChangeCard({
  card
}: {
  card: Extract<DesktopCard, { kind: 'note-change' }>
}): React.JSX.Element | null {
  const badge = <Confirmation operation={card.operation} verified={card.verified} />
  if (card.note && card.operation !== 'delete') return <NoteCard note={card.note} badge={badge} />
  return (
    <Card size="sm" className="w-full max-w-xl" aria-label="Note change">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StickyNote aria-hidden="true" className="size-4 text-muted-foreground" />
          Note {badge}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

export function DesktopCardView({ card }: { card: DesktopCard }): React.JSX.Element | null {
  if (card.kind === 'events')
    return (
      <AgendaCard
        events={card.events}
        total={card.total}
        account={card.account}
        truncated={card.truncated}
      />
    )
  if (card.kind === 'event-change') return <EventChangeCard card={card} />
  if (card.kind === 'notes') return <NotesList notes={card.notes} total={card.total} />
  if (card.kind === 'note') return <NoteCard note={card.note} />
  return <NoteChangeCard card={card} />
}

/** Cards for completed desktop tool results, shown outside the collapsed action list. */
export function DesktopResults({ actions }: { actions: ToolAction[] }): React.JSX.Element | null {
  const cards = actions.flatMap((action) => {
    const card = action.status === 'done' ? parseDesktopCard(action.detail) : undefined
    return card ? [{ id: action.id, card }] : []
  })
  if (!cards.length) return null
  return (
    <div className="flex w-full flex-col gap-2" aria-label="Results">
      {cards.map(({ id, card }) => (
        <DesktopCardView key={id} card={card} />
      ))}
    </div>
  )
}

/** Exact before/after for a note change awaiting approval. */
export function NotePreview({ note }: { note: Record<string, unknown> }): React.JSX.Element {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const side = (value: unknown): { title: string; body: string } => {
    const record = (value ?? {}) as Record<string, unknown>
    return { title: text(record.title), body: text(record.body) }
  }
  const operation = text(note.operation)
  const before =
    operation === 'edit' ? side(note.before) : operation === 'delete' ? side(note) : undefined
  const after =
    operation === 'edit' ? side(note.after) : operation === 'create' ? side(note) : undefined
  const column = (label: string, value: { title: string; body: string }): React.JSX.Element => (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="selectable text-sm font-medium [overflow-wrap:anywhere]">{value.title}</p>
      <Body text={value.body} />
    </div>
  )
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {operation === 'delete'
          ? 'Permanently delete this note.'
          : operation === 'edit'
            ? 'Replace this note with the version on the right.'
            : 'Save a new note.'}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {before && column(operation === 'delete' ? 'Note' : 'Before', before)}
        {after && column(operation === 'create' ? 'New note' : 'After', after)}
      </div>
    </div>
  )
}

/** Exact event, or before/after, for a calendar change awaiting approval. */
export function EventPreview({ event }: { event: Record<string, unknown> }): React.JSX.Element {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const read = (value: unknown): CalendarEvent | undefined => calendarEvent(value)
  const operation = text(event.operation)
  const before = read(event.before)
  const after = read(event.after)
  const notify = event.notify
  const side = (label: string, value: CalendarEvent): React.JSX.Element => (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{formatDay(dayKey(value))}</p>
      <ul className="rounded-md bg-muted px-2.5">
        <EventRow event={value} />
      </ul>
    </div>
  )
  const summary =
    operation === 'delete'
      ? 'Delete this event from the calendar.'
      : operation === 'update'
        ? 'Change this event to the version on the right.'
        : operation === 'create'
          ? 'Add this event to the calendar.'
          : 'Read events from the calendar.'
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {summary}
        {text(event.account) && ` Account: ${text(event.account)}.`}
      </p>
      {operation === 'read' && (
        <p className="text-xs">
          {text(event.start)} – {text(event.end)}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        {before && side(operation === 'delete' ? 'Event' : 'Before', before)}
        {after && side(operation === 'create' ? 'New event' : 'After', after)}
      </div>
      {text(event.notes) && <Body text={text(event.notes)} />}
      {Boolean(notify) && (
        <Alert>
          <Users aria-hidden="true" />
          <AlertDescription>
            {Array.isArray(notify) ? (
              <>
                {text(event.warning)}{' '}
                <span className="selectable [overflow-wrap:anywhere]">
                  {notify.filter((entry) => typeof entry === 'string').join(', ')}
                </span>
              </>
            ) : (
              text(notify)
            )}
          </AlertDescription>
        </Alert>
      )}
      {!notify && text(event.warning) && (
        <p className="text-xs text-muted-foreground">{text(event.warning)}</p>
      )}
    </div>
  )
}
