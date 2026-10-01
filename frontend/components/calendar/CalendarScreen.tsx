'use client';

import { CalendarWeek } from '@/components/calendar/CalendarWeek';
import { api, type CalendarEventDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { calendarEvents, currentUser, directory } from '@/lib/data';

/**
 * The window fetched up front.
 *
 * The component navigates to any week by shifting an anchor, so one fetch cannot
 * cover every week reachable. This is the widest window the API allows, which
 * makes the visible limit the same one the fixtures always had: a week with
 * nothing in it shows nothing.
 *
 * Fetching per window as the anchor moves is the correct follow-up. It is not done
 * here because it changes `CalendarWeek` from a component with initial state into
 * one that loads on every navigation -- a change to its internals, not to this
 * file. `120` is the API's `days` maximum; asking for more is a 400.
 */
const WINDOW_DAYS = 120;

/**
 * A client component because the endpoint needs the session cookie.
 *
 * `people` is still the fixture directory rather than the live one. The ids are
 * shared with the API, so attendee avatars resolve -- the same overlap the Stage A
 * screens rely on. Sourcing people live here would duplicate what
 * `ProfileProvider` already resolves on the client.
 */
export function CalendarScreen() {
  const events = useApiData<CalendarEventDto[]>(
    'events:calendar',
    (signal) => api.events({ days: WINDOW_DAYS, limit: 200 }, signal).then((r) => r.events),
    // The fixture events are already this shape apart from `attendeeNames`, which
    // the fixture never had. Empty rather than invented.
    calendarEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      type: event.type,
      organizerId: event.organizerId,
      attendeeIds: event.attendeeIds,
      attendeeNames: [],
      meetingId: event.meetingId,
      location: event.location,
    })),
  );

  return (
    <CalendarWeek
      initialEvents={events.data}
      people={directory}
      currentUserId={currentUser.id}
    />
  );
}
