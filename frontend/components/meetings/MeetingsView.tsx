'use client';

import { useState } from 'react';
import { Video, Clock3 } from 'lucide-react';
import { MeetingRoom } from './MeetingRoom';
import { SectionCard } from '@/components/SectionCard';
import { Avatar } from '@/components/Avatar';
import { currentUser, meetings, personById, directory } from '@/lib/data';
import { formatTime, initials, relativeTime, APP_TIME_ZONE } from '@/lib/format';

export function MeetingsView({ initialRoomId }: { initialRoomId?: string }) {
  const [roomId, setRoomId] = useState(initialRoomId ?? null);

  const room = meetings.find((meeting) => meeting.id === roomId);

  if (room) {
    return (
      <MeetingRoom
        meeting={room}
        people={directory}
        currentUserId={currentUser.id}
        onLeave={() => setRoomId(null)}
      />
    );
  }

  return (
    <div className="grid-2">
      <SectionCard title="Your Meetings" href="/calendar">
        {meetings.map((meeting) => {
          const organizer = personById(meeting.organizerId);
          return (
            <div className="meeting-row" key={meeting.id}>
              <span className="time is-date">
                {new Date(meeting.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE })}
              </span>
              <div className="meeting-info">
                <strong>{meeting.title}</strong>
                <small>
                  {formatTime(meeting.startsAt)} &bull; Organised by {organizer?.name ?? 'Unknown'}
                </small>
              </div>
              <button className="join" type="button" onClick={() => setRoomId(meeting.id)}>
                <Video size={13} /> Join
              </button>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Meeting Rooms">
        {meetings.map((meeting) => (
          <div className="meeting-row" key={meeting.id}>
            <Avatar initials={initials(meeting.title)} size="sm" />
            <div className="meeting-info">
              <strong>{meeting.title}</strong>
              <small>{meeting.participantIds.length} participants</small>
            </div>
            <button className="join" type="button" onClick={() => setRoomId(meeting.id)}>
              Open
            </button>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Recent Activity">
        {meetings.slice(0, 3).map((meeting) => (
          <div className="activity-row" key={`recent-${meeting.id}`}>
            <span className="activity-icon tone-purple">
              <Clock3 size={15} />
            </span>
            <div>
              <strong>{meeting.title}</strong>
              <small>{meeting.messages.length} chat messages</small>
            </div>
            <small style={{ color: 'var(--muted)' }}>{relativeTime(meeting.startsAt)}</small>
          </div>
        ))}
      </SectionCard>
    </div>
  );
}
