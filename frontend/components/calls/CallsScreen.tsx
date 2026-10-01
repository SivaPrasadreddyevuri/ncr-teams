'use client';

import { useMemo } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { PhoneIncoming, PhoneMissed } from 'lucide-react';
import { api, type CalendarEventDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { calendarEvents, meetings, personById } from '@/lib/data';
import { formatTime, relativeTime, APP_TIME_ZONE } from '@/lib/format';

/**
 * A client component because the upcoming list needs the session cookie.
 *
 * `past` stays on the fixture `meetings` because there is no meetings endpoint
 * yet. It is deliberately not derived from events: a finished meeting and a
 * calendar entry are different rows, and collapsing them would quietly lose the
 * join time and the missed-call state this list renders.
 */
export function CallsScreen() {
  const past = useMemo(
    () => [...meetings].sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 4),
    [],
  );

  const events = useApiData<CalendarEventDto[]>(
    'events:calls',
    (signal) => api.events({ days: 14, limit: 50 }, signal).then((r) => r.events),
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

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events.data
      .filter((event) => new Date(event.startsAt).getTime() > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 4);
  }, [events.data]);

  return (
    <div className="grid-2">
      <SectionCard title="Call History" href="/meetings">
        {past.map((meeting) => {
          const organizer = personById(meeting.organizerId);
          const missed = meeting.id === 'mt4';
          return (
            <div className="meeting-row" key={meeting.id}>
              <PersonAvatar person={organizer} size="sm" online={organizer?.online} />
              <div className="meeting-info">
                <strong>{meeting.title}</strong>
                <small>
                  {organizer?.name ?? 'Unknown'} &bull; {relativeTime(meeting.startsAt)}
                </small>
              </div>
              <span className="chip">
                {missed ? <PhoneMissed size={11} /> : <PhoneIncoming size={11} />} {missed ? 'Missed' : 'Ended'}
              </span>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Upcoming With Links" href="/calendar">
        {upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>
            Nothing scheduled.
          </p>
        ) : (
          upcoming.map((event) => (
            <div className="meeting-row" key={event.id}>
              <span className="time is-date">
                {new Date(event.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE })}
              </span>
              <div className="meeting-info">
                <strong>{event.title}</strong>
                <small>
                  {formatTime(event.startsAt)} &bull; {event.location}
                </small>
              </div>
              <span className="chip">{event.meetingId ? 'Link ready' : 'No link'}</span>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );
}
