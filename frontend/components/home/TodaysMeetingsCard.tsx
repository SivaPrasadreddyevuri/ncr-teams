'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { useHomeEvents } from '@/components/home/HomeEventsProvider';
import { formatTime, startOfAppDay } from '@/lib/format';

/**
 * "Today's Meetings" on the dashboard.
 *
 * A client component reading the shared event list rather than taking it as a prop,
 * so the home page fetches its events once. The day boundary is the app zone's,
 * not the browser's -- the server cannot know the viewer's zone, and the browser's
 * own local day is wrong for anyone outside it, which is most of a distributed team.
 *
 * The list is filtered on the client because "now" advances every second on this
 * page and re-fetching on a tick would be absurd. The window fetched upstream is
 * two days, so there is always something here to filter down from.
 */
export function TodaysMeetingsCard() {
  const { events, stale } = useHomeEvents();

  const todaysMeetings = useMemo(() => {
    const now = new Date();
    const todayStart = startOfAppDay(now).getTime();
    const todayEnd = todayStart + 86_399_999;

    return events
      .filter((event) => {
        const start = new Date(event.startsAt).getTime();
        return start >= todayStart && start <= todayEnd;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events]);

  return (
    <SectionCard title="Today&apos;s Meetings" href="/calendar">
      {stale && (
        <small style={{ color: 'var(--muted)' }}>Showing the last known schedule</small>
      )}
      {todaysMeetings.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>
          Nothing scheduled today.
        </p>
      ) : (
        todaysMeetings.map((event) => (
          <div className="meeting-row" key={event.id}>
            <span className="time">{formatTime(event.startsAt)}</span>
            <div className="meeting-info">
              <strong>{event.title}</strong>
              <small>
                {event.attendeeIds.length} participants &bull; {event.location}
              </small>
            </div>
            {event.meetingId ? (
              <Link className="join" href={`/meetings?room=${event.meetingId}`}>
                Join
              </Link>
            ) : (
              <span className="join" style={{ opacity: 0.5 }}>
                View
              </span>
            )}
          </div>
        ))
      )}
    </SectionCard>
  );
}
