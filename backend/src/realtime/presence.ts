/**
 * Presence.
 *
 * Who is online, derived from open WebSocket connections and deliberately not
 * persisted. A `Person.online` column would be wrong the moment someone closed a
 * tab, and nothing would ever write the `false`.
 *
 * In-process, so it describes one instance. With more than one instance a user
 * connected to each would appear twice, and the fix is the same Redis fan-out the
 * event bus documents. For a single instance this is exact.
 *
 * A user can hold several connections -- two tabs, or a phone and a laptop -- so
 * presence counts connections, not identities. A user is offline only when their
 * last connection closes.
 */

export type PresenceStatus = 'online' | 'away';

type Connection = { socketId: string; lastSeenAt: number };

/**
 * How long before a silent connection is treated as gone.
 *
 * Long enough to survive a laptop sleep, short enough that a user who force-quit
 * their browser does not show as online for a minute. The `ping`/`pong` in the
 * socket server keeps `lastSeenAt` fresh.
 */
export const PRESENCE_TTL_MS = 45_000;

const byUser = new Map<string, Set<Connection>>();
const lastEmit = new Map<string, PresenceStatus | 'offline'>();

export type PresenceListener = (userId: string, status: PresenceStatus | 'offline') => void;
const listeners = new Set<PresenceListener>();

export function onPresenceChange(listener: PresenceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(userId: string, status: PresenceStatus | 'offline') {
  // Only emit on a real transition. Without this, every heartbeat would tell every
  // client a user was online, which is noise at best and a client-side render loop
  // at worst.
  if (lastEmit.get(userId) === status) return;
  lastEmit.set(userId, status);
  for (const listener of listeners) listener(userId, status);
}

export function addConnection(userId: string, socketId: string, now = Date.now()): void {
  let connections = byUser.get(userId);
  if (!connections) {
    connections = new Set();
    byUser.set(userId, connections);
  }
  connections.add({ socketId, lastSeenAt: now });
  emit(userId, 'online');
}

export function removeConnection(userId: string, socketId: string): void {
  const connections = byUser.get(userId);
  if (!connections) return;

  for (const connection of connections) {
    if (connection.socketId === socketId) connections.delete(connection);
  }

  if (connections.size === 0) {
    byUser.delete(userId);
    lastEmit.delete(userId);
    emit(userId, 'offline');
  }
}

export function touchConnection(socketId: string, now = Date.now()): void {
  for (const connections of byUser.values()) {
    for (const connection of connections) {
      if (connection.socketId === socketId) connection.lastSeenAt = now;
    }
  }
}

/** Current status, treating a stale connection as gone. */
export function statusOf(userId: string, now = Date.now()): PresenceStatus | 'offline' {
  const connections = byUser.get(userId);
  if (!connections || connections.size === 0) return 'offline';

  const live = [...connections].filter((c) => now - c.lastSeenAt < PRESENCE_TTL_MS);
  if (live.length === 0) return 'offline';
  return 'online';
}

/** Everyone currently online, for a freshly connected client. */
export function onlineUserIds(now = Date.now()): string[] {
  return [...byUser.keys()].filter((userId) => statusOf(userId, now) !== 'offline');
}

/**
 * Drops connections not heard from within the TTL and reports them offline.
 *
 * Called on an interval by the socket server. Without it, a user who closed their
 * browser uncleanly -- power loss, a killed process, a dropped network -- would
 * stay online until the instance restarted.
 */
export function sweepStale(now = Date.now()): string[] {
  const dropped: string[] = [];

  for (const [userId, connections] of byUser) {
    for (const connection of [...connections]) {
      if (now - connection.lastSeenAt >= PRESENCE_TTL_MS) {
        connections.delete(connection);
        dropped.push(userId);
      }
    }
    if (connections.size === 0) byUser.delete(userId);
  }

  for (const userId of new Set(dropped)) {
    if (byUser.has(userId)) continue;
    lastEmit.delete(userId);
    emit(userId, 'offline');
  }

  return dropped;
}

/** Empties the registry. Used by the test harness between runs. */
export function reset(): void {
  byUser.clear();
  lastEmit.clear();
}
