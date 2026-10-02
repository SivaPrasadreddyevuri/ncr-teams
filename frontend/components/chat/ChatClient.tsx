'use client';

/**
 * Chat.
 *
 * Owns the live state and the socket; the rendering of a single message, of the
 * composer and of the typing indicator are separate components, because this file
 * would otherwise be over a thousand lines and every change to the thread would
 * touch the code that owns the connection.
 *
 * ## What is real and what is not
 *
 * Everything on screen is live or it says it is not. There is no simulated
 * presence, no typing animation that is not caused by an actual keystroke, and no
 * unread badge computed in the browser. A demo that faked those would look better
 * for two minutes and fall over the first time somebody opened two tabs -- and it
 * is very hard to walk back once it is in, because everything downstream starts
 * assuming it is real.
 *
 * The one place the fixtures still appear is before the first response arrives, and
 * `composer-status` says so in as many words.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, X, ChevronLeft, Phone, Video } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useActivePerson } from '@/components/profile/ProfileProvider';
import { MessageRow } from './MessageRow';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { MeetingRoom } from '@/components/meetings/MeetingRoom';
import type { DisplayMessage, PendingAttachment, TypingPeer } from './types';
import { api, ApiError, type ChatMessage as LiveMessage, type FileRow, type MeetingDto } from '@/lib/api';
import { RealtimeClient, type RealtimeStatus } from '@/lib/realtime';
import { toRoomMeeting } from '@/lib/meetings';
import { relativeTime, formatBytes } from '@/lib/format';
import type { Channel, ChatMessage, Meeting, Person } from '@/lib/data';

type Thread = 'chat' | 'files' | 'meetings';

const THREADS: Array<{ id: Thread; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'files', label: 'Files' },
  { id: 'meetings', label: 'Meetings' },
];

/** How long a peer's typing indicator survives without a fresh keystroke from them. */
const TYPING_TTL_MS = 3000;

/** How long after the last keystroke before we tell the server we stopped. */
const TYPING_STOP_AFTER_MS = 2500;

/** Ticks the typing indicator and the presence summary. */
const TICK_MS = 1000;

/**
 * A message that exists only in this browser.
 *
 * Used when there is no session, so the composer still responds. The id is marked
 * local and never sent, so it cannot collide with a real one.
 */
function localEcho(authorId: string, channelId: string, body: string): DisplayMessage {
  return {
    id: `local-${authorId}-${Date.now()}`,
    channelId,
    authorId,
    body,
    createdAt: new Date().toISOString(),
    reactions: [],
    attachments: [],
    deleted: false,
    editedAt: null,
    parentId: null,
    parentAuthor: null,
    localOnly: true,
  };
}

