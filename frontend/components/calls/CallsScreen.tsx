'use client';

import { useMemo } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { PhoneIncoming, PhoneMissed } from 'lucide-react';
import { api, type CalendarEventDto, type MeetingDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { calendarEvents } from '@/lib/data';
import { formatTime, relativeTime, APP_TIME_ZONE } from '@/lib/format';

/**
 * A client component because both lists need the session cookie.
 *
 * `past` is a meetings read, not an events read. A MEETING row on the calendar is a
 * different thing from a meeting: it has no `roomName`, no participant list and no
 * transcript, so building the call history out of `/events` would quietly lose the
 * join time this list renders. `/api/meetings?scope=past` returns the meeting rows
 * themselves.
 *
 * `missed` is still the fixture's `id === 'mt4'` check. Deciding what "missed" means
 * needs attendance data that does not exist yet -- a meeting you never joined is not
 * recorded anywhere -- so rather than infer it from a clock it is left where it is
 * and the seed is the source.
 */
export function CallsScreen() {
  const people = useDirectory();

  const finished = useApiData<MeetingDto[]>(
    'meetings:past',
    (signal) => api.meetings({ scope: 'past', days: 30, limit: 4 }, signal).then((r) => r.meetings),
    // No fixture seed for the same reason the queue has none: the fixture `meetings`
    // are upcoming, not past, so using them would put future calls in a history list.
    [],
  );

  const past = finished.data.slice(0, 4);

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
        {past.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>
            {finished.stale ? 'Could not load your call history.' : 'No finished calls yet.'}
          </p>
        )}

        {past.map((meeting) => {
          // The organiser is one of the participants, flagged by the server. Looking
          // them up by id separately would be a second source of truth for the same
          // fact.
          const organizerId = meeting.participants.find((p) => p.isOrganizer)?.id;
          // `PersonAvatar` wants a full `Person`, and a participant carries only the
          // three fields the API joins. The directory has the rest, so it is the
          // source for the avatar and `online`; the participant row is the source for
          // who organised it.
          const organizer = people.find((person) => person.id === organizerId);
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
