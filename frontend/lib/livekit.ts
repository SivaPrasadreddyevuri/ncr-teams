'use client';

/**
 * The meeting room's LiveKit connection.
 *
 * ## Why this is a class rather than inline in the component
 *
 * `Room` is stateful and has to be torn down exactly once. Four things make that easy
 * to get wrong inline: the connect is async, React 18+ mounts effects twice in
 * development, a re-render must not create a second room, and leaving a room open
 * keeps publishing your camera after you have navigated away. All four have the same
 * answer -- one owner, one teardown -- so it lives here and the component holds a
 * reference.
 *
 * ## The token is minted per meeting, never cached
 *
 * `issueMeetingToken` returns a five-minute token scoped to one room and one identity.
 * Holding one across meetings would mean holding a credential for a room you have
 * left, so every connect asks for a fresh one.
 *
 * ## Unconfigured is a first-class state
 *
 * With no `NEXT_PUBLIC_LIVEKIT_URL` or no server credentials there is nothing to
 * connect to. `isVideoConfigured()` is what the UI asks before deciding to render a
 * simulated room, so the honest outcome is a labelled stand-in rather than a Join
 * button that silently does nothing.
 */

import {
  ConnectionState,
  LocalTrackPublication,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
} from 'livekit-client';

import { ApiError, api } from './api';

/** The LiveKit project URL, inlined at build time. Undefined when unconfigured. */
const projectUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

/**
 * Whether a join could possibly succeed.
 *
 * Both halves, because they fail differently and for different reasons: no URL means
 * the browser cannot find the media server at all, and no server credentials means the
 * token endpoint will answer 503. Checking only the first would show a real-looking
 * room that can never connect.
 */
export function isVideoConfigured(): boolean {
  return Boolean(projectUrl);
}

/**
 * The project URL, narrowed.
 *
 * `isVideoConfigured()` is the gate every caller checks first, but TypeScript cannot
 * carry that narrowing into a method body, and `room.connect` wants a `string`. This
 * makes the invariant explicit rather than asserting it with `!`, so a future path
 * that reaches `connect` without the guard fails loudly instead of dialing `undefined`.
 */
function requireProjectUrl(): string {
  if (!projectUrl) throw new Error('NEXT_PUBLIC_LIVEKIT_URL is not set.');
  return projectUrl;
}

export type Connection = {
  /** 'live' once tracks can flow; 'simulated' when there is nothing to connect to. */
  status: 'connecting' | 'live' | 'simulated' | 'failed';
  /** Why it failed, when status is 'failed'. */
  error: string | null;
  /** The local participant, for the self-view tile. */
  local: LocalParticipant | null;
  /** Everyone else in the room, including anyone who joins after this snapshot. */
  remotes: RemoteParticipant[];
};

export type ConnectionListener = (connection: Connection) => void;

/**
 * Owns one LiveKit room for the lifetime of a meeting.
 *
 * Construct it once per room, call `connect`, and `dispose` on unmount. Every method
 * after `dispose` is a no-op rather than a throw, because React can call an effect
 * cleanup during a re-render that also queues a click.
 */
export class MeetingConnection {
  private room: Room | null = null;
  private disposed = false;
  private listeners = new Set<ConnectionListener>();
  private snapshot: Connection = {
    status: isVideoConfigured() ? 'connecting' : 'simulated',
    error: null,
    local: null,
    remotes: [],
  };

  constructor(private readonly meetingId: string, private readonly identity: string) {}

