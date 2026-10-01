/**
 * Types shared by the chat pieces.
 *
 * Separate from `lib/api` because these are *display* concerns layered over the
 * API's `ChatMessage`, not a second definition of it. The API type stays the single
 * source of truth -- see the note in `lib/data.ts`.
 */

import type { ChatMessage, FileRow } from '@/lib/api';

/**
 * A message as the thread renders it.
 *
 * The three extra fields are all local state that never leaves the browser, and
 * they are the difference between a chat that feels like a chat and one that feels
 * like a form:
 *
 * - `pending` -- sent optimistically, not yet acknowledged. Rendered dimmed, with
 *   its timestamp suppressed, because "sending" and "sent" are different states and
 *   showing a real time for an unacknowledged message is a small lie.
 * - `failed` -- the send did not go through. Gets a Retry button rather than
 *   silently vanishing, because the alternative is a message the user believes was
 *   sent and that nobody else can see.
 * - `localOnly` -- the no-session echo, which is never sent to anyone. The
 *   "Saved messages" status already says the thread is not live; this is what makes
 *   that echo visibly different from a real delivery.
 */
export type DisplayMessage = ChatMessage & {
  pending?: boolean;
  failed?: boolean;
  localOnly?: boolean;
};

/** A file chosen in the composer but not yet sent. */
export type PendingAttachment = {
  /** Local id, so React has a key before the upload returns. */
  localId: string;
  name: string;
  size: number;
  mimeType: string;
  status: 'uploading' | 'ready' | 'failed';
  /** Present once uploaded: the row the message will be sent with. */
  file?: FileRow;
  error?: string;
};

/** What a hover action asks the owner to do. */
export type MessageAction = 'react' | 'reply' | 'edit' | 'delete';

/** Someone currently typing, with the moment their indicator should expire. */
export type TypingPeer = {
  userId: string;
  name: string;
  /** Epoch ms. Expiry is time-based rather than cleared by a `typing.stop`,
   *  because a client that closes its laptop mid-keystroke never sends one. */
  expiresAt: number;
};
