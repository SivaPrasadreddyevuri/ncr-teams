'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Send, Hash, MessageSquare, X, ChevronLeft } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useActivePerson } from '@/components/profile/ProfileProvider';
import { relativeTime } from '@/lib/format';
import { api, ApiError, type ChatMessage as LiveMessage } from '@/lib/api';
import { RealtimeClient, type RealtimeStatus } from '@/lib/realtime';
import type { Channel, ChatMessage, Person } from '@/lib/data';

type Thread = 'chat' | 'files' | 'meetings';

const THREADS: Array<{ id: Thread; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'files', label: 'Files' },
  { id: 'meetings', label: 'Meetings' },
];

/**
 * A message that exists only in this browser.
 *
 * Used when there is no session, so the composer still responds. The id is
 * marked as local and never sent, so it cannot collide with a real one.
 */
function localEcho(authorId: string, channelId: string, body: string): ChatMessage {
  return {
    id: `local-${authorId}-${Date.now()}`,
    channelId,
    authorId,
    body,
    createdAt: new Date().toISOString(),
    reactions: [],
    attachments: [],
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
  const [allMessages, setAllMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<Thread>('chat');
  const [term, setTerm] = useState('');

  // `people` arrives from a server component, so it is always the static
  // fixture. Overlaying the signed-in user means a rename in Settings shows up
  // in the member list and on your own messages, not just in the sidebar.
  const me = useActivePerson();
  const resolvedPeople = useMemo(
    () => people.map((person) => (person.id === me.id ? me : person)),
    [people, me],
  );

  // Phones show the thread full width with the channel list as a slide-over,
  // so the same "which panel is in front" state has to live here. It is inert
  // above 760px, where the two columns are visible side by side.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const active = channels.find((c) => c.id === activeId) ?? channels[0];

  /* ---------------------------------------------------------------- */
  /* Live data                                                        */
  /* ---------------------------------------------------------------- */

  /*
   * The fixtures are still the fallback, and that is deliberate rather than
   * unfinished: the rest of the app reads from them, and a visitor who reaches
   * /chat before signing in should see a working thread rather than an error.
   * Once the API answers, the thread is replaced with the real one.
   */
  const [live, setLive] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<RealtimeStatus>('closed');

  // Read inside the socket handler, which is created once. Without a ref the
  // handler would close over the first channel and never see a change.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    if (!active) return;
    // `cancelled` because switching channels mid-request would otherwise let a
    // slower earlier response overwrite the newer one.
    let cancelled = false;
    const channelId = active.id;

    setNotice(null);

    api
      .messages(channelId)
      .then(({ messages }) => {
        if (cancelled) return;
        setAllMessages(messages);
        setLive(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Unauthenticated is the expected case for a visitor who has not signed
        // in, and retrying cannot fix it, so the fixtures stay and no socket is
        // opened.
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

  // One socket for the page, resubscribed when the channel changes.
  useEffect(() => {
    if (!live || !active) return;
    const channelId = active.id;

    const client = new RealtimeClient({
      onStatus: setConnection,
      onFrame: (frame) => {
        if (frame.type !== 'message.created' && frame.type !== 'message.updated') return;
        const incoming = frame.payload.message as LiveMessage | undefined;
        if (!incoming || incoming.channelId !== activeIdRef.current) return;

        setAllMessages((current) => {
          const at = current.findIndex((m) => m.id === incoming.id);
          // Replace in place for a reaction change, append for a new message.
          if (at !== -1) {
            const next = [...current];
            next[at] = incoming;
            return next;
          }
          return [...current, incoming];
        });
      },
    });

    void client.connect();
    client.subscribe([channelId]);

    // Closed on unmount and on every channel change. This is not the same as
    // the client's own reconnect, which handles the server going away.
    return () => {
      client.close();
    };
  }, [live, active?.id]);

  // Marking read is a nicety; a failure must not surface as an error.
  useEffect(() => {
    if (!live || !active) return;
    const channelId = active.id;
    void api.markChannelRead(channelId).catch(() => undefined);
  }, [live, active?.id]);


  const threadMessages = useMemo(
    () => allMessages.filter((m) => m.channelId === activeId),
    [allMessages, activeId],
  );

  const visibleChannels = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(query));
  }, [channels, term]);

  const members = useMemo(
    () => resolvedPeople.filter((p) => active?.memberIds.includes(p.id)),
    [resolvedPeople, active],
  );

  function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !active || sending) return;

    setDraft('');
    setSending(true);

    if (!live) {
      // No session, or the API is unreachable. Append locally so the thread still
      // responds, and say so rather than pretending it was delivered.
      setAllMessages((current) => [...current, localEcho(currentUserId, active.id, body)]);
      setNotice('Not signed in, so this message was not sent.');
      setSending(false);
      return;
    }

    api
      .sendMessage(active.id, body)
      .then(({ message }) => {
        // Append the server's copy rather than the local echo: it carries the
        // real id, the real timestamp and the trimmed body.
        setAllMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
        setNotice(null);
      })
      .catch((cause: unknown) => {
        setDraft(body);
        setNotice(cause instanceof ApiError ? cause.message : 'Could not send that message.');
      })
      .finally(() => setSending(false));
  }

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
          <span className="unread">{channels.length}</span>
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

        <div className="list">
          {visibleChannels.map((channel) => (
            <button
              type="button"
              key={channel.id}
              onClick={() => {
                setActiveId(channel.id);
                setDrawerOpen(false);
              }}
              className={channel.id === activeId ? 'conversation active' : 'conversation'}
            >
              <Hash size={16} />
              <div>
                <strong>{channel.name}</strong>
                <small>{channel.teamName}</small>
              </div>
              {channel.unread > 0 && <span className="unread">{channel.unread}</span>}
            </button>
          ))}
          {visibleChannels.length === 0 && (
            <div className="empty-state" style={{ padding: 30 }}>
              <p>No channels match &ldquo;{term.trim()}&rdquo;.</p>
            </div>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="panel chat-panel">
        <div className="panel-head">
          {/* Only rendered in the phone layout, where the channel list is a
              slide-over and this is the way back to it. */}
          <button
            type="button"
            className="chat-back"
            onClick={() => setDrawerOpen(true)}
            aria-label="Show channels"
          >
            <ChevronLeft size={16} /> Channels
          </button>
          <strong>
            <Hash size={15} /> {active?.name}
          </strong>
          <span className="unread">{members.length} members</span>
        </div>

        <div className="list-tabs">
          {THREADS.map((option) => (
            <button
              key={option.id}
              className={thread === option.id ? 'active' : ''}
              onClick={() => setThread(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {thread === 'chat' && (
          <>
            <div className="chat-body">
              {threadMessages.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Hash size={22} />
                  </span>
                  <p>This channel is quiet so far. Be the first to post.</p>
                </div>
              ) : (
                threadMessages.map((message) => {
                  const author = resolvedPeople.find((p) => p.id === message.authorId);
                  const mine = message.authorId === currentUserId;

                  return (
                    <div className={mine ? 'msg mine' : 'msg'} key={message.id}>
                      <PersonAvatar person={author} size="sm" />
                      <div>
                        <div className="meeting-info" style={{ marginBottom: 2 }}>
                          <strong>
                            {mine ? 'You' : (author?.name ?? 'Unknown')}{' '}
                            <small style={{ color: 'var(--muted)', fontWeight: 400 }}>
                              {relativeTime(message.createdAt)}
                            </small>
                          </strong>
                        </div>

                        <div className="bubble">
                          {message.body}
                          {message.attachments.map((file) => (
                            <div key={file.id} className="bubble-attachment">
                              <Paperclip size={11} /> {file.name}
                            </div>
                          ))}
                        </div>

                        {message.reactions.length > 0 && (
                          <div className="reactions">
                            {message.reactions.map((reaction) => (
                              <span className="reaction" key={reaction.emoji}>
                                {reaction.emoji} {reaction.userIds.length}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/*
              Whether this thread is real. Shown because a demo that silently
              mixes live and fixture data is impossible to tell apart from one
              that is not working -- and the distinction matters when someone is
              judging whether the app does what it claims.
            */}
            <p className="composer-status" role="status">
              {!live ? 'Saved messages — sign in for live chat' : (
                connection === 'open'
                  ? 'Live'
                  : connection === 'reconnecting'
                    ? 'Reconnecting…'
                    : 'Connecting…'
              )}
            </p>

            {notice && (
              <p className="form-error" role="alert">
                {notice}
              </p>
            )}

            <form className="composer" onSubmit={send}>
              <input
                placeholder={`Message #${active?.name ?? ''}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Message"
              />
              <button
                className="icon-btn"
                type="button"
                aria-label="Attach a file"
                disabled
                title="Attachments need a backend"
              >
                <Paperclip size={16} />
              </button>
              <button
                className="send"
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            </form>
          </>
        )}

        {thread === 'files' && (
          <div className="empty-state">
            <span className="empty-icon">
              <Paperclip size={22} />
            </span>
            <p>No files in this channel yet.</p>
            <span className="empty-meta">Shared documents appear here</span>
          </div>
        )}

        {thread === 'meetings' && (
          <div className="empty-state">
            <span className="empty-icon">
              <MessageSquare size={22} />
            </span>
            <p>No meetings scheduled in this channel.</p>
            <span className="empty-meta">Create one from the calendar</span>
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
              <PersonAvatar person={person} size="sm" online={person.online} />
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
    </div>
  );
}
