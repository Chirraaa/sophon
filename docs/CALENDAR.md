# Calendar

Sophon can read and change events in a connected Outlook / Microsoft 365
calendar through Microsoft Graph. Connect an account first
([Microsoft accounts](MICROSOFT_ACCOUNTS.md)). Permissions are under
**Settings > Permissions > Calendar**; all four default to **Ask first**.

| Tool              | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `calendar_list`   | Events between two moments (at most 62 days), optional search. |
| `calendar_create` | Add a timed or all-day event, optionally inviting people.      |
| `calendar_update` | Change title, time, location or notes of a listed event.       |
| `calendar_delete` | Delete one listed event. Always asks.                          |

Results appear in the chat as agenda and event cards. Approval cards show the
exact event, or before and after, and the account that will be used.

## Accounts

Every call names its account. With none given, Sophon uses the **active**
account, or the only signed-in one. With several connected and none active it
refuses and the assistant must ask which. An email must match exactly; if the
same address is connected twice (for example in two tenants) it refuses rather
than guess. If the account is switched or signed out after you approve, the
action is rejected.

## Times

- Times without an offset are in your Windows time zone; `Z` or an offset is
  honored. Date-only list ranges cover whole local days.
- Timed events are stored as UTC instants. Results include `localStart` and
  `localEnd` so the assistant speaks in local time.
- All-day events use dates. For a new all-day event `end` is the **last day**
  (inclusive); the calendar stores an exclusive end.
- A timed event with no `end` lasts one hour (the approval shows it). Moving only
  `start` keeps the duration.

## Safety

- **Invitations and updates reach other people**, so creating an event with
  attendees, changing an event that has attendees, and every delete require
  approval each time, even when the tool is set to Always allow. Attendees can
  only be added when creating.
- Edits and deletes carry the event `revision` from the last list. The event is
  read again before approval and again before the write, and the write sends the
  event's ETag, so a change made elsewhere in between is refused instead of
  overwritten.
- Event titles, locations and notes may come from invitations sent by other
  people. Results are marked untrusted for the assistant, and control and
  bidirectional-override characters are removed.
- Every change is read back. Create and update report **verified** only if the
  stored event matches; delete only if the event is gone. Otherwise the result is
  **uncertain** and the assistant must list the calendar again. A request that
  fails after it may have reached Microsoft (timeout, server error) is never
  retried automatically; creates carry a transaction ID so an accidental repeat
  does not duplicate the event.
- Tokens stay in the main process and are sent only to `graph.microsoft.com`.

## Limits

- Repeating events are handled one occurrence at a time; the series itself is
  not created or edited, and the approval says so.
- No attendee changes after creation, no online-meeting links, reminders,
  categories, attachments, other calendars or free/busy search.
- Up to 100 events per list. Events whose time zone Sophon cannot read are
  counted as skipped, not guessed.
- Verified with a fake Graph service that follows Microsoft's documented request
  and response shapes (`npm run smoke:calendar`), not against a live account.
  In particular, how Graph reports all-day events created in other time zones and
  its ETag handling should be confirmed on a real calendar before relying on them.
