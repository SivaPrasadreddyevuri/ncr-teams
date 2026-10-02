/**
 * The WebSocket server.
 *
 * Attached to the same HTTP server as the API, at `/ws`. One process, one port,
 * one origin to allow -- which matters because the free-tier instance sleeps when
 * idle, and a second long-polling service would keep it awake for no benefit.
 *
 * ## Shape of the protocol
 *
 * Client to server:
 *   { type: 'subscribe',   payload: { channelIds: string[], meetingIds: string[] } }
 *   { type: 'typing.start', payload: { channelId: string } }
 *   { type: 'typing.stop',  payload: { channelId: string } }
 *   { type: 'ping' }
 *
 * Server to client: the frames `src/realtime/bus.ts` publishes, plus:
 *   { type: 'ready',         payload: { userId, onlineUserIds } }
 *   { type: 'presence.changed', payload: { userId, status } }
 *   { type: 'error',         payload: { code, message } }
 *
 * Every frame is `{ type, payload }`, so a client can switch on one field.
 *
 * ## What is deliberately not here
 *
 * **Message delivery is not the socket's job.** A client POSTs a message to the
 * REST API, which validates, persists and publishes to the bus. The socket only
 * *relays* the event. A socket that could write would need the same validation,
 * the same authorisation and the same audit path as the HTTP route, and there is
 * no version of that worth maintaining twice.
 *
 * **Typing indicators are not routed through the bus.** They are ephemeral,
 * high-chatter and carry no reason to outlive the connection, so putting them on
 * the bus would mean every subscriber's handler running for a frame that most
 * clients drop immediately.
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { prisma } from '../db.js';
import { verifyWsToken } from './ws-token.js';
import { subscribe, type RealtimeEvent } from './bus.js';
import {
  addConnection,
  onlineUserIds,
  onPresenceChange,
  removeConnection,
  reset as resetPresence,
  sweepStale,
  touchConnection,
} from './presence.js';

const PATH = '/ws';
const HEARTBEAT_MS = 30_000;

type Client = {
  id: string;
  socket: WebSocket;
  userId: string;
  channels: Set<string>;
  /**
   * Meetings this socket asked to follow, checked the same way as channels.
   *
   * Separate from `channels` rather than folded into it because the two are
   * authorised differently and joined from different places: a meeting is reachable
   * only by being a participant in it, which is a row that exists and can be
   * revoked, whereas channel access follows team membership.
   */
  meetings: Set<string>;
  alive: boolean;
};

export type RealtimeHandle = {
  /** Number of open connections. For tests and diagnostics. */
  connectionCount: () => number;
  close: () => Promise<void>;
};

