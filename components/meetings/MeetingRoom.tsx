'use client';

import { useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Users,
  MessageSquare,
  Settings2,
  Hand,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { initials, relativeTime } from '@/lib/format';
import type { Meeting, Person } from '@/lib/data';

type ChatLine = { id: string; authorId: string; body: string; createdAt: string };

export function MeetingRoom({
  meeting,
  people,
  currentUserId,
  onLeave,
}: {
  meeting: Meeting;
  people: Person[];
  currentUserId: string;
  onLeave: () => void;
}) {
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [panel, setPanel] = useState<'people' | 'chat'>('people');
  const [lines, setLines] = useState<ChatLine[]>(meeting.messages);
  const [draft, setDraft] = useState('');

  const participants = meeting.participantIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));

  function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setLines((current) => [
      ...current,
      { id: `local-${Date.now()}`, authorId: currentUserId, body, createdAt: new Date().toISOString() },
    ]);
    setDraft('');
  }

  return (
    <div className="meeting-wrap">
      <div className="meeting-room">
        <div className="video-grid">
          {participants.map((person) => {
            const isSelf = person.id === currentUserId;
            return (
              <div className="video" key={person.id}>
                <Avatar initials={initials(person.name)} size="lg" online={person.online} />
                <span className="person">
                  {isSelf ? `${person.name} (You)` : person.name}
                  {handRaised && isSelf && <Hand size={12} style={{ marginLeft: 5 }} />}
                </span>
              </div>
            );
          })}

          {sharing && (
            <div className="video">
              <MonitorUp size={30} />
              <span className="person">You are sharing your screen</span>
            </div>
          )}
        </div>

        <aside className="meeting-side">
          <h3>{meeting.title}</h3>
          <p style={{ fontSize: 12, color: '#99a5ba', margin: '0 0 12px' }}>
            {meeting.participantIds.length} participants
          </p>

          <div className="meeting-side-tabs">
            <button
              className={panel === 'people' ? 'active' : ''}
              onClick={() => setPanel('people')}
            >
              People
            </button>
            <button
              className={panel === 'chat' ? 'active' : ''}
              onClick={() => setPanel('chat')}
            >
              Chat
            </button>
          </div>

          {panel === 'people' ? (
            participants.map((person) => (
              <div className="dark-person" key={person.id}>
                <Avatar initials={initials(person.name)} size="sm" online={person.online} />
                <span>
                  <strong style={{ display: 'block' }}>
                    {person.name}
                    {person.id === currentUserId && ' (You)'}
                  </strong>
                  {person.jobTitle ?? 'Team member'}
                </span>
              </div>
            ))
          ) : (
            <>
              <div className="meeting-chat">
                {lines.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#99a5ba' }}>No messages yet.</p>
                ) : (
                  lines.map((line) => {
                    const author = people.find((p) => p.id === line.authorId);
                    return (
                      <div className="meeting-chat-row" key={line.id}>
                        <strong>{author?.name ?? 'Unknown'}</strong>
                        <small>{line.body}</small>
                        <small style={{ color: '#7c8aa0' }}>{relativeTime(line.createdAt)}</small>
                      </div>
                    );
                  })
                )}
              </div>

              <form className="meeting-chat-input" onSubmit={send}>
                <input
                  placeholder="Message everyone"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-label="Meeting message"
                />
                <button type="submit" disabled={!draft.trim()} aria-label="Send">
                  <MessageSquare size={15} />
                </button>
              </form>
            </>
          )}
        </aside>
      </div>

      <div className="meeting-controls">
        <button
          className={micOn ? 'control active' : 'control off'}
          type="button"
          onClick={() => setMicOn((c) => !c)}
          aria-pressed={micOn}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {micOn ? <Mic size={17} /> : <MicOff size={17} />}
        </button>

        <button
          className={cameraOn ? 'control active' : 'control off'}
          type="button"
          onClick={() => setCameraOn((c) => !c)}
          aria-pressed={cameraOn}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <Video size={17} /> : <VideoOff size={17} />}
        </button>

        <button
          className={sharing ? 'control active' : 'control'}
          type="button"
          onClick={() => setSharing((c) => !c)}
          aria-pressed={sharing}
          aria-label="Share screen"
        >
          <MonitorUp size={17} />
        </button>

        <button
          className={handRaised ? 'control active' : 'control'}
          type="button"
          onClick={() => setHandRaised((c) => !c)}
          aria-pressed={handRaised}
          aria-label="Raise hand"
        >
          <Hand size={17} />
        </button>

        <button
          className={panel === 'people' ? 'control active' : 'control'}
          type="button"
          onClick={() => setPanel('people')}
          aria-label="Show participants"
        >
          <Users size={17} />
        </button>

        <button
          className={panel === 'chat' ? 'control active' : 'control'}
          type="button"
          onClick={() => setPanel('chat')}
          aria-label="Show meeting chat"
        >
          <MessageSquare size={17} />
        </button>

        <button className="control" type="button" disabled aria-label="Device settings">
          <Settings2 size={17} />
        </button>

        <button className="control leave" type="button" onClick={onLeave} aria-label="Leave meeting">
          <PhoneOff size={17} />
        </button>
      </div>
    </div>
  );
}
