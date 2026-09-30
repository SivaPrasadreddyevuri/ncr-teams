/**
 * HTTP entrypoint.
 *
 * `load-env` is imported first, before anything reads `config`. ES module
 * evaluation order guarantees it runs to completion before `config.js` is
 * evaluated, which is what lets `config` validate at import time.
 */

import './load-env.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { pruneExpiredSessions } from './auth/session-store.js';
import { attachRealtime } from './realtime/server.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`[server] listening on http://127.0.0.1:${config.PORT} (${config.NODE_ENV})`);
});

// Attached to the same server rather than a second listener: one process, one
// port and one origin to allow, which matters because the free-tier instance
// sleeps when idle.
const realtime = attachRealtime(server);

/**
 * Expired sessions are pruned hourly.
 *
 * `resolveSession` already deletes a row when it notices it is stale, so this is
 * only clearing up sessions nobody ever presented again -- a user who closed
 * the tab and never came back.
 */
const pruneTimer = setInterval(
  () => {
    void pruneExpiredSessions().catch((error: unknown) => {
      console.error('[prune] failed', error);
    });
  },
  60 * 60 * 1000,
);
pruneTimer.unref();

/**
 * Graceful shutdown.
 *
 * A platform restart sends SIGTERM. Without this the process is killed with
 * connections open and in-flight requests cut off; worse, the pooled Prisma
 * connection is dropped without being closed, which can leave the server holding
 * a connection that takes a moment to release.
 *
 * `unref`'d timers and a hard deadline, because a shutdown that hangs forever is
 * worse than one that gives up: Render SIGKILLs after a grace period anyway, and
 * a process that ignores SIGTERM makes that the only outcome.
 */
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error('[server] shutdown timed out, exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  clearInterval(pruneTimer);

  server.close(() => {
    void realtime.close().then(() => prisma.$disconnect()).finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