export function attachRealtime(server: HttpServer): RealtimeHandle {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<Client>();

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }

    // Only /ws is upgraded. A stray upgrade on any other path would otherwise be
    // accepted and quietly become a second endpoint.
    if (url.pathname !== PATH) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const userId = verifyWsToken(url.searchParams.get('token') ?? undefined);
    if (!userId) {
      // 401 at the HTTP layer of the handshake, which the browser reports as a
      // failed connection rather than an open socket that is then closed.
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request, userId);
    });
  });

  wss.on('connection', (socket: WebSocket, _request: IncomingMessage, rawUserId: unknown) => {
    // The third argument rides along from handleUpgrade above. Widened through
    // `unknown` because the ws types only declare two parameters.
    const userId = typeof rawUserId === 'string' ? rawUserId : '';

    const client: Client = {
      id: randomUUID(),
      socket,
      userId,
      channels: new Set(),
      meetings: new Set(),
      alive: true,
    };
    clients.add(client);

    addConnection(userId, client.id);
    send(client, 'ready', { userId, onlineUserIds: onlineUserIds() });
    broadcastPresence(userId, 'online');

    socket.on('pong', () => {
      client.alive = true;
      touchConnection(client.id);
    });

    socket.on('message', (raw) => {
      void handleMessage(client, raw.toString());
    });

    socket.on('close', () => {
      clients.delete(client);
      removeConnection(userId, client.id);
      // Only report offline if that was the user's last connection; a second tab
      // must not make them appear to have gone.
      const stillOnline = [...clients].some((c) => c.userId === userId);
      if (!stillOnline) broadcastPresence(userId, 'offline');
    });

    socket.on('error', () => {
      // The close handler does the cleanup. An error here means the socket is
      // already unusable, and closing is the only useful response.
      socket.terminate();
    });
  });

  /**
   * Relays bus events to the sockets that asked for them.
   *
   * The publisher's own socket is skipped for `message.created`, because that
   * client already has the message from the HTTP response it just received, and
   * sending it twice would duplicate the row in the thread.
   */
  const unsubscribeBus = subscribe((event: RealtimeEvent) => {
    for (const client of clients) {
      // Meeting events go only to sockets following that meeting. Checked first,
      // because a meeting id is not a channel id and would otherwise fall through to
      // the channel check below and match nothing -- or, worse, match by accident.
      // A meeting-scoped event reaches the sockets following that meeting. The null
      // check matters because `file.created` carries both scopes: an upload into a
      // channel has `meetingId: null` and must route by channel, not be dropped by a
      // `meetings.has(null)` that can never match.
      if ('meetingId' in event && event.meetingId !== null) {
        if (!client.meetings.has(event.meetingId)) continue;
      } else if ('channelId' in event) {
        // `file.created` carries null for whichever scopes do not apply, and a client
        // subscribed to one conversation has no way to receive a file for another.
        // A file with no scope at all is dropped rather than fanned out to everyone,
        // which would be a leak.
        if (event.channelId === null) continue;
        if (!client.channels.has(event.channelId)) continue;
      } else {
        continue;
      }

      if (event.type === 'message.created' && event.message && isOwnMessage(event.message, client)) {
        continue;
      }
      // Same reasoning for the meeting equivalent: the author already has the row
      // from the POST that created it.
      if (
        event.type === 'meeting.message.created' &&
        event.message &&
        isOwnMessage(event.message, client)
      ) {
        continue;
      }
      send(client, event.type, event);
    }
  });

  const unsubscribePresence = onPresenceChange((userId, status) => {
    broadcastPresence(userId, status);
  });

  /** `ping` from the browser is a keepalive the application does not see. */
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        // A socket that missed a previous round trip is terminated, which fires
        // `close` and runs the presence cleanup.
        client.socket.terminate();
        clients.delete(client);
        removeConnection(client.userId, client.id);
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
      }
    }
    sweepStale();
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function broadcastPresence(userId: string, status: string) {
    for (const client of clients) {
      send(client, 'presence.changed', { userId, status });
    }
  }

  async function handleMessage(client: Client, raw: string): Promise<void> {
    let frame: { type?: unknown; payload?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      send(client, 'error', { code: 'malformed', message: 'Frame was not valid JSON.' });
      return;
    }

    const type = typeof frame.type === 'string' ? frame.type : '';
    const payload = (frame.payload ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'ping':
        send(client, 'pong', {});
        return;

      case 'subscribe': {
        const channels = Array.isArray(payload.channelIds)
          ? payload.channelIds.filter((id): id is string => typeof id === 'string')
          : [];
        const meetings = Array.isArray(payload.meetingIds)
          ? payload.meetingIds.filter((id): id is string => typeof id === 'string')
          : [];

        // Subscription is not a claim of membership. An unauthorised socket could
        // otherwise name any id and start receiving its traffic, which makes the
        // token check above pointless.
        const [allowedChannels, allowedMeetings] = await Promise.all([
          allowedChannelIds(client.userId, channels),
          allowedMeetingIds(client.userId, meetings),
        ]);

        client.channels = new Set(allowedChannels);
        client.meetings = new Set(allowedMeetings);
        send(client, 'subscribed', {
          channelIds: allowedChannels,
          meetingIds: allowedMeetings,
        });
        return;
      }

      case 'typing.start':
      case 'typing.stop': {
        const channelId = typeof payload.channelId === 'string' ? payload.channelId : '';
        if (!client.channels.has(channelId)) {
          send(client, 'error', { code: 'not_subscribed', message: 'Subscribe to the channel first.' });
          return;
        }
        // Not echoed to the sender: a client that renders its own typing event
        // shows a phantom second cursor.
        for (const peer of clients) {
          if (peer.id === client.id) continue;
          if (!peer.channels.has(channelId)) continue;
          send(peer, type, { channelId, userId: client.userId });
        }
        return;
      }

      default:
        send(client, 'error', { code: 'unknown_type', message: `Unsupported frame type: ${type}` });
    }
  }

  return {
    connectionCount: () => clients.size,
    close: async () => {
      clearInterval(heartbeat);
      unsubscribeBus();
      unsubscribePresence();
      for (const client of clients) client.socket.terminate();
      clients.clear();
      resetPresence();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

/** Channel ids the user may subscribe to, because they are in the owning team. */
async function allowedChannelIds(userId: string, requested: string[]): Promise<string[]> {
  if (requested.length === 0) return [];

  const rows = await prisma.channel.findMany({
    where: { id: { in: requested }, team: { members: { some: { userId } } } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Meeting ids the user may subscribe to, because they are a participant in one. */
async function allowedMeetingIds(userId: string, requested: string[]): Promise<string[]> {
  if (requested.length === 0) return [];

  const rows = await prisma.meeting.findMany({
    where: { id: { in: requested }, participants: { some: { userId } } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

function isOwnMessage(message: unknown, client: Client): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { authorId?: unknown }).authorId === client.userId
  );
}

function send(client: Client, type: string, payload: unknown): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  try {
    client.socket.send(JSON.stringify({ type, payload }));
  } catch {
    // A send that throws means the socket is gone; `close` will clean it up.
  }
}

function rejectUpgrade(socket: { write: (chunk: string) => void; destroy: () => void }, status: number, text: string): void {
  const body = `${text}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\n` +
      'Content-Type: text/plain\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
}

export { PATH as WS_PATH };
