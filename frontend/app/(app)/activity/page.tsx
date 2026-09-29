import Link from 'next/link';
import {
  AtSign,
  FilePlus2,
  Clock3,
  CalendarCheck,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { activity, calendarEvents } from '@/lib/data';
import { formatTime, relativeTime, APP_TIME_ZONE } from '@/lib/format';
import type { ActivityItem } from '@/lib/data';

const icons: Record<ActivityItem['kind'], LucideIcon> = {
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

const JUMPS = [
  { href: '/chat', label: 'Chat', icon: AtSign },
  { href: '/files', label: 'Files', icon: FilePlus2 },
  { href: '/meetings', label: 'Meetings', icon: Clock3 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/hr', label: 'HR', icon: CalendarCheck },
];

export default function ActivityPage() {
  const upcoming = [...calendarEvents]
    .filter((event) => new Date(event.startsAt).getTime() > Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5);

  return (
    <div className="grid-2">
      <SectionCard title="Recent Activity" href="/chat">
        {activity.map((item) => {
          const Icon = icons[item.kind];
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
