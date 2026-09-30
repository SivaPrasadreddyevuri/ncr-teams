/**
 * The WebSocket client.
 *
 * Two problems this solves that a bare `new WebSocket(...)` does not:
 *
 * **The URL and the token.** The socket is cross-origin (the API is proxied, an
 * upgrade is not), so it needs a short-lived token from `GET /api/auth/ws-token`
 * and the backend's own host. A token is only good for 60 seconds, so it is
 * fetched per connection rather than cached.
 *
 * **Reconnection.** A mobile browser, a sleeping laptop or a Render instance
 * restarting will drop the socket, and without recovery the chat silently stops
 * receiving. Reconnect uses exponential backoff with a cap and a jitter, because
 * without jitter every client in a workspace that just lost the server comes back
 * in the same millisecond and knocks it over again.
 *
 * Subscriptions are re-sent on every reconnect, because a new socket starts with
 * an empty subscription set.
 */

import { api } from './api';

export type RealtimeFrame = { type: string; payload: Record<string, unknown> };

type Handlers = {
  onFrame?: (frame: RealtimeFrame) => void;
  onStatus?: (status: RealtimeStatus) => void;
};

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private readonly channels = new Set<string>();
  private attempt = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly handlers: Handlers = {}) {}

  /**
   * Connects, fetching a token first.
   *
   * The socket host is derived from the page origin in production. In local
   * development the API runs on its own port and the page is on another, so
   * `NEXT_PUBLIC_WS_URL` points at it directly.
   */
  async connect(): Promise<void> {
    this.closedByUs = false;
    this.emitStatus('connecting');

    try {
      const { token } = await api.wsToken();
      this.token = token;
    } catch {
      // No session, or the API is down. Retrying will not help until one of those
      // changes, and the backoff handles it.
      this.scheduleReconnect();
      return;
    }

    const base =
      process.env.NEXT_PUBLIC_WS_URL ??
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

    this.socket = new WebSocket(`${base}?token=${encodeURIComponent(this.token)}`);

    this.socket.onopen = () => {
      this.attempt = 0;
      this.emitStatus('open');
      // A fresh socket knows nothing, so the subscription is re-sent.
      if (this.channels.size > 0) this.sendSubscribe();
    };

    this.socket.onmessage = (event) => {
      let frame: RealtimeFrame;
      try {
        frame = JSON.parse(event.data as string) as RealtimeFrame;
      } catch {
        return;
      }
      this.handlers.onFrame?.(frame);
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (this.closedByUs) {
        this.emitStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };

    // A failed handshake fires `error` then `close`, so the close handler above
    // owns the retry. This exists only to stop an unhandled error event.
    this.socket.onerror = () => undefined;
  }

  /** Subscribes to channels. Idempotent, and survives reconnection. */
  subscribe(channelIds: string[]): void {
    for (const id of channelIds) this.channels.add(id);
    this.sendSubscribe();
  }

  send(type: string, payload: unknown = {}): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type, payload }));
  }

  /** Closes for good. No reconnect follows. */
  close(): void {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private sendSubscribe(): void {
    this.send('subscribe', { channelIds: [...this.channels] });
  }

  private scheduleReconnect(): void {
    if (this.closedByUs) return;
    this.emitStatus('reconnecting');

    this.attempt += 1;
    // Doubling, capped. The jitter matters: every client in a workspace would
    // otherwise retry in lockstep after the same disconnect.
    const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);

    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private emitStatus(status: RealtimeStatus): void {
    this.handlers.onStatus?.(status);
  }
}
