'use client';

import { useMemo, useState } from 'react';
import { Paperclip, Send, Hash, MessageSquare, X, ChevronLeft } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { useActivePerson } from '@/components/profile/ProfileProvider';
import { relativeTime } from '@/lib/format';
import type { Channel, ChatMessage, Person } from '@/lib/data';

type Thread = 'chat' | 'files' | 'meetings';

const THREADS: Array<{ id: Thread; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'files', label: 'Files' },
  { id: 'meetings', label: 'Meetings' },
];

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
    if (!body || !active) return;

    setAllMessages((current) => [
      ...current,
      {
        id: `local-${currentUserId}-${Date.now()}`,
        channelId: active.id,
        authorId: currentUserId,
        body,
        createdAt: new Date().toISOString(),
        reactions: [],
        attachments: [],
      },
    ]);
    setDraft('');
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
              <button className="send" type="submit" disabled={!draft.trim()} aria-label="Send message">
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
