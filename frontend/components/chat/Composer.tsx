'use client';

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, X, CornerUpLeft } from 'lucide-react';
import type { PendingAttachment } from './types';
import type { ChatMessage } from '@/lib/api';

/** The API's cap, mirrored so the limit is visible before it is hit. */
const MAX_BODY = 4000;

/** Where the counter appears. Below this the composer is quiet. */
const COUNTER_FROM = 3600;

type Props = {
  channelName: string;
  /**
   * The message being replied to, with its author already resolved.
   *
   * The name is passed rather than looked up here because the composer has no
   * directory, and `replyingTo.authorId === replyingTo.authorId` -- the obvious
   * way to render "You" -- is always true.
   */
  replyingTo: { message: ChatMessage; authorName: string } | null;
  onCancelReply: () => void;
  /** True when the thread is live. Attachments and replies need the server. */
  live: boolean;
  sending: boolean;
  onSend: (body: string, attachmentIds: string[], parentId: string | null) => void;
  onUpload: (file: File) => void;
  onRemoveAttachment: (localId: string) => void;
  attachments: PendingAttachment[];
  /** Called on every keystroke, so the owner can broadcast a typing indicator. */
  onTypingChange: (typing: boolean) => void;
  /** A refused upload, shown next to the composer rather than as a page-level error. */
  error: string | null;
};

/**
 * The message composer.
 *
 * ## Enter sends, Shift+Enter breaks the line
 *
 * The convention every chat uses, and the reason it is not `onKeyDown` alone:
 * Enter has to work from the textarea and still leave Shift+Enter inserting a
 * newline. `preventDefault` on the plain-Enter case is the whole implementation.
 *
 * ## Uploads happen on selection, not on send
 *
 * A file is uploaded as soon as it is chosen and referenced by id when the message
 * goes. The alternative -- holding the File in memory until send -- means the send
 * can fail after a 4 MB upload has already succeeded, and leaves the user to
 * re-pick it.
 *
 * The cost is a file that is uploaded but never sent, which is why the pending
 * chips are removable. There is no endpoint to un-upload one, so an abandoned
 * upload leaves an orphan row; that is recorded here rather than pretended away.
 */
export function Composer({
  channelName,
  replyingTo,
  onCancelReply,
  live,
  sending,
  onSend,
  onUpload,
  onRemoveAttachment,
  attachments,
  onTypingChange,
  error,
}: Props) {
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Bumped on every edit, so the reply banner can steal focus back. */
  const [editing, setEditing] = useState(0);

  // Replying focuses the composer, because that is the only thing the click means
  // -- otherwise the user has to click into the box to start typing their reply.
  useEffect(() => {
    if (replyingTo) {
      textareaRef.current?.focus();
      setEditing((n) => n + 1);
    }
  }, [replyingTo]);
  const ready = attachments.filter((a) => a.status === 'ready');
  const uploading = attachments.some((a) => a.status === 'uploading');
  const canSend =
    !sending && (body.trim().length > 0 || ready.length > 0) && !uploading;

  function submit() {
    if (!canSend) return;

    onSend(
      body.trim(),
      ready.map((a) => a.file?.id).filter((id): id is string => Boolean(id)),
      replyingTo?.message.id ?? null,
    );

    // Cleared only on a successful handoff. On failure `ChatClient` marks the
    // message failed and offers a retry, so clearing here is not losing it.
    setBody('');
    onTypingChange(false);
    if (replyingTo) onCancelReply();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // IME composition: Enter confirms a candidate rather than sending. Sending
    // mid-composition is the classic "my message went out in Japanese" bug.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  function pickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    for (const file of files) onUpload(file);
    // Cleared so picking the same file twice in a row fires `change` again --
    // otherwise the second selection is silently ignored.
    event.target.value = '';
  }

  return (
    <div className="composer-wrap">
      {replyingTo && (
        <div className="reply-banner">
          <CornerUpLeft size={12} />
          Replying to <strong>{replyingTo.authorName}</strong>
          <button type="button" className="icon-btn" onClick={onCancelReply} aria-label="Cancel reply">
            <X size={13} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attach-tray">
          {attachments.map((attachment) => (
            <span
              key={attachment.localId}
              className={`attach-chip${attachment.status === 'failed' ? ' failed' : ''}`}
              title={attachment.error}
            >
              <Paperclip size={11} />
              {attachment.name}
              <small>
                {attachment.status === 'uploading'
                  ? 'uploading…'
                  : attachment.status === 'failed'
                    ? 'failed'
                    : formatBytes(attachment.size)}
              </small>
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.localId)}
                aria-label={`Remove ${attachment.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/*
        `key` on the textarea is not a remount trick for its own sake -- it is
        what lets Escape clear a draft that the user cannot otherwise get rid of
        without selecting it all first.
      */}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          key={editing}
          ref={textareaRef}
          placeholder={`Message #${channelName}`}
          value={body}
          rows={1}
          maxLength={MAX_BODY}
          aria-label="Message"
          onChange={(event) => {
            setBody(event.target.value);
            // Only a non-empty draft is "typing". Otherwise clearing the box would
            // leave an indicator running until it expired.
            onTypingChange(event.target.value.trim().length > 0);
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            // A pasted image is a file, not text. Silently dropping it would look
            // like the paste did nothing.
            const image = Array.from(event.clipboardData.files).find((f) =>
              f.type.startsWith('image/'),
            );
            if (image && live) {
              event.preventDefault();
              onUpload(image);
            }
          }}
        />

        <button
          className="icon-btn"
          type="button"
          aria-label="Attach a file"
          disabled={!live}
          title={live ? 'Attach a file' : 'Attachments need a signed-in session'}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={16} />
        </button>

        <button
          className="send"
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={pickFiles}
          // `accept` is not set: the API stores any type and the cap is on size.
        />
      </form>

      {/*
        The counter appears only as the limit approaches. A permanent character
        count is noise, and showing it for every message trains people to ignore
        the state that matters.
      */}
      {body.length >= COUNTER_FROM && (
        <p className={`char-counter${body.length >= MAX_BODY ? ' at-limit' : ''}`}>
          {body.length} / {MAX_BODY}
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