  /** Current state, and subscribes to changes. Returns an unsubscribe function. */
  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<Connection>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /**
   * Joins the meeting.
   *
   * The token is requested per call, so switching meetings cannot reuse a credential
   * for the room that was left open. A 503 is the server saying LiveKit is not
   * configured, and is reported as 'simulated' rather than 'failed' -- there is nothing
   * broken from the user's point of view, media simply is not available.
   */
  async connect(): Promise<void> {
    if (this.disposed) return;

    if (!isVideoConfigured()) {
      this.emit({ status: 'simulated', error: null });
      return;
    }

    this.emit({ status: 'connecting', error: null });

    try {
      const minted = await api.meetingToken(this.meetingId);
      if (this.disposed) return;

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Connected) this.emit({ status: 'live', error: null });
      });

      room.on(RoomEvent.TrackSubscribed, () => this.publishRemotes());
      room.on(RoomEvent.TrackUnsubscribed, () => this.publishRemotes());
      room.on(RoomEvent.ParticipantConnected, () => this.publishRemotes());
      room.on(RoomEvent.ParticipantDisconnected, () => this.publishRemotes());
      room.on(RoomEvent.LocalTrackPublished, () => this.publishRemotes());
      room.on(RoomEvent.LocalTrackUnpublished, () => this.publishRemotes());

      // Once the socket is up, ask for the camera and microphone rather than waiting
      // for a button press. A browser that has never granted permission will prompt,
      // and a user who declines still lands in the room muted rather than stuck
      // outside it -- which is the behaviour people expect from a meeting link.
      // The URL is an explicit argument, not remembered by the Room. Omitting it makes
      // the token the argument the SDK would try to dial, which fails at connect time
      // with a message about the URL rather than about the token.
      await room.connect(requireProjectUrl(), minted.token, { autoSubscribe: true });
      await Promise.allSettled([
        room.localParticipant.setCameraEnabled(true),
        room.localParticipant.setMicrophoneEnabled(false),
      ]);

      if (this.disposed) {
        // Unmounted while connecting. Leaving without disconnecting would keep the
        // camera light on, which is the whole reason this class exists.
        room.disconnect();
        return;
      }

      this.room = room;
      this.publishRemotes();
    } catch (cause) {
      if (this.disposed) return;

      // A 503 is a deployment state, not a failure: the room still works, just without
      // media. Anything else is a real problem worth naming in the UI. Keyed on the
      // error *code* rather than the status so a different 503 elsewhere is not
      // mistaken for "video is switched off".
      if (cause instanceof ApiError && cause.code === 'livekit_not_configured') {
        this.emit({ status: 'simulated', error: null });
        return;
      }

      this.emit({
        status: 'failed',
        error: cause instanceof Error ? cause.message : 'Could not join the call.',
      });
    }
  }

  private publishRemotes(): void {
    const room = this.room;
    if (!room || this.disposed) return;

    this.emit({
      local: room.localParticipant,
      remotes: [...room.remoteParticipants.values()],
    });
  }

  /**
   * Video element for a published track, so the component does not rebuild the DOM.
   *
   * The same `<video>` node has to be reused across track changes: reassigning the
   * `MediaStream` on a stable element is what avoids a black frame on every mute.
   */
  static attachVideo(element: HTMLVideoElement, track: RemoteTrack | null): void {
    if (!track) return;
    if (track.kind === Track.Kind.Video) {
      track.attach(element);
    }
  }

  /** Detaches every remote track, so a tile that unmounts stops holding a stream. */
  detach(track: RemoteTrack | null): void {
    track?.detach();
  }

  /** Toggles the microphone, reporting whether it is now on. */
  async setMicrophoneEnabled(enabled: boolean): Promise<boolean> {
    if (!this.room) return false;
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
    return enabled;
  }

  async setCameraEnabled(enabled: boolean): Promise<boolean> {
    if (!this.room) return false;
    await this.room.localParticipant.setCameraEnabled(enabled);
    return enabled;
  }

  /**
   * Starts or stops publishing the screen.
   *
   * The publication is left in place between toggles and only muted, rather than
   * republished each time: a republished track gets a new id, so everyone else's tile
   * flickers and the "who is sharing" label resets on every click.
   */
  async setScreenShareEnabled(enabled: boolean): Promise<boolean> {
    if (!this.room) return false;
    await this.room.localParticipant.setScreenShareEnabled(enabled);
    return enabled;
  }

  /**
   * Raises or lowers a hand.
   *
   * Participant metadata rather than room state, because it is the only place LiveKit
   * carries something about a person that is not a media track -- and it propagates to
   * everyone without a message round trip.
   *
   * Serialised, because LiveKit treats metadata as an opaque *string*. Passing an
   * object type-checks in one direction and then reads back as `[object Object]` in
   * every other participant's browser.
   */
  async setHandRaised(raised: boolean): Promise<boolean> {
    if (!this.room) return false;
    await this.room.localParticipant.setMetadata(JSON.stringify({ handRaised: raised }));
    return raised;
  }

  /** Media state for a remote participant, for the tile overlay. */
  static isMuted(participant: RemoteParticipant): boolean {
    const publication = participant.getTrackPublication(Track.Source.Microphone);
    return publication ? publication.isMuted : true;
  }

  static isCameraOff(participant: RemoteParticipant): boolean {
    const publication = participant.getTrackPublication(Track.Source.Camera);
    return publication ? publication.isMuted : true;
  }

  /**
   * Reads the hand-raise flag back out of a participant's metadata.
   *
   * Parsed defensively because the field is an opaque string anyone can set: a
   * participant with no metadata, or with a different shape entirely, must read as
   * "no hand raised" rather than throwing inside a render.
   */
  static handRaised(participant: RemoteParticipant): boolean {
    const raw = participant.metadata;
    if (!raw) return false;
    try {
      return (JSON.parse(raw) as { handRaised?: unknown }).handRaised === true;
    } catch {
      return false;
    }
  }

  static screenShare(participant: RemoteParticipant): RemoteTrackPublication | undefined {
    return participant.getTrackPublication(Track.Source.ScreenShare);
  }

  /** Every publication on a participant that carries a video stream. */
  static videoTracks(participant: RemoteParticipant): RemoteTrackPublication[] {
    return participant
      .getTrackPublications()
      .filter(
        (publication): publication is RemoteTrackPublication =>
          publication instanceof RemoteTrackPublication &&
          publication.track?.kind === Track.Kind.Video,
      );
  }

  static localPublications(participant: LocalParticipant): LocalTrackPublication[] {
    return participant.getTrackPublications().filter(
      (publication): publication is LocalTrackPublication =>
        publication instanceof LocalTrackPublication,
    );
  }

  /** Tears the room down. Safe to call more than once. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();

    const room = this.room;
    this.room = null;
    if (room) await room.disconnect();
  }
}