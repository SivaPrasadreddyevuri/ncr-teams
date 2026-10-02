/**
 * The WebSocket client.
 *
 * Two problems this solves that a bare `new WebSocket(...)` does not:
 *
 * **The URL and the token.** The socket is cross-origin (the API is proxied, an
 * upgrade is not), so it needs a short-lived token from `GET /api/auth/ws-token`
 * and the backend's own host. A token is only good for 60 seconds, so it is
 * fetched per connection rather than cached. The host comes from
 * `NEXT_PUBLIC_WS_URL`, which cannot be derived in the browser -- see
 * `resolveSocketUrl` for why.
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
const WS_PATH = '/ws';

/**
 * Resolves the socket URL, and says so when the configuration is wrong.
 *
 * The awkward part of this deployment is that REST and the WebSocket reach the
 * API by different routes. REST goes through the Next rewrite in
 * `next.config.ts`, so the browser only ever talks to the frontend's own origin.
 * A rewrite cannot proxy a WebSocket upgrade, so the socket has to be told the
 * backend's host directly -- there is no way to derive it in the browser, since
 * `API_ORIGIN` is deliberately not a `NEXT_PUBLIC_` variable and is never sent
 * to the client.
 *
 * The old fallback guessed `wss://<page host>/ws`, which in production is
 * Vercel. That host will never complete the handshake, so chat silently stopped
 * receiving while looking connected-or-busy in the console. A guess that is
 * reliably wrong is worse than a loud failure, so the guess now warns.
 *
 * The scheme and path are derived rather than demanded, because
 * `https://ncr-teams-api.onrender.com` is a very easy thing to paste and
 * `new WebSocket` would throw on it. Only ws/wss/http/https are accepted though:
 * anything else is a mistake rather than an intention, and rewriting an unknown
 * scheme into `ws://` would hide it.
 *
 * Exported for the tests in test/realtime-url.test.ts. The URL is the one piece
 * of this module that is a pure function of its input, and it is also the piece
 * whose failure is invisible -- a wrong host means a socket that never opens.
 */
export function resolveSocketUrl(
  configured: string | undefined,
  pageOrigin: { protocol: string; host: string },
  isProduction: boolean,
): string {
  if (configured) {
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      throw new Error(
        `NEXT_PUBLIC_WS_URL is not a valid URL: ${JSON.stringify(configured)}. ` +
          'Use a full ws:// or wss:// URL, for example wss://ncr-teams-api.onrender.com/ws',
      );
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error(
        `NEXT_PUBLIC_WS_URL must be a ws:// or wss:// URL, got ${url.protocol}// in ` +
          `${JSON.stringify(configured)}.`,
      );
    }

    // A bare origin is the common paste, so the path is added for it. Setting
    // `pathname` rather than returning `url.href` is also what normalises the
    // case where the paste had no trailing slash.
    if (url.pathname === '/' || url.pathname === '') url.pathname = WS_PATH;

    return url.toString();
  }

  if (isProduction) {
    console.warn(
      `[realtime] NEXT_PUBLIC_WS_URL is not set, so the socket is being opened against ` +
        `${pageOrigin.protocol}//${pageOrigin.host}${WS_PATH} -- the frontend's own host. ` +
        'The Next rewrite proxies /api/* but cannot proxy a WebSocket upgrade, so this ' +
        'will not connect. Set NEXT_PUBLIC_WS_URL to the API\'s public wss:// URL.',
    );
  }

  return `${pageOrigin.protocol === 'https:' ? 'wss' : 'ws'}://${pageOrigin.host}${WS_PATH}`;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private readonly channels = new Set<string>();
  /**
   * Meetings this client follows, kept beside the channels rather than folded in.
   *
   * The server treats the two as separate authorised sets -- channels by team
   * membership, meetings by participation -- and it replaces both on every
   * `subscribe` frame, so one set cannot be sent without the other.
   */
  private readonly meetings = new Set<string>();
  private attempt = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly handlers: Handlers = {}) {}

  /**
   * Connects, fetching a token first.
   *
   * The socket host comes from `NEXT_PUBLIC_WS_URL` when it is set. The fallback
   * is the page's own origin, which is right for a single-host deployment and
   * wrong for the split one -- see `resolveSocketUrl`.
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

    let base: string;
    try {
      base = resolveSocketUrl(
        process.env.NEXT_PUBLIC_WS_URL,
        location,
        process.env.NODE_ENV === 'production',
      );
    } catch (error) {
      // A malformed variable is a configuration mistake, not a transient
      // failure, so retrying cannot help. Failing here rather than letting
      // `new WebSocket` throw keeps the failure legible.
      this.emitStatus('closed');
      console.error(error instanceof Error ? error.message : error);
      return;
    }

    // Appended with the URL API rather than by string concatenation, because a
    // configured URL may already carry a query string and `?token=` would then
    // produce a second `?` and send the whole thing as one parameter name. The
    // token is also encoded by searchParams, which `new WebSocket` would not do.
    const url = new URL(base);
    url.searchParams.set('token', this.token);
    this.socket = new WebSocket(url.toString());

    this.socket.onopen = () => {
      this.attempt = 0;
      this.emitStatus('open');
      // A fresh socket knows nothing, so the subscription is re-sent.
      if (this.channels.size > 0 || this.meetings.size > 0) this.sendSubscribe();
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

  /**
   * Subscribes to meetings. Idempotent, and survives reconnection.
   *
   * A separate call rather than an argument on `subscribe` because the two answer
   * different questions -- a channel because of team membership, a meeting because of
   * participation -- and a caller in a call has usually not opened the chat at all.
   */
  subscribeMeetings(meetingIds: string[]): void {
    for (const id of meetingIds) this.meetings.add(id);
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

  /**
   * Always sends both sets.
   *
   * The server *replaces* its subscription on every `subscribe` frame rather than
   * merging, so sending only the channels here would silently unsubscribe every
   * meeting, and vice versa.
   */
  private sendSubscribe(): void {
    this.send('subscribe', {
      channelIds: [...this.channels],
      meetingIds: [...this.meetings],
    });
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
