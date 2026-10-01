'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, type CalendarEventDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { calendarEvents } from '@/lib/data';

/**
 * Today's events, fetched once for the whole home page.
 *
 * The dashboard needs the same list in two places -- the clock shows the next
 * meeting, and the "Today's Meetings" card lists them -- and they are siblings in
 * the layout rather than parent and child. A provider is the alternative to
 * fetching twice, and it keeps the rest of the page server-rendered: the greeting
 * and the date stay prerendered, where making the whole page a client component
 * would have lost that.
 */
const HomeEventsContext = createContext<{ events: CalendarEventDto[]; stale: boolean } | null>(null);

/**
 * The window fetched.
 *
 * Two days rather than one, because the window is resolved from the browser's
 * clock and then filtered against the app-zone day boundaries below. A one-day
 * window starting at "now" misses events later in the app zone's day.
 */
const WINDOW_DAYS = 2;

export function HomeEventsProvider({ children }: { children: ReactNode }) {
  const { data, stale } = useApiData<CalendarEventDto[]>(
    'events:home',
    (signal) => api.events({ days: WINDOW_DAYS, limit: 50 }, signal).then((r) => r.events),
    // The fixture events already match `CalendarEventDto` apart from
    // `attendeeNames`, which the fixture never had.
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

  const value = useMemo(() => ({ events: data, stale }), [data, stale]);

  return <HomeEventsContext.Provider value={value}>{children}</HomeEventsContext.Provider>;
}

/**
 * The events, or an empty list outside a provider.
 *
 * The empty list rather than a throw: a component that is correct only when
 * correctly wrapped is a component that breaks the first time it is reused, and
 * an empty "nothing scheduled" is the right answer for a missing provider.
 */
export function useHomeEvents(): { events: CalendarEventDto[]; stale: boolean } {
  return useContext(HomeEventsContext) ?? { events: [], stale: false };
}
