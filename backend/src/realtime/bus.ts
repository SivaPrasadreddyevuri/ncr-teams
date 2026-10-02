/**
 * Realtime event bus.
 *
 * A typed in-process emitter that HTTP handlers publish to and the WebSocket
 * layer subscribes to. It exists so the message and file routes do not have to
 * know whether a WebSocket is running, and so they can be tested without one:
 * the request handlers publish, the test asserts on the events, and Phase 2c
 * adds a subscriber that writes frames to sockets.
 *
 * Deliberately not a `ws` dependency yet. Importing the WebSocket server into the
 * request path would mean every route test needed a listening server, and the
 * broadcast contract could not be checked on its own.
 *
 * ## Events are in-process only
 *
 * A `message.created` published on one Render instance does not reach a browser
 * connected to another. That matters as soon as there is more than one instance,
 * and the fix is a Redis pub/sub fan-out at this exact seam -- the emit signature
 * would not change. With a single instance this is correct as written, and the
 * comment records that rather than leaving it to be rediscovered.
 *
 * ## Scope is on the event, not inferred downstream
 *
 * A message belongs to a channel or to a meeting, never both, so every event
 * carries the id of whichever conversation it belongs to and the relay routes on
 * it. Editing a meeting message therefore reaches the room's sockets, and a channel
 * message never leaks into one -- which is the reason the scope is explicit rather
 * than reconstructed from a nullable column at the far end.
 */

import { EventEmitter } from 'node:events';

export type RealtimeEvent =
  | { type: 'message.created'; channelId: string; message: unknown }
  | { type: 'message.updated'; channelId: string; message: unknown }
  | { type: 'message.deleted'; channelId: string; messageId: string }
  | { type: 'meeting.message.created'; meetingId: string; message: unknown }
  | { type: 'meeting.message.updated'; meetingId: string; message: unknown }
  | { type: 'meeting.message.deleted'; meetingId: string; messageId: string }
  /**
   * A file reaching a conversation.
   *
   * Both scopes are carried rather than one being implied: an upload can land in a
   * channel, in a meeting, or in neither yet, and the relay has to know which set of
   * sockets the file belongs in.
   */
  | { type: 'file.created'; channelId: string | null; meetingId: string | null; file: unknown };

type Listener = (event: RealtimeEvent) => void;

const emitter = new EventEmitter();

// One listener per WebSocket connection, so the default limit of 10 would warn
// as soon as a dozen people joined a call. Zero is unlimited, which is right
// here: the listeners are cheap and the count is bounded by open sockets.
emitter.setMaxListeners(0);

export function publish(event: RealtimeEvent): void {
  emitter.emit('event', event);
}

/** Subscribes and returns an unsubscribe function, so callers cannot leak one. */
export function subscribe(listener: Listener): () => void {
  emitter.on('event', listener);
  return () => {
    emitter.off('event', listener);
  };
}
