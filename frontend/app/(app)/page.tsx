import Link from 'next/link';
import { SectionCard } from '@/components/SectionCard';
import { ActiveGreeting } from '@/components/home/ActiveGreeting';
import { HomeStats } from '@/components/home/HomeStats';
import { RecentActivityCard } from '@/components/home/RecentActivityCard';
import { HomeClock } from '@/components/HomeClock';
import { calendarEvents } from '@/lib/data';
import { formatTime, startOfAppDay, formatLongDate } from '@/lib/format';

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
          {/* Client-rendered: the name follows the signed-in persona and the
              greeting follows the real clock, neither of which a prerendered
              server component can know. */}
          <ActiveGreeting />
          <p>Here&apos;s what&apos;s happening with your teams today.</p>
        </div>
        {/* Still frozen at build time, and the one remaining date on the page.
            Moving it client-side would need the same mount gate the greeting
            uses, which was out of scope here. */}
        <span className="welcome-badge">
          {formatLongDate(now)}
        </span>
      </div>

      {/* Client-rendered: the server cannot know the viewer's clock. */}
      <HomeClock events={calendarEvents} />

      <HomeStats />

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

        <RecentActivityCard />
      </div>
    </>
  );
}
