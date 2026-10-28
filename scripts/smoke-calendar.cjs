const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const { load } = require('./security/load.cjs')

// ---- A fake Microsoft Graph behind a fake https module
let serial = 0
const events = new Map()
const requests = []
let fault
const nextKey = () => `ck${++serial}`
const graphTime = (dateTime) => ({ dateTime: `${dateTime.slice(0, 19)}.0000000`, timeZone: 'UTC' })
function store(body, existing = {}) {
  const next = { ...existing }
  if (body.subject !== undefined) next.subject = body.subject
  if (body.isAllDay !== undefined) next.isAllDay = body.isAllDay
  if (body.start) next.start = graphTime(body.start.dateTime)
  if (body.end) next.end = graphTime(body.end.dateTime)
  if (body.location) next.location = body.location
  if (body.body) next.bodyPreview = body.body.content
  if (body.attendees) next.attendees = body.attendees
  next.changeKey = nextKey()
  return next
}
function addEvent(over = {}) {
  const id = over.id ?? `AAMk${++serial}-id=`
  const event = {
    id,
    subject: 'Standup',
    isAllDay: false,
    start: graphTime('2026-10-29T09:00:00'),
    end: graphTime('2026-10-29T09:30:00'),
    location: { displayName: '' },
    organizer: { emailAddress: { name: 'Boss', address: 'boss@example.test' } },
    attendees: [],
    isOnlineMeeting: false,
    showAs: 'busy',
    isCancelled: false,
    type: 'singleInstance',
    bodyPreview: '',
    changeKey: nextKey(),
    ...over
  }
  events.set(id, event)
  return event
}
const view = (event) => ({ ...event, '@odata.etag': `W/"${event.changeKey}"` })
const reply = (status, json, headers = {}) => ({ status, json, headers })
const failure = (status, code, headers) =>
  reply(status, { error: { code, message: 'secret detail' } }, headers)
function handle(method, url, headers, body) {
  if (headers.Authorization !== 'Bearer access-token-1')
    return failure(401, 'InvalidAuthenticationToken')
  if (fault) {
    const injected = fault(method, url, body)
    if (injected) return injected
  }
  const path = decodeURIComponent(url.pathname.replace('/v1.0', ''))
  if (method === 'GET' && path === '/me/calendarView') {
    const from = Date.parse(url.searchParams.get('startDateTime'))
    const to = Date.parse(url.searchParams.get('endDateTime'))
    const value = [...events.values()]
      .filter(
        (e) => Date.parse(e.start.dateTime + 'Z') < to && Date.parse(e.end.dateTime + 'Z') > from
      )
      .map(view)
    return reply(200, { value })
  }
  if (method === 'POST' && path === '/me/events') {
    assert(body.transactionId, 'creates carry a transaction id')
    const event = store(body, {
      id: `AAMk${++serial}-new=`,
      type: 'singleInstance',
      showAs: 'busy',
      organizer: { emailAddress: { name: 'Me', address: 'me@example.test' } }
    })
    events.set(event.id, event)
    return reply(201, view(event))
  }
  const match = path.match(/^\/me\/events\/(.+)$/)
  if (!match) return failure(400, 'BadRequest')
  const event = events.get(match[1])
  if (!event) return failure(404, 'ErrorItemNotFound')
  if (method === 'GET') return reply(200, view(event))
  if (headers['If-Match'] && headers['If-Match'] !== `W/"${event.changeKey}"`)
    return failure(412, 'ErrorIrresolvableConflict')
  if (method === 'PATCH') {
    const next = store(body, event)
    events.set(event.id, next)
    return reply(200, view(next))
  }
  if (method === 'DELETE') {
    events.delete(event.id)
    return reply(204, null)
  }
  return failure(400, 'BadRequest')
}
const fakeHttps = {
  request(url, options, callback) {
    const req = new EventEmitter()
    req.end = (payload) => {
      assert.equal(url.origin, 'https://graph.microsoft.com', 'only Graph is contacted')
      assert.equal(options.agent, false)
      const body = payload ? JSON.parse(payload.toString()) : undefined
      requests.push({
        method: options.method,
        path: url.pathname + url.search,
        headers: options.headers,
        body
      })
      if (options.signal.aborted) return req.emit('error', new Error('aborted'))
      const result = handle(options.method, url, options.headers, body)
      if (result === 'network-error')
        return setImmediate(() => req.emit('error', new Error('socket hang up')))
      const text = result.json === null ? '' : JSON.stringify(result.json)
      const response = Readable.from(text ? [Buffer.from(text)] : [])
      response.statusCode = result.status
      response.headers = { 'content-type': 'application/json', ...result.headers }
      setImmediate(() => callback(response))
    }
    return req
  }
}

