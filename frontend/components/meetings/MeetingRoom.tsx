'use client';

/**
 * The meeting room.
 *
 * ## The grid is the room, not the roster
 *
 * The tiles come from the LiveKit participants in `snapshot.local` and
 * `snapshot.remotes`, not from `meeting.participantIds`. That was the difference
 * between a call and a picture of one: the seeded list renders the same four faces
 * whether or not anyone has connected, and it renders identically whether the camera
 * is on or off. A tile exists now because a track is attached to a `<video>` element,
 * and a participant with no camera shows their avatar instead of a black rectangle.
 *
 * `meeting.participantIds` is still used for one thing -- showing someone who has been
 * invited but has not joined yet. That is roster information, and it is labelled as
 * such rather than being drawn as though they were on camera.
 *
 * ## Tracks are attached to stable elements
 *
 * `Track.attach(element)` mutates a `<video>` node rather than returning media to be
 * rendered by React, so the node must survive across track changes. Each tile keeps
 * its own ref and re-attaches when its publication object changes; reassigning the
 * element would give a black frame on every mute.
 */

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
  Paperclip,
  Settings2,
  Hand,
  Loader2,
} from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useDirectory } from '@/components/profile/ProfileProvider';
import { relativeTime, formatBytes } from '@/lib/format';
import { MeetingConnection, isVideoConfigured } from '@/lib/livekit';
import { RealtimeClient } from '@/lib/realtime';
import { api, type MeetingMessageDto, type FileRow } from '@/lib/api';
import type { Meeting } from '@/lib/data';
import { Track, type Participant, type RemoteParticipant, type LocalParticipant } from 'livekit-client';

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

  /**
   * The whole snapshot, not just its status.
   *
   * The previous version subscribed and read `status` and `error`, dropping `local`
   * and `remotes` on the floor -- which is why the room never drew a video even
   * though the connection was publishing one. Both participant sets are read here.
   */
  const [snapshot, setSnapshot] = useState<{
    status: 'connecting' | 'live' | 'simulated' | 'failed';
    error: string | null;
    local: LocalParticipant | null;
    remotes: RemoteParticipant[];
  }>({
    status: isVideoConfigured() ? 'connecting' : 'simulated',
    error: null,
    local: null,
    remotes: [],
  });

  const [mediaError, setMediaError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [panel, setPanel] = useState<'people' | 'chat' | 'files'>('people');

  const [lines, setLines] = useState<MeetingMessageDto[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isVideoConfigured()) {
      setSnapshot((s) => ({ ...s, status: 'simulated' }));
      return;
    }

    const connection = new MeetingConnection(meeting.id, currentUserId);
    connectionRef.current = connection;

    const unsubscribe = connection.subscribe((next) => {
      setSnapshot({
        status: next.status,
        error: next.error,
        local: next.local,
        remotes: next.remotes,
      });
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
   * Adopt the real published state once the room is live.
   *
   * The camera is enabled on join and the microphone is not, so the buttons would
   * otherwise start out describing a camera that was not yet on. Reading the
   * publications means the labels follow what was actually granted -- including a
   * permission the browser silently refused.
   */
  useEffect(() => {
    const local = snapshot.local;
    if (!local) return;

    setCameraOn(
      local.getTrackPublication(Track.Source.Camera)?.isMuted === false &&
        local.getTrackPublication(Track.Source.Camera) !== undefined,
    );
    setMicOn(
      local.getTrackPublication(Track.Source.Microphone)?.isMuted === false &&
        local.getTrackPublication(Track.Source.Microphone) !== undefined,
    );
    setSharing(local.getTrackPublication(Track.Source.ScreenShare) !== undefined);
  }, [snapshot.local]);

  /* ---------------------------------------------------------------- */
  /* In-call chat: persisted, and live over the socket                  */
  /* ---------------------------------------------------------------- */

  /**
   * Own socket for this room.
   *
   * The chat screen has its own connection to the same endpoint; the room is a
   * separate screen that may be open without it, and lifting the socket to a provider
   * to serve two mutually exclusive screens would be plumbing for no benefit. The
   * client fetches its own short-lived token and reconnects on its own.
   */
  useEffect(() => {
    let cancelled = false;
    const client = new RealtimeClient({
      onFrame: (frame) => {
        const payload = frame.payload as Record<string, unknown>;

        if (frame.type === 'meeting.message.created') {
          if (payload.meetingId !== meeting.id) return;
          const message = payload.message as MeetingMessageDto;
          setLines((current) =>
            current.some((m) => m.id === message.id) ? current : [...current, message],
          );
          return;
        }

        if (frame.type === 'meeting.message.deleted') {
          if (payload.meetingId !== meeting.id) return;
          const id = payload.messageId as string;
          setLines((current) => current.map((m) => (m.id === id ? { ...m, deleted: true, body: '' } : m)));
          return;
        }

        if (frame.type === 'file.created') {
          if (payload.meetingId !== meeting.id) return;
          const file = payload.file as FileRow;
          setFiles((current) => (current.some((f) => f.id === file.id) ? current : [file, ...current]));
        }
      },
    });

    void client.connect().then(() => {
      if (cancelled) return;
      client.subscribeMeetings([meeting.id]);
    });

    return () => {
      cancelled = true;
      client.close();
    };
  }, [meeting.id]);

  /** The transcript, loaded once per room rather than inherited from the list. */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void api
      .meetingMessages(meeting.id, { limit: 50 }, controller.signal)
      .then((response) => {
        if (!cancelled) setLines(response.messages);
      })
      .catch(() => {
        // The room is still usable without its transcript; the panel says so rather
        // than the whole call failing to open.
        if (!cancelled) setLines([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [meeting.id]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void api
      .files({ meetingId: meeting.id })
      .then((response) => {
        if (!cancelled) setFiles(response.files);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [meeting.id]);

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
   * Who is in the room right now.
   *
   * The local participant first, so your own tile leads, then everyone LiveKit
   * reports. Invited-but-absent people are added at the end from the roster, which is
   * the only place a name that is not a connected participant can come from.
   */
  const connected = useMemo(() => {
    const live = new Set<string>(snapshot.remotes.map((p) => p.identity));
    if (snapshot.local) live.add(snapshot.local.identity);

    const waiting = meeting.participantIds.filter(
      (id) => id !== currentUserId && !live.has(id),
    );
    return { live: [...live], waiting };
  }, [snapshot.local, snapshot.remotes, meeting.participantIds, currentUserId]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setDraft('');
    try {
      const response = await api.sendMeetingMessage(meeting.id, body);
      setLines((current) =>
        current.some((m) => m.id === response.message.id) ? current : [...current, response.message],
      );
    } catch {
      // Put the text back rather than losing what they typed. The socket does not
      // echo a failed post, so nothing else would restore it.
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  async function shareFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    event.target.value = '';

    try {
      const response = await api.uploadFile(picked, picked.name, { meetingId: meeting.id });
      setFiles((current) => (current.some((f) => f.id === response.file.id) ? current : [response.file, ...current]));
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : 'That file could not be shared.');
    }
  }

  return (
    <div className="meeting-wrap">
      <div className="meeting-room">
        <div className="video-grid">
          {snapshot.local && (
            <VideoTile
              participant={snapshot.local}
              isSelf
              raised={handRaised}
              name={resolvedPeople.find((p) => p.id === currentUserId)?.name ?? 'You'}
              avatar={resolvedPeople.find((p) => p.id === currentUserId)?.avatarUrl ?? null}
            />
          )}

          {snapshot.remotes.map((participant) => (
            <VideoTile
              key={participant.identity}
              participant={participant}
              raised={MeetingConnection.handRaised(participant)}
              name={resolvedPeople.find((p) => p.id === participant.identity)?.name ?? participant.identity}
              avatar={resolvedPeople.find((p) => p.id === participant.identity)?.avatarUrl ?? null}
            />
          ))}

          {/*
            Nobody connected at all, and nothing published locally: an honest
            placeholder rather than a grid of empty tiles, so an empty room reads as
            "waiting for people" and not as a broken call.
          */}
          {snapshot.remotes.length === 0 && !snapshot.local && (
            <div className="video video-empty" data-testid="room-empty">
              <Users size={30} />
              <span className="person">Waiting for others to join</span>
            </div>
          )}

          {/*
            Invited but not here. Deliberately labelled "invited": rendering an absent
            participant on the video grid is the lie this whole rewrite removed.
          */}
          {connected.waiting.map((identity) => {
            const person = resolvedPeople.find((p) => p.id === identity);
            return (
              <div
                className="video video-waiting"
                key={identity}
                data-testid="meeting-tile"
                data-identity={identity}
                data-connected="false"
              >
                <PersonAvatar person={person ?? null} size="lg" online={false} />
                <span className="video-badge">
                  {person?.name ?? identity} &middot; invited
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
          data-state={snapshot.status}
        >
          {snapshot.status === 'live' && 'Live — your camera and microphone are connected.'}
          {snapshot.status === 'connecting' && 'Connecting to the call…'}
          {snapshot.status === 'simulated' &&
            'Video is not configured on this deployment. The room works, without media.'}
          {snapshot.status === 'failed' && (snapshot.error ?? 'Could not join the call.')}
        </p>

        <aside className="meeting-side">
          <h3>{meeting.title}</h3>
          <p style={{ fontSize: 12, color: '#99a5ba', margin: '0 0 12px' }}>
            {snapshot.remotes.length + (snapshot.local ? 1 : 0)} here &middot;{' '}
            {meeting.participantIds.length} invited
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
            <button
              className={panel === 'files' ? 'active' : ''}
              onClick={() => setPanel('files')}
            >
              Files
            </button>
          </div>

          {panel === 'people' ? (
            <>
              {/* Who is actually connected, straight from the room. */}
              {[snapshot.local?.identity, ...snapshot.remotes.map((p) => p.identity)]
                .filter((id): id is string => Boolean(id))
                .map((identity) => {
                  const person = resolvedPeople.find((p) => p.id === identity) ?? null;
                  return (
                    <div className="dark-person" key={identity}>
                      <PersonAvatar person={person} size="sm" online />
                      <span>
                        <strong style={{ display: 'block' }}>
                          {person?.name ?? identity}
                          {identity === currentUserId && ' (You)'}
                        </strong>
                        {person?.jobTitle ?? 'In the call'}
                      </span>
                    </div>
                  );
                })}

              {connected.waiting.length > 0 && (
                <>
                  <small className="meeting-side-label">Invited, not here yet</small>
                  {connected.waiting.map((identity) => {
                    const person = resolvedPeople.find((p) => p.id === identity) ?? null;
                    return (
                      <div className="dark-person" key={identity}>
                        <PersonAvatar person={person} size="sm" online={false} />
                        <span>
                          <strong style={{ display: 'block' }}>{person?.name ?? identity}</strong>
                          Not connected
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          ) : panel === 'files' ? (
            <>
              <div className="meeting-files">
                {files.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#99a5ba' }}>No files shared yet.</p>
                ) : (
                  files.map((file) => (
                    <a
                      className="meeting-file"
                      key={file.id}
                      href={api.downloadUrl(file.id)}
                      data-testid="meeting-file"
                    >
                      <Paperclip size={13} />
                      <span>{file.name}</span>
                      <small>{formatBytes(file.size)}</small>
                    </a>
                  ))
                )}
              </div>

              <label className="meeting-share">
                <Paperclip size={13} /> Share a file
                <input type="file" onChange={shareFile} hidden />
              </label>
            </>
          ) : (
            <>
              <div className="meeting-chat">
                {lines.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#99a5ba' }}>No messages yet.</p>
                ) : (
                  lines.map((line) => {
                    const author = resolvedPeople.find((p) => p.id === line.authorId);
                    return (
                      <div className="meeting-chat-row" key={line.id} data-testid="meeting-line">
                        <strong>{author?.name ?? 'Unknown'}</strong>
                        <small>{line.deleted ? 'Message deleted' : line.body}</small>
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
                <button type="submit" disabled={!draft.trim() || sending} aria-label="Send">
                  {sending ? <Loader2 size={15} /> : <MessageSquare size={15} />}
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
          onClick={() => {
            const connection = connectionRef.current;
            if (!connection) return;
            void toggle(() => connection.setMicrophoneEnabled(!micOn), setMicOn);
          }}
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
          onClick={() => {
            const connection = connectionRef.current;
            if (!connection) return;
            void toggle(() => connection.setCameraEnabled(!cameraOn), setCameraOn);
          }}
          aria-pressed={cameraOn}
          disabled={!videoConfigured || !connectionRef.current}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <Video size={17} /> : <VideoOff size={17} />}
        </button>

        <button
          className={sharing ? 'control active' : 'control'}
          type="button"
          onClick={() => {
            const connection = connectionRef.current;
            if (!connection) return;
            void toggle(() => connection.setScreenShareEnabled(!sharing), setSharing);
          }}
          aria-pressed={sharing}
          disabled={!videoConfigured || !connectionRef.current}
          aria-label="Share screen"
        >
          <MonitorUp size={17} />
        </button>

        <button
          className={handRaised ? 'control active' : 'control'}
          type="button"
          onClick={() => {
            const connection = connectionRef.current;
            if (!connection) return;
            void toggle(() => connection.setHandRaised(!handRaised), setHandRaised);
          }}
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

        <button
          className={panel === 'files' ? 'control active' : 'control'}
          type="button"
          onClick={() => setPanel('files')}
          aria-label="Show meeting files"
        >
          <Paperclip size={17} />
        </button>

        <button className="control" type="button" disabled aria-label="Device settings">
          <Settings2 size={17} />
        </button>

        <button className="control leave" type="button" onClick={onLeave} aria-label="Leave meeting">
          <PhoneOff size={17} />
        </button>
      </div>

      {mediaError && (
        <p className="meeting-error" role="alert">
          {mediaError}
        </p>
      )}
    </div>
  );
}

/**
 * One participant's tile.
 *
 * Attaches the camera track to a `<video>` the component owns, and falls back to the
 * avatar when there is no camera publication or it is muted -- so a person with their
 * camera off is recognisable rather than being a black square with a name on it.
 *
 * The effect keys on the *publication*, not the track: a track object can be replaced
 * when a track is republished, and keying on the track would tear down the element and
 * blank the tile for a frame.
 */
function VideoTile({
  participant,
  name,
  avatar,
  isSelf = false,
  raised = false,
}: {
  participant: Participant;
  name: string;
  avatar: string | null;
  isSelf?: boolean;
  /**
   * Passed in rather than read from the participant here.
   *
   * A hand raise lives in participant metadata, which is an opaque string that only
   * means something once parsed -- and the own-participant answer is component state,
   * not metadata to be read back. Computing it in the parent keeps both cases in one
   * place instead of an `instanceof` branch per tile.
   */
  raised?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [muted, setMuted] = useState(true);

  const cameraPublication = participant.getTrackPublication(Track.Source.Camera);
  const microphonePublication = participant.getTrackPublication(Track.Source.Microphone);
  const screenPublication = participant.getTrackPublication(Track.Source.ScreenShare);

  /**
   * The tile's state is read from the publications, then re-read whenever a
   * publication's muted flag changes. LiveKit mutates `publication.isMuted` in place
   * when someone mutes, so nothing about the identity changes -- without listening to
   * `TrackMuted` the overlay would keep claiming someone is on camera after they
   * turned it off.
   */
  useEffect(() => {
    const sync = () => {
      setHasVideo(Boolean(cameraPublication && !cameraPublication.isMuted));
      setMuted(microphonePublication ? microphonePublication.isMuted : true);
    };

    sync();
    cameraPublication?.on('muted', sync);
    cameraPublication?.on('unmuted', sync);
    microphonePublication?.on('muted', sync);
    microphonePublication?.on('unmuted', sync);

    return () => {
      cameraPublication?.off('muted', sync);
      cameraPublication?.off('unmuted', sync);
      microphonePublication?.off('muted', sync);
      microphonePublication?.off('unmuted', sync);
    };
  }, [cameraPublication, microphonePublication]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    const source = screenPublication ?? cameraPublication;
    const track = source?.track;

    if (!track || track.kind !== Track.Kind.Video) {
      setHasVideo(false);
      return;
    }

    // `attach` returns the element it was given, so the same node keeps its srcObject
    // across a mute instead of being replaced.
    track.attach(element);
    // Autoplay has to be muted to be allowed, and the local tile would otherwise play
    // your own microphone back at you.
    element.muted = isSelf;
    void element.play().catch(() => undefined);

    return () => {
      track.detach(element);
    };
  }, [cameraPublication, screenPublication, isSelf]);

  return (
    <div
      className="video"
      data-testid="meeting-tile"
      data-identity={participant.identity}
      data-self={isSelf ? 'true' : 'false'}
      data-connected="true"
    >
      <video
        ref={videoRef}
        className={`video-feed${hasVideo ? '' : ' is-hidden'}`}
        autoPlay
        playsInline
        muted={isSelf}
        data-testid="meeting-video"
        data-has-video={hasVideo ? 'true' : 'false'}
      />
      {!hasVideo && (
        <div className="video-fallback">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="video-avatar" src={avatar} alt="" />
          ) : (
            <PersonAvatar
              person={{ id: participant.identity, name, avatarUrl: avatar, online: true } as never}
              size="lg"
              online
            />
          )}
        </div>
      )}

      <span className="video-badge">
        {name}
        {isSelf && ' (You)'}
        {raised && <Hand size={11} style={{ marginLeft: 4 }} />}
        {muted && <MicOff size={11} style={{ marginLeft: 4 }} />}
      </span>
    </div>
  );
}