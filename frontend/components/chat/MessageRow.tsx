'use client';

import { useRef, useState } from 'react';
import { CornerUpLeft, Pencil, Trash2, SmilePlus, RotateCcw } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { EmojiPicker } from './EmojiPicker';
import type { DisplayMessage } from './types';
import type { Person } from '@/lib/data';
import { relativeTime } from '@/lib/format';

type Props = {
  message: DisplayMessage;
  author: Person | undefined;
  /** The caller, for the "(mine)" affordances and the optimistic styling. */
  currentUserId: string;
  onReact: (message: DisplayMessage, emoji: string) => void;
  onReply: (message: DisplayMessage) => void;
  onEdit: (message: DisplayMessage, body: string) => void;
  onDelete: (message: DisplayMessage) => void;
  onRetry: (message: DisplayMessage) => void;
  /** Scrolls the thread to a message, used by the "Replying to" link. */
  onJumpTo: (messageId: string) => void;
};

/** The largest edit the API accepts, mirrored so the limit is visible while typing. */
const MAX_BODY = 4000;

/**
 * One message, with its actions.
 *
 * The toolbar is revealed on hover *and* on keyboard focus, not hover alone. A
 * hover-only control is unreachable by keyboard, and a message action that cannot
 * be reached is a message action that does not exist for some users.
 */
export function MessageRow({
  message,
  author,
  currentUserId,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onJumpTo,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  const mine = message.authorId === currentUserId;
  const myReactions = new Set(
    message.reactions.filter((r) => r.userIds.includes(currentUserId)).map((r) => r.emoji),
  );

  // A tombstone renders as removed rather than as an empty bubble, so the thread
  // still shows that something was said and where.
  if (message.deleted) {
    return (
      <li className="msg tombstone" ref={rowRef} data-message-id={message.id}>
        <span className="tombstone-body">This message was deleted</span>
      </li>
    );
  }

  function beginEdit() {
    setDraft(message.body);
    setEditing(true);
  }

  function commitEdit() {
    const body = draft.trim();
    // No-op rather than an error: an unchanged body is not a mistake, and
    // refusing it would make the cancel button look broken.
    if (body && body !== message.body) onEdit(message, body);
    setEditing(false);
  }

  return (
      <li
        className={`msg${mine ? ' mine' : ''}${message.pending ? ' pending' : ''}${message.failed ? ' failed' : ''}`}
        ref={rowRef}
        data-message-id={message.id}
        // A hook for the browser harness, alongside the `data-message-id` that was
        // already here. `pending` and `failed` are separate booleans rather than a
        // state enum so a test can assert "still being sent" without parsing the
        // class list, which is presentation.
        data-testid="message"
        data-pending={message.pending || undefined}
        data-failed={message.failed || undefined}
      >
      <PersonAvatar person={author} size="sm" />

      <div>
        {/*
          The reply context. Rendered above the bubble because that is where a
          reader looks for "why is this here" -- and clickable, since the point of
          an inline reply is being able to jump to what it answers.
        */}
        {message.parentId && (
          <button
            type="button"
            className="reply-context"
            onClick={() => onJumpTo(message.parentId as string)}
            title="Jump to the message this replies to"
          >
            <CornerUpLeft size={11} />
            Replying to {message.parentAuthor ?? 'a deleted message'}
          </button>
        )}

        <div className="meeting-info" style={{ marginBottom: 2 }}>
          <strong>
            {mine ? 'You' : (author?.name ?? 'Unknown')}{' '}
            {/*
              A pending message has no acknowledged timestamp, so the time is
              suppressed rather than shown from the browser's clock. An optimistic
              message with a real time reads as delivered when it might not be.
            */}
            {!message.pending && (
              <small style={{ color: 'var(--muted)', fontWeight: 400 }}>
                {relativeTime(message.createdAt)}
                {message.editedAt && ' · edited'}
              </small>
            )}
            {message.pending && (
              <small style={{ color: 'var(--muted)', fontWeight: 400 }}>sending…</small>
            )}
          </strong>
        </div>

        {editing ? (
          <div className="edit-box">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_BODY}
              autoFocus
              aria-label="Edit message"
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            />
            <div className="edit-actions">
              <button type="button" className="chip" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="join" onClick={commitEdit} disabled={!draft.trim()}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="bubble">
            {/*
              Newlines are preserved deliberately. A message typed as a list would
              otherwise render as one run-on line, and collapsing it here is what
              makes multi-line messages look broken.
            */}
            <span className="bubble-body">{message.body}</span>
            {message.attachments.length > 0 && (
              <span className="bubble-files">
                {message.attachments.map((file) => (
                  <span key={file.id} className="bubble-attachment">
                    {file.name}
                    <small>{formatBytes(file.size)}</small>
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {/* Reactions, each one a toggle. */}
        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={reaction.userIds.includes(currentUserId) ? 'reaction active' : 'reaction'}
                aria-pressed={reaction.userIds.includes(currentUserId)}
                title={`${reaction.userIds.length} reaction${reaction.userIds.length === 1 ? '' : 's'}`}
                onClick={() => onReact(message, reaction.emoji)}
              >
                {reaction.emoji} {reaction.userIds.length}
              </button>
            ))}
          </div>
        )}

        {/* A failed send is a state the user has to be able to act on. */}
        {message.failed && (
          <button type="button" className="retry" onClick={() => onRetry(message)}>
            <RotateCcw size={12} /> Not sent. Retry
          </button>
        )}

        {/*
          The toolbar. Hidden for a pending or failed message: both are mid-flight
          states where "delete" and "edit" do not mean anything yet.
        */}
        {!message.pending && !message.failed && !editing && (
          <div className="msg-tools">
            <button
              type="button"
              className="icon-btn"
              title="Add a reaction"
              aria-label="Add a reaction"
              onClick={() => setPickerOpen((open) => !open)}
            >
              <SmilePlus size={14} />
            </button>

            {!message.localOnly && (
              <button
                type="button"
                className="icon-btn"
                title="Reply"
                aria-label="Reply to this message"
                onClick={() => onReply(message)}
              >
                <CornerUpLeft size={14} />
              </button>
            )}

            {/* Author-only, matching the API. A moderator's tools would be a
                different feature with an audit trail, not a wider permission on
                this one. */}
            {mine && (
              <button
                type="button"
                className="icon-btn"
                title="Edit"
                aria-label="Edit this message"
                onClick={beginEdit}
              >
                <Pencil size={14} />
              </button>
            )}

            {mine && (
              <button
                type="button"
                className="icon-btn"
                title="Delete"
                aria-label="Delete this message"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}

        {pickerOpen && (
          <EmojiPicker
            mine={myReactions}
            onClose={() => setPickerOpen(false)}
            onPick={(emoji) => {
              setPickerOpen(false);
              onReact(message, emoji);
            }}
          />
        )}

        {confirmingDelete && (
          <div className="confirm" role="alertdialog" aria-label="Delete this message?">
            <span>Delete this message?</span>
            <button
              type="button"
              className="chip"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="join danger"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete(message);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Local so the row does not pull in the whole format module for one call. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