async function main() {
  const graph = load('src/main/network/graph-request.ts', { https: fakeHttps })
  const service = load('src/main/services/calendar.ts', {
    crypto,
    '../network/graph-request': graph
  })
  const results = load('src/main/workflow/results.ts')
  const outcome = load('src/main/workflow/tool-outcome.ts', { './results': results })
  const cards = load('src/shared/desktop-cards.ts')
  const schemas = load('src/main/tools/schemas.ts', {
    '../harness/schemas': load('src/main/harness/schemas.ts'),
    './windows': { POSITIONS: [] }
  })
  const { validateToolArguments } = load('src/main/security/tool-contracts.ts', {
    '../tools/schemas': schemas
  })
  const registry = load('src/main/tools/registry.ts')

  // Accounts: two connected, "me" is active
  const tokens = []
  let accounts = [
    { id: 'acct-1', email: 'me@example.test' },
    { id: 'acct-2', email: 'work@example.test' }
  ]
  let active = 'acct-1'
  let grantedScope = true
  const auth = {
    microsoftAccountFor: (selector) => {
      const found = selector
        ? accounts.find((a) => a.email === String(selector).toLowerCase())
        : accounts.find((a) => a.id === active)
      if (!found)
        throw new Error(
          selector ? `No connected Microsoft account matches ${selector}.` : 'No active account.'
        )
      return found
    },
    microsoftAccessToken: async (id, scope) => {
      tokens.push([id, scope])
      assert(accounts.some((a) => a.id === id))
      if (!grantedScope) throw new Error('has not granted Calendars.ReadWrite')
      return 'access-token-1'
    }
  }
  const tools = load('src/main/tools/calendar.ts', {
    '../security/microsoft-auth': auth,
    '../security/run-manager': { assertRun: (run) => run.signal.throwIfAborted() },
    '../workflow/tool-outcome': outcome,
    '../services/calendar': service
  })
  const controller = new AbortController()
  const run = { signal: controller.signal }
  const call = async (name, args) => {
    const parameters = validateToolArguments(name, args)
    const plan = await tools.bindCalendarAction(name, parameters, run)
    await plan.revalidate()
    const out = await tools.executeCalendarTool(name, plan.binding, run)
    return { plan, out, data: typeof out === 'string' ? JSON.parse(out) : out }
  }

  // ---- Registration and contracts
  for (const name of tools.CALENDAR_TOOLS) {
    assert(registry.isKnownTool(name), name)
    assert.equal(registry.defaultToolPermissions()[name], 'ask')
  }
  for (const name of ['calendar_create', 'calendar_update', 'calendar_delete'])
    assert(results.MUTATIONS.has(name))
  assert(!results.MUTATIONS.has('calendar_list'))
  for (const [name, args] of [
    ['calendar_list', { start: '2026-10-29' }],
    ['calendar_list', { start: 'a', end: 'b', limit: 0 }],
    ['calendar_list', { start: 'a', end: 'b', limit: 101 }],
    ['calendar_create', { title: 'x' }],
    ['calendar_create', { title: 'x', start: 'y', attendees: ['a', 'a'] }],
    ['calendar_create', { title: 'x', start: 'y', extra: 1 }],
    ['calendar_update', { id: 'abc', revision: 'r' }],
    ['calendar_update', { id: 'a b', revision: 'r', title: 'x' }],
    ['calendar_update', { id: 'abc', revision: 'r', title: '   ' }],
    ['calendar_delete', { id: 'abc' }],
    ['calendar_delete', { id: '../etc', revision: 'r' }]
  ])
    assert.throws(() => validateToolArguments(name, args), name + JSON.stringify(args))
  validateToolArguments('calendar_update', { id: 'AAMk1-id=', revision: 'ck1', notes: '' })

  // ---- Graph client safety
  for (const path of ['//evil.test/x', '/me/../x', '/me/events/..', 'me/events', '/me events'])
    await assert.rejects(
      graph.graphRequest({ method: 'GET', path, token: 'access-token-1' }),
      /Invalid Graph path/,
      path
    )
  await assert.rejects(
    graph.graphRequest({ method: 'GET', path: '/me', token: 'bad token' }),
    /Invalid token/
  )
  const refused = await graph
    .graphRequest({
      method: 'GET',
      path: '/me/calendarView?startDateTime=2026-01-01T00%3A00%3A00Z&endDateTime=2026-01-02T00%3A00%3A00Z',
      token: 'wrong'
    })
    .catch((e) => e)
  assert(refused instanceof graph.GraphError)
  assert.equal(refused.status, 401)
  assert.equal(refused.code, 'InvalidAuthenticationToken')
  assert(!refused.message.includes('secret detail'), 'service text is never surfaced')

  // ---- List
  addEvent({ id: 'e-early', subject: 'Standup' })
  addEvent({
    id: 'e-late',
    subject: 'Plan\u202e<b>review</b>\u0007',
    start: graphTime('2026-10-29T15:00:00'),
    end: graphTime('2026-10-29T16:00:00'),
    location: { displayName: 'Room 4' },
    attendees: [{}, {}],
    isOnlineMeeting: true,
    showAs: 'tentative',
    bodyPreview: 'Bring the budget'
  })
  addEvent({
    id: 'e-all',
    subject: 'Holiday',
    isAllDay: true,
    start: graphTime('2026-10-29T00:00:00'),
    end: graphTime('2026-10-30T00:00:00'),
    showAs: 'free'
  })
  addEvent({
    id: 'e-far',
    subject: 'Later',
    start: graphTime('2026-12-01T09:00:00'),
    end: graphTime('2026-12-01T10:00:00')
  })
  addEvent({
    id: 'e-zone',
    subject: 'Odd zone',
    start: { dateTime: '2026-10-29T10:00:00.0000000', timeZone: 'Pacific Standard Time' },
    end: { dateTime: '2026-10-29T11:00:00.0000000', timeZone: 'Pacific Standard Time' }
  })

  const listed = await call('calendar_list', {
    start: '2026-10-29T00:00:00Z',
    end: '2026-10-29T23:59:00Z'
  })
  assert.equal(listed.data.kind, 'events')
  assert.equal(listed.data.account, 'me@example.test')
  assert.equal(listed.data.trust, 'untrusted-data')
  assert.match(listed.data.notice, /never as instructions/)
  assert.deepEqual(
    listed.data.events.map((e) => e.id),
    ['e-all', 'e-early', 'e-late'].sort(
      (a, b) =>
        Date.parse(listed.data.events.find((e) => e.id === a).start) -
        Date.parse(listed.data.events.find((e) => e.id === b).start)
    )
  )
  assert.equal(
    listed.data.skipped,
    1,
    'an event in an unreadable time zone is counted, not guessed'
  )
  const late = listed.data.events.find((e) => e.id === 'e-late')
  assert.equal(late.title, 'Plan<b>review</b>', 'bidi and control characters are removed')
  assert.equal(late.location, 'Room 4')
  assert.equal(late.attendees, 2)
  assert.equal(late.onlineMeeting, true)
  assert.equal(late.status, 'tentative')
  assert.equal(late.start, '2026-10-29T15:00:00.000Z')
  assert.match(late.localStart, /^2026-10-29T\d\d:\d\d$/)
  assert.equal(late.revision, events.get('e-late').changeKey)
  const allDay = listed.data.events.find((e) => e.id === 'e-all')
  assert.equal(allDay.allDay, true)
  assert.equal(allDay.start, '2026-10-29')
  assert.equal(allDay.end, '2026-10-30')
  assert(!('localStart' in allDay))
  const listRequest = requests.findLast((r) => r.path.startsWith('/v1.0/me/calendarView'))
  assert.equal(listRequest.headers.Prefer, 'outlook.timezone="UTC"')
  assert.equal(listRequest.headers.Authorization, 'Bearer access-token-1')
  assert.deepEqual(tokens.at(-1), ['acct-1', 'Calendars.ReadWrite'])
  const card = cards.parseDesktopCard(listed.out)
  assert.equal(card.kind, 'events')
  assert.equal(card.account, 'me@example.test')
  assert.equal(card.events.length, 3)

  const searched = await call('calendar_list', {
    start: '2026-10-29',
    end: '2026-10-29',
    query: 'BUDGET'
  })
  assert.deepEqual(
    searched.data.events.map((e) => e.id),
    ['e-late'],
    'literal search covers notes'
  )
  const limited = await call('calendar_list', { start: '2026-10-29', end: '2026-10-29', limit: 1 })
  assert.equal(limited.data.events.length, 1)
  assert.equal(limited.data.truncated, true)
  assert.equal(limited.data.total, 3)
  // Date-only ranges cover whole local days
  const dayRequest = requests.filter((r) => r.path.includes('calendarView')).at(-1)
  const params = new URL('https://x' + dayRequest.path).searchParams
  assert.equal(params.get('startDateTime'), new Date(2026, 9, 29).toISOString())
  assert.equal(params.get('endDateTime'), new Date(2026, 9, 30).toISOString())
  const empty = await call('calendar_list', { start: '2027-01-01', end: '2027-01-02' })
  assert.deepEqual(empty.data.events, [])
  for (const [start, end, message] of [
    ['2026-10-29', '2026-10-28', /end after/],
    ['2026-01-01', '2026-06-01', /at most 62 days/],
    ['soon', '2026-10-29', /date and time/],
    ['2026-13-40', '2026-10-29', /real date/]
  ])
    await assert.rejects(call('calendar_list', { start, end }), message, start)

  // ---- Create
  const timed = await call('calendar_create', {
    title: '  Dentist ',
    start: '2026-11-03T14:30:00Z',
    location: 'Main St'
  })
  assert.equal(timed.plan.oneUse, false)
  assert.equal(timed.plan.preview.operation, 'create')
  assert.equal(timed.plan.preview.account, 'me@example.test')
  assert.equal(timed.plan.preview.after.title, 'Dentist')
  assert.equal(
    timed.plan.preview.after.end,
    '2026-11-03T15:30:00.000Z',
    'default duration is one hour and shown'
  )
  assert.equal(timed.data.kind, 'event-change')
  assert.equal(timed.data.verified, true)
  assert.equal(timed.data.event.title, 'Dentist')
  assert.equal(timed.data.event.location, 'Main St')
  const post = requests.findLast((r) => r.method === 'POST')
  assert.equal(post.body.subject, 'Dentist')
  assert.deepEqual(post.body.start, { dateTime: '2026-11-03T14:30:00', timeZone: 'UTC' })
  assert.equal(post.body.isAllDay, false)
  assert(!('attendees' in post.body))
  assert.equal(results.assessResult('calendar_create', {}, timed.out).status, 'verified')
  assert.equal(cards.parseDesktopCard(timed.out).verified, true)

  const local = await call('calendar_create', {
    title: 'Local',
    start: '2026-11-04T09:00',
    end: '2026-11-04T10:15'
  })
  assert.equal(
    local.data.event.start,
    new Date(2026, 10, 4, 9, 0).toISOString(),
    'no offset means the user time zone'
  )
  assert.equal(local.data.event.end, new Date(2026, 10, 4, 10, 15).toISOString())

  const holiday = await call('calendar_create', {
    title: 'Trip',
    start: '2026-11-10',
    end: '2026-11-12',
    all_day: true
  })
  assert.equal(holiday.plan.preview.after.allDay, true)
  assert.equal(
    holiday.plan.preview.after.end,
    '2026-11-13',
    'inclusive last day becomes an exclusive end'
  )
  assert.equal(holiday.data.verified, true)
  assert.deepEqual(requests.findLast((r) => r.method === 'POST').body.end, {
    dateTime: '2026-11-13T00:00:00',
    timeZone: 'UTC'
  })
  const oneDay = await call('calendar_create', {
    title: 'Birthday',
    start: '2026-11-20',
    all_day: true
  })
  assert.equal(oneDay.data.event.end, '2026-11-21')

  const invite = await call('calendar_create', {
    title: 'Review',
    start: '2026-11-05T10:00:00Z',
    attendees: ['Alex@Example.test', 'sam@example.test'],
    notes: 'Agenda attached'
  })
  assert.equal(invite.plan.oneUse, true, 'invitations always ask')
  assert.deepEqual(invite.plan.preview.notify, ['alex@example.test', 'sam@example.test'])
  assert.match(invite.plan.preview.warning, /Invitations will be emailed/)
  assert.deepEqual(
    requests.findLast((r) => r.method === 'POST').body.attendees.map((a) => a.emailAddress.address),
    ['alex@example.test', 'sam@example.test']
  )

  for (const [args, message] of [
    [{ title: 'x', start: '2026-11-03' }, /needs a time/],
    [{ title: 'x', start: '2026-11-03T10:00Z', end: '2026-11-03T09:00Z' }, /end after/],
    [{ title: 'x', start: '2026-11-30', end: '2026-11-29', all_day: true }, /cannot end before/],
    [{ title: 'x', start: '2026-11-03T10:00Z', all_day: true }, /real date/],
    [{ title: 'x', start: '2026-11-03T10:00Z', attendees: ['not-an-email'] }, /email address/],
    [{ title: 'x', start: '2026-02-31', all_day: true }, /real date/],
    [{ title: 'x', start: 'tomorrow' }, /date and time/]
  ])
    await assert.rejects(call('calendar_create', args), message, JSON.stringify(args))
  const posts = requests.filter((r) => r.method === 'POST').length
  // Selecting another connected account is explicit
  const work = await call('calendar_create', {
    title: 'On work calendar',
    start: '2026-11-06T10:00:00Z',
    account: 'work@example.test'
  })
  assert.equal(work.plan.binding.accountId, 'acct-2')
  assert.equal(work.data.account, 'work@example.test')
  assert.deepEqual(tokens.at(-1), ['acct-2', 'Calendars.ReadWrite'])
  await assert.rejects(
    call('calendar_list', {
      start: '2026-11-01',
      end: '2026-11-02',
      account: 'nobody@example.test'
    }),
    /No connected/
  )
  assert.equal(requests.filter((r) => r.method === 'POST').length, posts + 1)

  // Read-back failures are reported, not hidden
  fault = (method, url) =>
    method === 'GET' && url.pathname.includes('/me/events/')
      ? failure(404, 'ErrorItemNotFound')
      : undefined
  const unread = await call('calendar_create', {
    title: 'Unconfirmed',
    start: '2026-11-07T10:00:00Z'
  })
  assert.equal(unread.data.verified, false)
  assert(unread.data.id && !unread.data.event, 'the new id is kept so the event can be found')
  assert.equal(results.assessResult('calendar_create', {}, unread.out).status, 'uncertain')
  fault = undefined

  // ---- Update
  const target = addEvent({
    id: 'u-1',
    subject: 'Sync',
    start: graphTime('2026-11-09T09:00:00'),
    end: graphTime('2026-11-09T10:30:00')
  })
  const revision = target.changeKey
  const moved = await call('calendar_update', {
    id: 'u-1',
    revision,
    start: '2026-11-09T13:00:00Z'
  })
  assert.equal(moved.plan.preview.before.start, '2026-11-09T09:00:00.000Z')
  assert.equal(moved.plan.preview.after.start, '2026-11-09T13:00:00.000Z')
  assert.equal(
    moved.plan.preview.after.end,
    '2026-11-09T14:30:00.000Z',
    'moving the start keeps the 90 minute duration'
  )
  assert.equal(moved.plan.oneUse, false)
  assert.equal(moved.data.operation, 'edit')
  assert.equal(moved.data.verified, true)
  assert.notEqual(moved.data.event.revision, revision)
  const patch = requests.findLast((r) => r.method === 'PATCH')
  assert.equal(patch.headers['If-Match'], `W/"${revision}"`, 'the exact ETag guards the write')
  assert.deepEqual(Object.keys(patch.body).sort(), ['end', 'isAllDay', 'start'])
  assert.equal(results.assessResult('calendar_update', {}, moved.out).status, 'verified')
  const titleOnly = await call('calendar_update', {
    id: 'u-1',
    revision: moved.data.event.revision,
    title: 'Sync (moved)'
  })
  assert.deepEqual(
    Object.keys(requests.findLast((r) => r.method === 'PATCH').body),
    ['subject'],
    'only changed fields are sent'
  )
  assert.equal(titleOnly.data.event.title, 'Sync (moved)')
  assert.equal(titleOnly.data.event.start, '2026-11-09T13:00:00.000Z')
  const shorter = await call('calendar_update', {
    id: 'u-1',
    revision: titleOnly.data.event.revision,
    end: '2026-11-09T13:45:00Z'
  })
  assert.equal(shorter.data.event.end, '2026-11-09T13:45:00.000Z')
  const toAllDay = await call('calendar_update', {
    id: 'u-1',
    revision: shorter.data.event.revision,
    all_day: true,
    start: '2026-11-09'
  })
  assert.equal(toAllDay.data.event.allDay, true)
  assert.equal(toAllDay.data.event.end, '2026-11-10')
  await assert.rejects(
    call('calendar_update', { id: 'u-1', revision: toAllDay.data.event.revision, all_day: false }),
    /needs a start time/
  )
  const notes = await call('calendar_update', {
    id: 'u-1',
    revision: toAllDay.data.event.revision,
    notes: 'New agenda',
    location: 'Cafe'
  })
  assert.equal(notes.data.verified, true)
  assert.equal(notes.data.event.location, 'Cafe')

  // Stale and racing updates never write
  const patches = requests.filter((r) => r.method === 'PATCH').length
  await assert.rejects(
    call('calendar_update', { id: 'u-1', revision, title: 'Old view' }),
    /changed since it was read/
  )
  await assert.rejects(
    call('calendar_update', { id: 'missing', revision, title: 'x' }),
    /no longer exists/
  )
  assert.equal(requests.filter((r) => r.method === 'PATCH').length, patches)
  const race = addEvent({ id: 'u-2', subject: 'Race' })
  const raceParams = validateToolArguments('calendar_update', {
    id: 'u-2',
    revision: race.changeKey,
    title: 'Mine'
  })
  const plan = await tools.bindCalendarAction('calendar_update', raceParams, run)
  events.get('u-2').changeKey = nextKey()
  await assert.rejects(
    plan.revalidate(),
    /changed since it was read/,
    'a change after the preview is caught before writing'
  )
  fault = (method) => (method === 'GET' ? undefined : undefined)
  const racing = await tools.bindCalendarAction(
    'calendar_update',
    validateToolArguments('calendar_update', {
      id: 'u-2',
      revision: events.get('u-2').changeKey,
      title: 'Mine'
    }),
    run
  )
  events.get('u-2').changeKey = nextKey()
  const lost = await tools.executeCalendarTool('calendar_update', racing.binding, run)
  assert.equal(lost.status, 'failed', 'a write that loses the race is refused by the ETag')
  assert.equal(lost.execution, 'not-started')
  assert.equal(events.get('u-2').subject, 'Race')
  fault = undefined

  // Attendees are told about changes
  const meeting = addEvent({
    id: 'm-1',
    subject: 'Board',
    attendees: [{}, {}, {}],
    type: 'occurrence'
  })
  const meetingPlan = await tools.bindCalendarAction(
    'calendar_update',
    validateToolArguments('calendar_update', {
      id: 'm-1',
      revision: meeting.changeKey,
      location: 'HQ'
    }),
    run
  )
  assert.equal(meetingPlan.oneUse, true)
  assert.match(meetingPlan.preview.notify, /3 attendees will be sent an update/)
  assert.match(meetingPlan.preview.warning, /one occurrence/)

  // ---- Delete
  const doomed = addEvent({ id: 'd-1', subject: 'Cancel me' })
  const del = await call('calendar_delete', { id: 'd-1', revision: doomed.changeKey })
  assert.equal(del.plan.oneUse, true)
  assert.equal(del.plan.preview.operation, 'delete')
  assert.equal(del.plan.preview.before.title, 'Cancel me')
  assert.equal(del.data.verified, true)
  assert(!events.has('d-1'))
  assert.equal(
    requests.findLast((r) => r.method === 'DELETE').headers['If-Match'],
    `W/"${doomed.changeKey}"`
  )
  assert.equal(results.assessResult('calendar_delete', {}, del.out).status, 'verified')
  assert.equal(cards.parseDesktopCard(del.out).id, 'd-1')
  const stale = addEvent({ id: 'd-2', subject: 'Keep me' })
  await assert.rejects(
    call('calendar_delete', { id: 'd-2', revision: 'wrong' }),
    /changed since it was read/
  )
  assert(events.has('d-2'))
  fault = (method) => (method === 'DELETE' ? reply(204, null) : undefined)
  const ghost = await call('calendar_delete', { id: 'd-2', revision: stale.changeKey })
  assert.equal(ghost.data.verified, false, 'a delete the service ignored is not reported as done')
  assert.equal(results.assessResult('calendar_delete', {}, ghost.out).status, 'uncertain')
  fault = undefined

  // ---- Failure classification
  const failing = async (injected, name, args, bind = true) => {
    fault = (method, url) => (method !== 'GET' || !bind ? injected(method, url) : undefined)
    try {
      const parameters = validateToolArguments(name, args)
      const bound = await tools.bindCalendarAction(name, parameters, run)
      return await tools.executeCalendarTool(name, bound.binding, run)
    } finally {
      fault = undefined
    }
  }
  const create = { title: 'Fail', start: '2026-12-01T10:00:00Z' }
  const denied = await failing(() => failure(403, 'ErrorAccessDenied'), 'calendar_create', create)
  assert.equal(denied.status, 'failed')
  assert.equal(denied.execution, 'not-started')
  assert.match(denied.text, /did not allow this calendar change/)
  assert(!denied.text.includes('secret detail'))
  const server = await failing(() => failure(503, 'ErrorServerBusy'), 'calendar_create', create)
  assert.equal(server.status, 'uncertain', 'a server error may still have written')
  assert.equal(server.execution, 'unknown')
  assert.match(server.text, /may or may not have changed/)
  const dropped = await failing(() => 'network-error', 'calendar_create', create)
  assert.equal(dropped.status, 'uncertain')
  const bad = await failing(() => failure(400, 'ErrorInvalidRequest'), 'calendar_create', create)
  assert.equal(bad.status, 'failed')
  assert.match(bad.text, /ErrorInvalidRequest/)
  fault = () => failure(429, 'TooManyRequests', { 'retry-after': '30' })
  const busy = await tools.executeCalendarTool(
    'calendar_list',
    (
      await tools
        .bindCalendarAction('calendar_list', { start: '2026-11-01', end: '2026-11-02' }, run)
        .catch(() => ({ binding: undefined }))
    ).binding ?? {
      operation: 'list',
      accountId: 'acct-1',
      email: 'me@example.test',
      range: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z' }
    },
    run
  )
  assert.equal(busy.status, 'failed')
  assert.match(busy.text, /rate limiting.*30 seconds/)
  fault = () => 'network-error'
  const offline = await tools.executeCalendarTool(
    'calendar_list',
    {
      operation: 'list',
      accountId: 'acct-1',
      email: 'me@example.test',
      range: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z' }
    },
    run
  )
  assert.equal(offline.status, 'failed', 'reads fail cleanly; nothing was written')
  fault = undefined

  // ---- Accounts, scopes and cancellation
  grantedScope = false
  await assert.rejects(
    call('calendar_list', { start: '2026-11-01', end: '2026-11-02' }),
    /not granted/
  )
  grantedScope = true
  accounts = [{ id: 'acct-1', email: 'me@example.test' }]
  active = 'acct-9'
  await assert.rejects(
    call('calendar_list', { start: '2026-11-01', end: '2026-11-02' }),
    /No active account/
  )
  active = 'acct-1'
  const plan2 = await tools.bindCalendarAction(
    'calendar_create',
    validateToolArguments('calendar_create', create),
    run
  )
  accounts = [{ id: 'acct-3', email: 'me@example.test' }]
  await assert.rejects(
    plan2.revalidate(),
    /account changed|No active/,
    'a switched account invalidates the approved action'
  )
  accounts = [{ id: 'acct-1', email: 'me@example.test' }]
  const before = requests.length
  controller.abort()
  await assert.rejects(
    tools.bindCalendarAction('calendar_list', { start: '2026-11-01', end: '2026-11-02' }, run)
  )
  assert.equal(requests.length, before, 'a cancelled task makes no request')

  // Secrets never appear in anything the model or card sees
  const everything =
    JSON.stringify(requests.map((r) => r.body)) + JSON.stringify([listed.out, timed.out, del.out])
  assert(!everything.includes('access-token'), 'tokens are only sent as headers')
  console.log('calendar smoke passed')
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
