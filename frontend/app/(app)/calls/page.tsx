import { SectionCard } from '@/components/SectionCard';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { PhoneIncoming, PhoneMissed, Clock3 } from 'lucide-react';
import { calendarEvents, meetings, personById } from '@/lib/data';
import { formatTime, relativeTime, APP_TIME_ZONE } from '@/lib/format';

export default function CallsPage() {
  const past = [...meetings].sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 4);

  const upcoming = [...calendarEvents]
    .filter((event) => new Date(event.startsAt).getTime() > Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);

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