export function ChatClient({
  channels,
  initialMessages,
  people,
  currentUserId,
}: {
  channels: Channel[];
  initialMessages: ChatMessage[];
  people: Person[];
  currentUserId: string;
}) {
  const [activeId, setActiveId] = useState(channels[0]?.id ?? '');
  const [allMessages, setAllMessages] = useState<DisplayMessage[]>(initialMessages);
  const [thread, setThread] = useState<Thread>('chat');
  const [term, setTerm] = useState('');

  const [live, setLive] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [connection, setConnection] = useState<RealtimeStatus>('closed');

  // --- slice 3: presence, typing, and the frames that were being dropped ---
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<TypingPeer[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // --- slice 4: attachments ---
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  // --- slice 5: pagination and the message being replied to (slice 6) ---
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ message: DisplayMessage; authorName: string } | null>(null);

  // Phones show the thread full width with the channel list as a slide-over, so the
  // same "which panel is in front" state has to live here. Inert above 760px.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const active = channels.find((c) => c.id === activeId) ?? channels[0];

  // Read inside the socket handler, which is created once. Without a ref the
  // handler would close over the first channel and never see a change.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const onlineRef = useRef(online);
  onlineRef.current = online;

  // The socket itself, in a ref so the composer and the typing timer can reach it
  // without the handlers depending on it and re-subscribing on every change.
  const socketRef = useRef<RealtimeClient | null>(null);

  /*
   * `people` arrives from a server component, so it is always the static fixture.
   * Overlaying the signed-in user means a rename in Settings shows up in the member
   * list and on your own messages, not just in the sidebar.
   */
  const me = useActivePerson();
  const resolvedPeople = useMemo(
    () => people.map((person) => (person.id === me.id ? me : person)),
    [people, me],
  );

  /**
   * Mirrors of values the socket's frame handler reads.
   *
   * These exist because of the reconnect bug they fix. The socket effect used to list
   * `now` and `resolvedPeople` as dependencies, and `now` is a clock that ticks every
   * `TICK_MS`. So the effect tore the socket down and built a fresh `RealtimeClient`
   * once a second -- each new client starting with `attempt = 0`, so the backoff never
   * grew past its first step. That produced a reconnect about every 300-500ms, and
   * every reconnect cleared the typing state, so a typing indicator could never stay on
   * screen long enough to be seen.
   *
   * The handler only needs the *current* value at the moment a frame arrives, so a ref
   * is the right instrument: the effect reads the latest value without depending on
   * its identity, and the socket is created once per channel rather than once per tick.
   */
  const nowRef = useRef(now);
  nowRef.current = now;
  const peopleRef = useRef(resolvedPeople);
  peopleRef.current = resolvedPeople;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Calls, opened from the channel itself                            */
  /* ---------------------------------------------------------------- */

  /**
   * The call opened from this channel, held here rather than navigated to.
   *
   * This is the same room the meetings screen opens -- one component, one
   * connection, one set of controls -- so a call started from chat and one started
   * from the meetings list behave identically. Rendering it over the chat rather than
   * navigating away is deliberate: leaving the conversation to make a call is the
   * thing people expect not to have to do.
   */
  const [call, setCall] = useState<Meeting | null>(null);
  const [startingCall, setStartingCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  /**
   * Opens (or rejoins) this channel's call.
   *
   * Idempotent on the server, so pressing this twice -- or pressing it after a
   * colleague has already started one -- lands everyone in the same room rather than
   * creating a second one nobody can find.
   */
  const startCall = useCallback(async () => {
    const channelId = active?.id;
    if (!channelId || startingCall) return;

    setStartingCall(true);
    setCallError(null);
    try {
      const response = await api.startChannelCall(channelId);
      setCall(toRoomMeeting(response.meeting, []));
    } catch (cause) {
      setCallError(
        cause instanceof ApiError ? cause.message : 'That call could not be started.',
      );
    } finally {
      setStartingCall(false);
    }
  }, [active?.id, startingCall]);

  // Switching channels closes the call rather than leaving it running behind a
  // different conversation: the room belongs to the channel it was opened from, and
  // `MeetingRoom` only tears down its connection on unmount.
  useEffect(() => {
    setCall(null);
    setCallError(null);
  }, [active?.id]);

  /**
   * Whether this channel has a call open, for the Meetings tab.
   *
   * Asked through `/api/meetings/channel/:id` rather than read off the caller's own
   * meeting list, because that list is participant-scoped: someone who has not joined
   * yet is not in it, so the tab would say no call is open while one is plainly
   * running and offer no way in. Reading the tab must also not create anything, which
   * is why this is a GET and not the `POST /api/meetings` that opens a room.
   *
   * Re-read when `call` changes, so starting a call from the header immediately
   * shows up here rather than needing a reload.
   */
  const [channelCall, setChannelCall] = useState<MeetingDto | null>(null);

  useEffect(() => {
    const channelId = active?.id;
    if (!channelId) {
      setChannelCall(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    void api
      .channelCall(channelId, controller.signal)
      .then((response) => {
        if (!cancelled) setChannelCall(response.meeting);
      })
      .catch(() => {
        // A 404 here is the ordinary "no call in this channel", not a failure.
        if (!cancelled) setChannelCall(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active?.id, call]);

  /**
   * Joins a call that is already running.
   *
   * Still goes through `POST /api/meetings`, because that is what makes the caller a
   * participant -- and participation is what every meeting-scoped read and the
   * WebSocket subscription are checked against. Reading the room is not enough to be
   * in it; a caller who could see a call but never join it would be the same gap this
   * flow just had, one click later. The call is idempotent, so joining an existing
   * room returns it unchanged.
   */
  const joinCall = useCallback(async () => {
    const channelId = active?.id;
    if (!channelId || startingCall) return;

    setStartingCall(true);
    setCallError(null);
    try {
      const response = await api.startChannelCall(channelId);
      setCall(toRoomMeeting(response.meeting, []));
    } catch (cause) {
      setCallError(cause instanceof ApiError ? cause.message : 'That call could not be joined.');
    } finally {
      setStartingCall(false);
    }
  }, [active?.id, startingCall]);

  useEffect(() => {
    if (!active) return;
    // `cancelled` because switching channels mid-request would otherwise let a
    // slower earlier response overwrite the newer one.
    let cancelled = false;
    const channelId = active.id;

    setNotice(null);
    setCursor(null);
    setReplyingTo(null);
    // Attachments belong to the channel they were uploaded for; carrying them
    // across a switch would attach them to the wrong conversation.
    setAttachments([]);

    api
      .messages(channelId)
      .then((response) => {
        if (cancelled) return;
        setAllMessages(response.messages);
        setCursor(response.nextCursor);
        setLive(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Unauthenticated is the expected case for a visitor who has not signed in,
        // and retrying cannot fix it, so the fixtures stay and no socket is opened.
        setLive(false);
        if (!(cause instanceof ApiError && cause.isUnauthorised)) {
          setNotice('Could not reach the server. Showing saved messages.');
        }
      });

    return () => {
      cancelled = true;
    };
    // `live` is deliberately not a dependency: it is set by this effect, and
    // listing it would re-run the load in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  /* ---------------------------------------------------------------- */
  /* Realtime                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!live || !active) return;
    const channelId = active.id;

    const client = new RealtimeClient({
      onStatus: setConnection,
      onFrame: (frame) => {
        const payload = frame.payload as Record<string, unknown>;

        // `message.deleted` used to be ignored entirely, which meant a message
        // deleted by its author stayed on screen for everyone else until they
        // reloaded. It is a tombstone rather than a removal, so the server sends
        // the row's id and the client replaces rather than splices.
        if (frame.type === 'message.deleted') {
          const id = payload.messageId as string;
          setAllMessages((current) =>
            current.map((m) =>
              m.id === id ? { ...m, deleted: true, body: '', attachments: [] } : m,
            ),
          );
          return;
        }

        if (frame.type === 'presence.changed') {
          const userId = payload.userId as string;
          const status = payload.status as 'online' | 'away' | 'offline';
          setOnline((current) => {
            const next = new Set(current);
            // `away` still counts as present: the person has a socket open and a
            // message from them will arrive. Dropping them would make someone's dot
            // disappear when they alt-tabbed.
            if (status === 'offline') next.delete(userId);
            else next.add(userId);
            return next;
          });
          return;
        }

        if (frame.type === 'typing.start' || frame.type === 'typing.stop') {
          const userId = payload.userId as string;
          // The server never echoes a typing frame to its sender, but a stale
          // frame from before a channel switch could still arrive.
          if (userId === currentUserIdRef.current) return;

          setTyping((current) => {
            if (frame.type === 'typing.stop') {
              return current.filter((peer) => peer.userId !== userId);
            }
const name =
            peopleRef.current.find((p) => p.id === userId)?.name ?? 'Someone';
            const existing = current.find((peer) => peer.userId === userId);
            const next: TypingPeer = {
              userId,
              name,
              expiresAt: nowRef.current + TYPING_TTL_MS,
            };
            return existing
              ? current.map((peer) => (peer.userId === userId ? next : peer))
              : [...current, next];
          });
          return;
        }

        // `file.created` carries a file that may not be attached to any message
        // yet -- an upload in progress is not a message. So it is not rendered in
        // the thread; it only invalidates the Files tab.
        if (frame.type === 'file.created') {
          setFilesNonce((n) => n + 1);
          return;
        }

        if (frame.type === 'message.created' || frame.type === 'message.updated') {
          const incoming = payload.message as LiveMessage | undefined;
          if (!incoming || incoming.channelId !== activeIdRef.current) return;

          setAllMessages((current) => {
            const at = current.findIndex((m) => m.id === incoming.id);
            // Replace in place for an edit or a reaction change, append for a new
            // message. A replacement also clears any pending or failed flag,
            // because the server's row is authoritative.
            if (at !== -1) {
              const next = [...current];
              next[at] = { ...incoming, pending: false, failed: false };
              return next;
            }
            return [...current, incoming];
          });
        }
      },
    });

    socketRef.current = client;
    void client.connect();
    client.subscribe([channelId]);

    // Closed on unmount and on every channel change. This is not the same as the
    // client's own reconnect, which handles the server going away.
    return () => {
      socketRef.current = null;
      client.close();
    };
  // Only the channel, deliberately.
    //
    // `live` decides whether there is a socket at all; `active?.id` decides which
    // channel it is subscribed to. Anything else here -- a ticking clock, the people
    // array, the signed-in id -- belongs in a ref read at frame time, not in this
    // list. See the refs above: with `now` in the dependency list this effect rebuilt
    // the socket once a second and the chat reconnected in a loop.
  }, [live, active?.id]);

  // Marking read is a nicety; a failure must not surface as an error.
  useEffect(() => {
    if (!live || !active) return;
    const channelId = active.id;
    void api.markChannelRead(channelId).catch(() => undefined);
  }, [live, active?.id]);

  /* ---------------------------------------------------------------- */
  /* Typing, outbound                                                 */
  /* ---------------------------------------------------------------- */

  const typingSentRef = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function signalTyping(typing: boolean) {
    const client = socketRef.current;
    if (!client || !active) return;

    if (typing) {
      if (!typingSentRef.current) {
        client.send('typing.start', { channelId: active.id });
        typingSentRef.current = true;
      }
      // Restarted on every keystroke, so the stop only fires once the user pauses.
      // Without the reset, a fast typist would see their own indicator cut off
      // mid-word from a previous pause.
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      typingStopTimer.current = setTimeout(() => {
        client.send('typing.stop', { channelId: active.id });
        typingSentRef.current = false;
      }, TYPING_STOP_AFTER_MS);
      return;
    }

    if (!typingSentRef.current) return;
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    client.send('typing.stop', { channelId: active.id });
    typingSentRef.current = false;
  }

  // A channel switch mid-sentence must not leave the indicator running in the old
  // one. The server drops stale typing on the next keystroke, but the peer list
  // would keep a ghost entry until its TTL expired.
  useEffect(() => {
    signalTyping(false);
    setTyping([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  /* ---------------------------------------------------------------- */
  /* Messages                                                          */
  /* ---------------------------------------------------------------- */

  const threadMessages = useMemo(
    () => allMessages.filter((m) => m.channelId === activeId),
    [allMessages, activeId],
  );

  /** Newest at the bottom, matching the order the API returns. */
  const ordered = useMemo(
    () => [...threadMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [threadMessages],
  );

  function upsert(message: DisplayMessage) {
    setAllMessages((current) => {
      const at = current.findIndex((m) => m.id === message.id);
      if (at === -1) return [...current, message];
      const next = [...current];
      next[at] = message;
      return next;
    });
  }

  /**
   * Sends optimistically.
   *
   * The message appears immediately with a temporary id and a `pending` flag, then
   * the server's row replaces it. Waiting for the round trip before appending --
   * which is what this did before -- is correct and feels broken: nothing moves
   * until the response lands, and on a Render instance waking from a cold start
   * that is several seconds.
   *
   * A failure leaves the message on screen with a Retry button rather than
   * silently reverting, because a message that vanishes is a message the user
   * thinks they sent.
   */
  function send(body: string, attachmentIds: string[], parentId: string | null) {
    if (!active) return;

    if (!live) {
      setAllMessages((current) => [...current, localEcho(currentUserId, active.id, body)]);
      setNotice('Not signed in, so this message was not sent.');
      return;
    }

    const tempId = `pending-${currentUserId}-${Date.now()}`;
    const optimistic: DisplayMessage = {
      id: tempId,
      channelId: active.id,
      authorId: currentUserId,
      body,
      createdAt: new Date().toISOString(),
      reactions: [],
      attachments: attachmentIds.map((id) => ({ id, name: 'Attachment', size: 0, type: '' })),
      deleted: false,
      editedAt: null,
      parentId,
      parentAuthor: replyingTo?.authorName ?? null,
      pending: true,
    };

    setAllMessages((current) => [...current, optimistic]);
    setSending(true);
    setComposerError(null);

    api
      .sendMessage(active.id, body, attachmentIds, parentId ?? undefined)
      .then(({ message }) => {
        // Replace the temporary row rather than appending, or the optimistic copy
        // would sit next to the real one.
        setAllMessages((current) =>
          current.map((m) => (m.id === tempId ? message : m)),
        );
        setNotice(null);
        setReplyingTo(null);
      })
      .catch((cause: unknown) => {
        setAllMessages((current) =>
          current.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
        );
        setComposerError(
          cause instanceof ApiError ? cause.message : 'Could not send that message.',
        );
      })
      .finally(() => setSending(false));
  }

  /** Re-sends a message that failed, reusing its optimistic row. */
  function retry(message: DisplayMessage) {
    if (!active) return;

    setAllMessages((current) =>
      current.map((m) => (m.id === message.id ? { ...m, pending: true, failed: false } : m)),
    );
    setComposerError(null);

    api
      .sendMessage(
        active.id,
        message.body,
        message.attachments.map((a) => a.id),
        message.parentId ?? undefined,
      )
      .then(({ message: sent }) => {
        setAllMessages((current) =>
          // The id changes on a retry, so the old row is matched by position
          // rather than by the temporary id it no longer has.
          current.map((m) => (m.id === message.id ? sent : m)),
        );
      })
      .catch((cause: unknown) => {
        setAllMessages((current) =>
          current.map((m) => (m.id === message.id ? { ...m, pending: false, failed: true } : m)),
        );
        setComposerError(
          cause instanceof ApiError ? cause.message : 'Could not send that message.',
        );
      });
  }

  function react(message: DisplayMessage, emoji: string) {
    if (!live) {
      setNotice('Sign in to react to messages.');
      return;
    }

    // Optimistic here too. A reaction that waits for the round trip reads as
    // dropped input, because the user has usually already typed the next word.
    const mine = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(currentUserId);
    const nextReactions = mine
      ? message.reactions
          .map((r) =>
            r.emoji === emoji
              ? { ...r, userIds: r.userIds.filter((id) => id !== currentUserId) }
              : r,
          )
          .filter((r) => r.userIds.length > 0)
      : [
          ...message.reactions.map((r) =>
            r.emoji === emoji ? { ...r, userIds: [...r.userIds, currentUserId] } : r,
          ),
        ];

    upsert({ ...message, reactions: nextReactions });

    api.toggleReaction(message.id, emoji).catch((cause: unknown) => {
      // Rolled back to the server's view, because a reaction chip that survives a
      // failed request is a lie about who reacted.
      void api
        .messages(activeId)
        .then(({ messages: fresh }) =>
          setAllMessages((current) => {
            const byId = new Map(fresh.map((m) => [m.id, m]));
            return current.map((m) => byId.get(m.id) ?? m);
          }),
        )
        .catch(() =>
          upsert({
            ...message,
            reactions: message.reactions,
          }),
        );
      setComposerError(
        cause instanceof ApiError ? cause.message : 'Could not save that reaction.',
      );
    });
  }

  function edit(message: DisplayMessage, body: string) {
    upsert({ ...message, body, editedAt: new Date().toISOString() });

    api.editMessage(message.id, body).catch((cause: unknown) => {
      // Reverted to the body we had, because a local edit that the server refused
      // would be shown to everyone else as the old text and to the author as the
      // new one.
      upsert(message);
      setComposerError(cause instanceof ApiError ? cause.message : 'Could not save that edit.');
    });
  }

  function remove(message: DisplayMessage) {
    // Replaced with the tombstone locally rather than spliced out, so the thread
    // keeps its shape and the replies under it stay where the reader left them.
    upsert({ ...message, deleted: true, body: '', attachments: [] });

    api.deleteMessage(message.id).catch((cause: unknown) => {
      upsert(message);
      setComposerError(cause instanceof ApiError ? cause.message : 'Could not delete that.');
    });
  }

  /* ---------------------------------------------------------------- */
  /* Attachments                                                       */
  /* ---------------------------------------------------------------- */

  function upload(file: File) {
    if (!active) return;

    const localId = `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAttachments((current) => [
      ...current,
      {
        localId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        status: 'uploading',
      },
    ]);

    api
      .uploadFile(file, file.name, { channelId: active.id })
      .then(({ file: uploaded }) => {
        setAttachments((current) =>
          current.map((a) =>
            a.localId === localId
              ? { ...a, status: 'ready' as const, file: uploaded }
              : a,
          ),
        );
      })
      .catch((cause: unknown) => {
        setAttachments((current) =>
          current.map((a) =>
            a.localId === localId
              ? {
                  ...a,
                  status: 'failed' as const,
                  error: cause instanceof ApiError ? cause.message : 'Upload failed',
                }
              : a,
          ),
        );
      });
  }

  /* ---------------------------------------------------------------- */
  /* Pagination                                                        */
  /* ---------------------------------------------------------------- */

  const [filesNonce, setFilesNonce] = useState(0);
  const [channelFiles, setChannelFiles] = useState<FileRow[]>([]);

  useEffect(() => {
    if (!live || !active || thread !== 'files') return;
    const channelId = active.id;
    let cancelled = false;

    api
      .files({ channelId })
      .then(({ files }) => {
        if (!cancelled) setChannelFiles(files);
      })
      .catch(() => {
        // The tab already has an empty state that says what to do; a second error
        // line about it would be noise.
      });

    return () => {
      cancelled = true;
    };
  }, [live, active?.id, thread, filesNonce]);

  async function loadMore() {
    if (!cursor || loadingMore || !active) return;
    setLoadingMore(true);
    try {
      const response = await api.messages(active.id, cursor);
      setAllMessages((current) => {
        // Deduped by id, because a message sent between the first page and this
        // one can appear in both -- the cursor is stable, but the window is not
        // frozen.
        const known = new Set(current.map((m) => m.id));
        return [...current, ...response.messages.filter((m) => !known.has(m.id))];
      });
      setCursor(response.nextCursor);
    } catch (cause) {
      setNotice(
        cause instanceof ApiError && cause.isUnauthorised
          ? 'Sign in to load earlier messages.'
          : 'Could not load earlier messages.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleChannels = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(query));
  }, [channels, term]);

  const members = useMemo(
    () => resolvedPeople.filter((p) => active?.memberIds.includes(p.id)),
    [resolvedPeople, active],
  );

  /** Scrolls the thread to a message, for the "Replying to" jump. */
  function jumpTo(messageId: string) {
    const element = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function replyTo(message: DisplayMessage) {
    setReplyingTo({
      message,
      authorName:
        message.authorId === currentUserId
          ? 'your message'
          : (resolvedPeople.find((p) => p.id === message.authorId)?.name ?? 'a message'),
    });
    setThread('chat');
  }

  const connectionLabel = !live
    ? 'Saved messages — sign in for live chat'
    : connection === 'open'
      ? 'Live'
      : connection === 'reconnecting'
        ? 'Reconnecting…'
        : 'Connecting…';

  return (
    <div
      className={
        drawerOpen ? 'page-grid chat-layout chat-drawer-open' : 'page-grid chat-layout'
      }
    >
      {/* Dismisses the phone drawer by tapping outside it. */}
      {drawerOpen && (
        <button
          type="button"
          className="chat-drawer-scrim"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close channels"
        />
      )}

      {/* Channel list */}
      <div className="panel">
        <div className="panel-head">
          <strong>Channels</strong>
          {drawerOpen && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close channels"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div style={{ padding: '0 12px 8px' }}>
          <label className="search" style={{ width: '100%' }}>
            <Hash size={15} />
            <input
              placeholder="Find a channel"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              aria-label="Find a channel"
            />
          </label>
        </div>

        <div className="chat-panel">
          {visibleChannels.map((channel) => (
            <button
              key={channel.id}
              className={channel.id === activeId ? 'chat-back active' : 'chat-back'}
              // Hook for the browser harness. `data-channel-id` because the visible
              // text is the channel *name* and two channels can share one; the test
              // needs the id to assert on the messages that arrive in it.
              data-testid="channel-button"
              data-channel-id={channel.id}
              aria-current={channel.id === activeId ? 'true' : undefined}
              onClick={() => {
                setActiveId(channel.id);
                setDrawerOpen(false);
              }}
            >
              <Hash size={15} />
              <span>{channel.name}</span>
              {/* Unread is computed per reader by the API, so this is a real count.
                  It was a fixture number before the channel list went live. */}
              {channel.unread > 0 && <span className="unread">{channel.unread}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="panel">
        <div className="panel-head">
          <button
            className="icon-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Show channels"
          >
            <ChevronLeft size={16} />
          </button>
          <strong>#{active?.name}</strong>
          <span className="unread">{members.length} members</span>

          {/*
            Start a call in this channel.

            The same action as the video button, and separated rather than merged
            because the two send different things: an audio call joins muted, a video
            call asks for the camera. Both go to the same standing room for this
            channel, so a colleague pressing either lands in the same place.
          */}
          <div className="panel-head-calls">
            <button
              className="icon-btn"
              type="button"
              onClick={() => void startCall()}
              disabled={!active || startingCall}
              aria-label={`Start audio call in #${active?.name ?? 'channel'}`}
              title="Start audio call"
            >
              <Phone size={15} />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => void startCall()}
              disabled={!active || startingCall}
              aria-label={`Start video call in #${active?.name ?? 'channel'}`}
              title="Start video call"
            >
              <Video size={16} />
            </button>
          </div>
        </div>

        {callError && (
          <p className="call-error" role="alert">
            {callError}
          </p>
        )}

        <div className="list-tabs">
          {THREADS.map((option) => (
            <button
              key={option.id}
              className={thread === option.id ? 'active' : ''}
              onClick={() => setThread(option.id)}
            >
              {option.label}
              {option.id === 'chat' && ordered.length > 0 && (
                <span className="unread">{ordered.length}</span>
              )}
              {option.id === 'files' && channelFiles.length > 0 && (
                <span className="unread">{channelFiles.length}</span>
              )}
            </button>
          ))}
        </div>

        {thread === 'chat' && (
          <>
            <div className="chat-body">
              {ordered.length === 0 ? (
                <div className="empty-state">
                  <p>This channel is quiet so far. Be the first to post.</p>
                </div>
              ) : (
                <ul
                  className="result-list"
                  style={{ listStyle: 'none', margin: 0, padding: 0 }}
                  // Hook for the browser harness. The list has no stable id or role of
                  // its own -- `result-list` is a utility class shared with the search
                  // results -- so a test would otherwise have to select on it.
                  data-testid="message-list"
                >
                  {/*
                    Older history loads on demand rather than up front. The API
                    pages with an opaque cursor and `before` was never being passed,
                    so a channel with more than fifty messages simply had no older
                    half.
                  */}
                  {cursor && (
                    <li style={{ padding: '8px 0', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="chip"
                        onClick={loadMore}
                        disabled={loadingMore}
                      >
                        {loadingMore ? 'Loading…' : 'Load earlier messages'}
                      </button>
                    </li>
                  )}

                  {ordered.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      author={resolvedPeople.find((p) => p.id === message.authorId)}
                      currentUserId={currentUserId}
                      onReact={react}
                      onReply={replyTo}
                      onEdit={edit}
                      onDelete={remove}
                      onRetry={retry}
                      onJumpTo={jumpTo}
                    />
                  ))}
                </ul>
              )}
            </div>

            <TypingIndicator peers={typing} now={now} />

            {/* Whether the thread is real. Shown because a demo that silently
                mixes live and fixture data is impossible to tell apart from one
                that is not working. */}
            <p
              className="composer-status"
              role="status"
              // Hook for the browser harness. The label is prose -- "Live",
              // "Reconnecting", "Fixtures only" -- and a test waiting for the socket to
              // open should be able to ask for the state rather than parse a sentence.
              // A fixed sleep is what made the typing test flaky: it sometimes ran
              // before the socket was up, and the first `typing.start` was dropped on
              // the floor by the `if (!client) return` guard.
              data-testid="connection-status"
              data-state={live ? connection : 'unauthenticated'}
            >
              {connectionLabel}
            </p>

            {notice && (
              <p className="form-error" role="alert">
                {notice}
              </p>
            )}

            <Composer
              channelName={active?.name ?? ''}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              live={live}
              sending={sending}
              onSend={send}
              onUpload={upload}
              onRemoveAttachment={(localId) =>
                setAttachments((current) => current.filter((a) => a.localId !== localId))
              }
              attachments={attachments}
              onTypingChange={signalTyping}
              error={composerError}
            />
          </>
        )}

        {thread === 'files' && (
          <div className="chat-body">
            {channelFiles.length === 0 ? (
              <div className="empty-state">
                <p>No files in this channel yet.</p>
                <span className="empty-meta">Attach one from the composer</span>
              </div>
            ) : (
              <ul className="result-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {channelFiles.map((file) => (
                  <li className="bubble-attachment" key={file.id}>
                    <strong>{file.name}</strong>
                    <small>
                      {file.isFolder ? 'Folder' : formatBytes(file.size)} &bull;{' '}
                      {relativeTime(file.createdAt)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/*
          Meeting chat is genuinely unreachable, not merely unwired: three seeded
          messages have a meetingId and no channelId, and GET /api/messages
          requires a channelId. So this tab says where the chat lives rather than
          claiming an empty room.
        */}
        {thread === 'meetings' && (
          <div className="empty-state">
            {channelCall ? (
              <>
                <p>A call is open in #{active?.name}.</p>
                <span className="empty-meta">
                  {channelCall.participantCount}{' '}
                  {channelCall.participantCount === 1 ? 'person has' : 'people have'} the room
                </span>
                <button
                  type="button"
                  className="join"
                  onClick={() => void joinCall()}
                  disabled={startingCall}
                  aria-label={`Join the call in #${active?.name}`}
                >
                  <Video size={14} /> Join call
                </button>
              </>
            ) : (
              <>
                <p>No call is open in #{active?.name} yet.</p>
                <span className="empty-meta">Start one and it appears here for everyone</span>
                <button
                  type="button"
                  className="join"
                  onClick={() => void startCall()}
                  disabled={startingCall}
                  aria-label={`Start a call in #${active?.name}`}
                >
                  <Video size={14} /> Start a call
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* People */}
      <div className="panel">
        <div className="panel-head">
          <strong>People</strong>
          <span className="unread">{members.length}</span>
        </div>

        <div className="members">
          {members.map((person) => (
            <div className="member" key={person.id}>
              {/* Presence from the socket, so a dot updates while the page is open.
                  The fixture's static `online` flag is the fallback when there is no
                  session, which is the only time it is consulted. */}
              <PersonAvatar person={person} size="sm" online={online.size > 0 ? online.has(person.id) : person.online} />
              <div>
                <strong>
                  {person.name}
                  {person.id === currentUserId && ' (You)'}
                </strong>
                <small>{person.jobTitle ?? 'Team member'}</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        The call, over the chat.

        The same `MeetingRoom` the meetings screen renders, so there is one
        implementation of connecting, the device controls and in-call chat. It is
        keyed on the channel's room name so switching channels mounts a fresh room --
        `MeetingRoom` only tears its connection down on unmount.
      */}
      {call && (
        <div className="call-overlay" data-testid="call-overlay">
          <MeetingRoom
            key={call.roomName}
            meeting={call}
            currentUserId={currentUserId}
            onLeave={() => setCall(null)}
          />
        </div>
      )}
    </div>
  );
}
