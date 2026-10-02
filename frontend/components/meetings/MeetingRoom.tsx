'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { relativeTime } from '@/lib/format';
import { MeetingConnection, isVideoConfigured } from '@/lib/livekit';
import type { Meeting } from '@/lib/data';

type ChatLine = { id: string; authorId: string; body: string; createdAt: string };

export function MeetingRoom({
  meeting,
  currentUserId,
  onLeave,
}: {
  meeting: Meeting;
  currentUserId: string;
  onLeave: () => void;
}) {
  // The participant list used to arrive as a `people` prop from a server
  // component, which meant it was always the static fixture. Reading the
  // directory through the profile store instead means a rename in Settings
  // reaches the video tiles, the people panel and the chat log.
  const resolvedPeople = useDirectory();

  /**
   * The room's connection, owned by a class rather than by component state.
   *
   * `Room` has to be created once and torn down exactly once, and this component
   * re-renders freely. The ref holds the connection; the effect creates it on mount
   * and disposes it on unmount, which is what stops the camera staying on after
   * someone navigates away from the call.
   */
  const connectionRef = useRef<MeetingConnection | null>(null);

  const [status, setStatus] = useState<'connecting' | 'live' | 'simulated' | 'failed'>(
    isVideoConfigured() ? 'connecting' : 'simulated',
  );
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Default off rather than on. These now reflect real published tracks, and
  // starting with the camera shown as "on" while nothing is published is a lie.
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [panel, setPanel] = useState<'people' | 'chat'>('people');
  const [lines, setLines] = useState<ChatLine[]>(meeting.messages);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!isVideoConfigured()) {
      setStatus('simulated');
      return;
    }

    const connection = new MeetingConnection(meeting.id, currentUserId);
    connectionRef.current = connection;

    const unsubscribe = connection.subscribe((snapshot) => {
      setStatus(snapshot.status);
      if (snapshot.error) setMediaError(snapshot.error);
    });

    void connection.connect();

    return () => {
      unsubscribe();
      connectionRef.current = null;
      // Disconnecting stops the camera and leaves the room. Skipping this is the bug
      // that leaves the browser's recording light on after leaving a call.
      void connection.dispose();
    };
  }, [meeting.id, currentUserId]);

  /**
   * Runs a media toggle and adopts the result.
   *
   * State is only updated after the call resolves, so a permission the user declines
   * leaves the button showing "off" rather than optimistically claiming a microphone
   * it never got.
   */
  const toggle = useCallback(async (run: () => Promise<boolean>, set: (value: boolean) => void) => {
    setMediaError(null);
    try {
      set(await run());
    } catch (cause) {
      set(false);
      setMediaError(cause instanceof Error ? cause.message : 'That device could not be changed.');
    }
  }, []);

  const videoConfigured = isVideoConfigured();

  /**
   * Everybody the room should show: the meeting's participants, plus you.
   *
   * The meeting's own list is what someone who has not joined yet still appears
   * under, so the grid does not collapse to a single tile while people are on their
   * way into the call.
   */
  const participants = useMemo(() => {
    const ids = new Set<string>(meeting.participantIds);
    ids.add(currentUserId);
    return [...ids];
  }, [meeting.participantIds, currentUserId]);


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
{participants.map((identity) => {
            const isSelf = identity === currentUserId;
            const person = resolvedPeople.find((p) => p.id === identity);
            return (
              <div
                className="video"
                key={identity}
                data-testid="meeting-tile"
                data-identity={identity}
              >
                <PersonAvatar person={person} size="lg" online={person?.online} />
                <span className="person">
                  {isSelf ? `${person?.name ?? 'You'} (You)` : (person?.name ?? identity)}
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

        {/*
          The room says what it is. A silent fallback would let someone sit in a
          simulated call believing they were on camera, which is the failure mode this
          app has gone out of its way to avoid elsewhere.
        */}
        <p
          className="meeting-status"
          role="status"
          data-testid="room-status"
          data-state={status}
        >
          {status === 'live' && 'Live — your camera and microphone are connected.'}
          {status === 'connecting' && 'Connecting to the call…'}
          {status === 'simulated' &&
            'Video is not configured on this deployment. The room works, without media.'}
          {status === 'failed' && (mediaError ?? 'Could not join the call.')}
        </p>

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
            participants.map((identity) => {
              // `participants` is ids, so anyone outside the directory still renders
              // with their id rather than dropping out of the list entirely.
              const person = resolvedPeople.find((p) => p.id === identity) ?? null;
              return (
                <div className="dark-person" key={identity}>
                  <PersonAvatar person={person} size="sm" online={person?.online} />
                  <span>
                    <strong style={{ display: 'block' }}>
                      {person?.name ?? identity}
                      {identity === currentUserId && ' (You)'}
                    </strong>
                    {person?.jobTitle ?? 'Team member'}
                  </span>
                </div>
              );
            })
          ) : (
            <>
              <div className="meeting-chat">
                {lines.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#99a5ba' }}>No messages yet.</p>
                ) : (
                  lines.map((line) => {
                    const author = resolvedPeople.find((p) => p.id === line.authorId);
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
          onClick={() => toggle(() => connectionRef.current!.setMicrophoneEnabled(!micOn), setMicOn)}
          aria-pressed={micOn}
          // Disabled rather than inert when there is no room: a mic button that does
          // nothing when you press it is worse than one that says why.
          disabled={!videoConfigured || !connectionRef.current}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {micOn ? <Mic size={17} /> : <MicOff size={17} />}
        </button>

        <button
          className={cameraOn ? 'control active' : 'control off'}
          type="button"
          onClick={() => toggle(() => connectionRef.current!.setCameraEnabled(!cameraOn), setCameraOn)}
          aria-pressed={cameraOn}
          disabled={!videoConfigured || !connectionRef.current}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <Video size={17} /> : <VideoOff size={17} />}
        </button>

        <button
          className={sharing ? 'control active' : 'control'}
          type="button"
          onClick={() => toggle(() => connectionRef.current!.setScreenShareEnabled(!sharing), setSharing)}
          aria-pressed={sharing}
          disabled={!videoConfigured || !connectionRef.current}
          aria-label="Share screen"
        >
          <MonitorUp size={17} />
        </button>

        <button
          className={handRaised ? 'control active' : 'control'}
          type="button"
          onClick={() => toggle(() => connectionRef.current!.setHandRaised(!handRaised), setHandRaised)}
          aria-pressed={handRaised}
          disabled={!videoConfigured || !connectionRef.current}
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
