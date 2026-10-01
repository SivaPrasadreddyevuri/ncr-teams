'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  AtSign,
  FilePlus2,
  Clock3,
  CalendarCheck,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { api, composeActivity, type ActivityRow, type CalendarEventDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { activity as seedActivity, calendarEvents as seedEvents } from '@/lib/data';
import { formatTime, relativeTime, APP_TIME_ZONE } from '@/lib/format';

const icons: Record<ActivityRow['kind'], LucideIcon> = {
  message: AtSign,
  file: FilePlus2,
  meeting: Clock3,
  leave: CalendarCheck,
};

const tones: Record<ActivityRow['kind'], string> = {
  message: 'tone-blue',
  file: 'tone-purple',
  meeting: 'tone-pink',
  leave: 'tone-orange',
};

const JUMPS = [
  { href: '/chat', label: 'Chat', icon: AtSign },
  { href: '/files', label: 'Files', icon: FilePlus2 },
  { href: '/meetings', label: 'Meetings', icon: Clock3 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/hr', label: 'HR', icon: CalendarCheck },
];

/** A feed row reduced to what this page renders. Both sources become this. */
type FeedItem = {
  id: string;
  kind: ActivityRow['kind'];
  title: string;
  subtitle: string;
  at: string;
  removed: boolean;
};

/**
 * The fixture events, as the fallback shape for `useApiData`.
 *
 * The fixture `calendarEvents` are already the shape `CalendarEventDto` expects --
 * `attendeeIds`, a non-null `location`, the same timestamps -- so the only thing
 * missing is `attendeeNames`, which the fixture never had. Empty rather than
 * invented, so nothing renders a blank name.
 */
const seedEventDtos: CalendarEventDto[] = seedEvents.map((event) => ({
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
}));

/** The fixture feed, passed through: its title is already a sentence. */
const seedFeed: FeedItem[] = seedActivity.map((item) => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  subtitle: item.subtitle,
  at: item.at,
  removed: false,
}));

/**
 * The activity feed and the next few events.
 *
 * A client component because both endpoints need the session cookie, which lives
 * in the browser. See the note on `request` in `lib/api.ts`: a server component
 * calling these does not fail, it hangs, and `next build` reports it as a slow
 * page rather than a wrong architecture.
 *
 * Both lists go through `useApiData`, which seeds each one with the fixtures -- so
 * the page renders immediately and never flashes an empty state -- and keeps the
 * localStorage cache tier, which a hand-rolled fetch would have thrown away.
 */
export function ActivityScreen() {
  const feed = useApiData<FeedItem[]>(
    'activity:page',
    (signal) =>
      api.activity(10, undefined, signal).then((response) =>
        response.activity.map((row) => {
          const sentence = composeActivity(row);
          return {
            id: row.id,
            kind: row.kind,
            title: sentence.title,
            subtitle: sentence.subtitle,
            at: row.createdAt,
            removed: sentence.deletedTarget,
          };
        }),
      ),
    seedFeed,
  );

  const events = useApiData<CalendarEventDto[]>(
    'events:activity',
    (signal) => api.events({ days: 30, limit: 100 }, signal).then((r) => r.events),
    seedEventDtos,
  );

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events.data
      .filter((event) => new Date(event.endsAt).getTime() > now)
      .slice(0, 5);
  }, [events.data]);

  return (
    <div className="grid-2">
      <SectionCard title="Recent Activity" href="/chat">
        {feed.stale && (
          <small style={{ color: 'var(--muted)' }}>Showing the last known activity</small>
        )}
        {feed.data.map((item) => {
          const Icon = icons[item.kind];
          return (
            <div className="activity-row" key={item.id}>
              <span className={`activity-icon ${tones[item.kind]}`}>
                <Icon size={15} />
              </span>
              <div>
                <strong>{item.title}</strong>
                {item.subtitle && <small>{item.subtitle}</small>}
                {/* A row whose target is gone says so, rather than naming something
                    that no longer resolves. */}
                {item.removed && <small style={{ color: 'var(--muted)' }}>The original was deleted</small>}
              </div>
              <small style={{ color: 'var(--muted)' }}>{relativeTime(item.at)}</small>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Coming Up" href="/calendar">
        {upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>
            Nothing scheduled.
          </p>
        ) : (
          upcoming.map((event) => (
            <div className="meeting-row" key={event.id}>
              {/* The day is what makes this list readable: a bare time gives no
                  hint that 13:00 is tomorrow and 16:00 is three days out. */}
              <span className="time is-date">
                {new Date(event.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE })}
              </span>
              <div className="meeting-info">
                <strong>{event.title}</strong>
                <small>
                  {formatTime(event.startsAt)} &bull; {event.location} &bull;{' '}
                  {event.attendeeIds.length} people
                </small>
              </div>
              <Link className="join" href="/calendar">
                View
              </Link>
            </div>
          ))
        )}
      </SectionCard>

      <div className="cards-grid cards-grid--quick">
        {JUMPS.map((jump) => (
          <Link className="team-card" href={jump.href} key={jump.href}>
            <div className="team-icon">
              <jump.icon size={20} />
            </div>
            <h3>{jump.label}</h3>
          </Link>
        ))}
      </div>
    </div>
  );
}
