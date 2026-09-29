import Link from 'next/link';
import { SectionCard } from '@/components/SectionCard';
import { StatCard } from '@/components/StatCard';
import {
  CalendarDays,
  FileText,
  MessageCircle,
  UsersRound,
  Clock3,
  AtSign,
  FilePlus2,
  CalendarCheck,
  type LucideIcon,
} from 'lucide-react';
import { activity, calendarEvents, dashboardStats } from '@/lib/data';
import { formatTime, relativeTime, startOfAppDay, appHour, formatLongDate } from '@/lib/format';
import { HomeClock } from '@/components/HomeClock';
import type { ActivityItem } from '@/lib/data';

const activityIcons: Record<ActivityItem['kind'], LucideIcon> = {
  message: AtSign,
  file: FilePlus2,
  meeting: Clock3,
  leave: CalendarCheck,
};

const tones: Record<ActivityItem['kind'], string> = {
  message: 'tone-blue',
  file: 'tone-purple',
  meeting: 'tone-pink',
  leave: 'tone-orange',
};

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  // "Today" is the viewer's day in the app zone, not the build server's. Using
  // the host's local day here would freeze the wrong day into the static HTML.
  const now = new Date();
  const todayStart = startOfAppDay(now).getTime();
  const todayEnd = todayStart + 86_399_999;

  const todaysMeetings = calendarEvents
    .filter((event) => {
      const start = new Date(event.startsAt).getTime();
      return start >= todayStart && start <= todayEnd;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <>
      <div className="welcome">
        <div>
          <h2>
            {greeting(appHour(now))}, Alex
          </h2>
          <p>Here&apos;s what&apos;s happening with your teams today.</p>
        </div>
        {/* Rendered here, in a server component, so it is frozen at build time
            and can name a date that is no longer today. It stays because it is
            the only date left on the dashboard, but it is a known wart. */}
        <span className="welcome-badge">
          {formatLongDate(now)}
        </span>
      </div>

      <HomeClock events={calendarEvents} />

      <div className="stats">
        <StatCard label="New messages" value={String(dashboardStats.messages)} icon={MessageCircle} tone="tone-blue" />
        <StatCard label="Upcoming meetings" value={String(dashboardStats.meetings)} icon={CalendarDays} tone="tone-purple" />
        <StatCard label="Pending requests" value={String(dashboardStats.pendingRequests)} icon={FileText} tone="tone-pink" />
        <StatCard label="Team mentions" value={String(dashboardStats.mentions)} icon={UsersRound} tone="tone-orange" />
      </div>

      <div className="grid-2">
        <SectionCard title="Today's Meetings" href="/calendar">
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

        <SectionCard title="Recent Activity" href="/activity">
          {activity.slice(0, 5).map((item) => {
            const Icon = activityIcons[item.kind];
            return (
              <div className="activity-row" key={item.id}>
                <span className={`activity-icon ${tones[item.kind]}`}>
                  <Icon size={15} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </div>
                <small style={{ color: 'var(--muted)' }}>{relativeTime(item.at)}</small>
              </div>
            );
          })}
        </SectionCard>
      </div>
    </>
  );
}
