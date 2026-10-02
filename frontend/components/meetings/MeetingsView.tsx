'use client';

import { useEffect, useMemo, useState } from 'react';
import { Video, Clock3 } from 'lucide-react';
import { MeetingRoom } from './MeetingRoom';
import { SectionCard } from '@/components/SectionCard';
import { Avatar } from '@/components/Avatar';
import { api, type MeetingDto } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { formatTime, initials, relativeTime, APP_TIME_ZONE } from '@/lib/format';
import type { Meeting } from '@/lib/data';

/**
 * Bridges the API's meeting shape to the one `MeetingRoom` renders.
 *
 * `MeetingRoom` was written against the fixture type, which carries ids and an
 * inline message array. Rather than rewrite the room for a DTO, the fields it reads
 * are mapped here -- one place, in the direction that lets the untouched component
 * stay untouched.
 *
 * `participantIds` and `messages` are filled from the joined participant list and the
 * detail endpoint's transcript. `activeUserId` comes from the directory rather than
 * the fixture `currentUser`, so switching persona in Settings moves the "you" in the
 * room with it.
 */
function toRoomMeeting(meeting: MeetingDto, messages: { id: string; body: string; createdAt: string; author: { id: string } }[], activeUserId: string): Meeting {
  return {
    id: meeting.id,
    title: meeting.title,
    roomName: meeting.roomName,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    organizerId: meeting.organizerId,
    participantIds: meeting.participants.map((p) => p.id),
    messages: messages.map((message) => ({
      id: message.id,
      authorId: message.author.id,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}

export function MeetingsView({ initialRoomId }: { initialRoomId?: string }) {
  const [roomId, setRoomId] = useState<string | null>(initialRoomId ?? null);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  /**
   * The signed-in person, from `/auth/me` rather than the fixture.
   *
   * The fixture `currentUser` is always Alex, so joining a room as anyone else would
   * highlight Alex's tiles. The fetch is also what gives this screen its session:
   * `/api/meetings` is participant-scoped, so the list is empty without one.
   */
  const me = useApiData<{ id: string } | null>(
    'meetings:me',
    async (signal) => {
      const response = await api.me(signal);
      return { id: response.user.id };
    },
    null,
  );

  const upcoming = useApiData<MeetingDto[]>(
    'meetings:upcoming',
    (signal) => api.meetings({ scope: 'upcoming', limit: 50 }, signal).then((r) => r.meetings),
    // No fixture seed. The fixture meetings carry the same ids as the seeded rows, so
    // using them as a fallback would render rows the database may not have -- and
    // would show a meeting the caller is not in after a persona switch.
    [],
  );

  useEffect(() => {
    if (me.data) setActiveUserId(me.data.id);
  }, [me.data]);

  /**
   * The joined room's detail.
   *
   * Fetched only while a room is open, so opening the screen does not read every
   * transcript. `null` while closed rather than an empty object, because the two mean
   * different things to `MeetingRoom`.
   */
  const detail = useApiData<{ messages: { id: string; body: string; createdAt: string; author: { id: string } }[] } | null>(
    'meetings:detail',
    async (signal) => {
      if (!roomId) return null;
      const response = await api.meeting(roomId, signal);
      return { messages: response.messages };
    },
    null,
  );

  const list = upcoming.data;

  /**
   * The meeting to render, preferring the joined one from the list and falling back
   * to the detail fetch.
   *
   * `scope=upcoming` includes a meeting already in progress, so a link straight to a
   * live call resolves through the same path as one from the list.
   */
  const room = useMemo(() => {
    if (!roomId || !activeUserId) return null;
    const meeting = list.find((m) => m.id === roomId);
    if (!meeting) return null;
    return toRoomMeeting(meeting, detail.data?.messages ?? [], activeUserId);
  }, [roomId, activeUserId, list, detail.data]);

  if (room) {
    return (
      <MeetingRoom meeting={room} currentUserId={activeUserId!} onLeave={() => setRoomId(null)} />
    );
  }

  /** Set while a joined id is not in the list, so the screen can say so. */
  const missing = roomId !== null && room === null;

  return (
    <div className="grid-2">
      <SectionCard title="Your Meetings" href="/calendar">
        {upcoming.stale && list.length === 0 && (
          <small style={{ color: 'var(--muted)' }}>Could not reach the server.</small>
        )}

        {list.length === 0 && !upcoming.stale && (
          <small style={{ color: 'var(--muted)' }}>Nothing scheduled.</small>
        )}

        {list.map((meeting) => {
          const organizer = meeting.participants.find((p) => p.isOrganizer);
          return (
            <div className="meeting-row" key={meeting.id}>
              <span className="time is-date">
                {new Date(meeting.startsAt).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: APP_TIME_ZONE,
                })}
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
        {list.map((meeting) => (
          <div className="meeting-row" key={meeting.id}>
            <Avatar initials={initials(meeting.title)} size="sm" />
            <div className="meeting-info">
              <strong>{meeting.title}</strong>
              {/* The count the server sent, rather than measuring the array here. */}
              <small>{meeting.participantCount} participants</small>
            </div>
            <button className="join" type="button" onClick={() => setRoomId(meeting.id)}>
              Open
            </button>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Recent Activity">
        {list.slice(0, 3).map((meeting) => (
          <div className="activity-row" key={`recent-${meeting.id}`}>
            <span className="activity-icon tone-purple">
              <Clock3 size={15} />
            </span>
            <div>
              <strong>{meeting.title}</strong>
              <small>{meeting.participantCount} participants</small>
            </div>
            <small style={{ color: 'var(--muted)' }}>{relativeTime(meeting.startsAt)}</small>
          </div>
        ))}
      </SectionCard>

      {missing && (
        <SectionCard title="Meeting">
          <small style={{ color: 'var(--muted)' }}>
            That meeting is not in your list. It may have ended, or you may not be a
            participant.
          </small>
          <button className="join" type="button" onClick={() => setRoomId(null)}>
            Back
          </button>
        </SectionCard>
      )}
    </div>
  );
}
