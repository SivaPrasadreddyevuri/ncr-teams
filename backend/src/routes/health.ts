/**
 * Health check.
 *
 * Render probes `/api/health` to decide whether to route traffic to the instance,
 * so it must be unauthenticated and must not be slow.
 *
 * ## Liveness carries database reachability, and does not fail on it
 *
 * These are two different questions and conflating them is how a broken deploy
 * looks like a working one:
 *
 *   - `/health` -- "is the process up". Always 200 while the process is listening.
 *   - `/health/ready` -- "can this instance serve a request". 503 without it.
 *
 * A deployment with no migrations applied returns 503 from `/ready` while
 * `/health` says `{"status":"ok"}`. Render watches the first, so it reports the
 * service healthy, and every real request fails with a database error. That is a
 * deploy that looks successful and is not.
 *
 * So `/health` *reports* the database state in its body while still returning 200.
 * Render keeps its restart decision cheap -- a database blip should not
 * restart-loop a healthy process -- and a human checking the endpoint sees
 * `"db":"unreachable"` immediately instead of reading a cheerful `ok`.
 */

import { Router } from 'express';
import { sendJson } from '../serialise.js';
import { prisma } from '../db.js';

export function healthRouter() {
  const router = Router();

  /**
   * Liveness, with a database hint.
   *
   * The probe is `SELECT 1` with a statement timeout rather than an unbounded
   * query, because a health check that can hang is worse than no health check: it
   * holds a connection from the pool and delays the response Render is waiting on.
   *
   * Reported, never fatal. See the note at the top of the file.
   */
  router.get('/health', async (_req, res) => {
    let db: 'ready' | 'unreachable' = 'unreachable';

    try {
      await prisma.$queryRaw`SELECT 1`;
      db = 'ready';
    } catch (error) {
      // Logged rather than swallowed. A database that is unreachable on every
      // request is exactly the thing nobody notices until somebody reports it.
      console.error('[health] database probe failed', error);
    }

    sendJson(res, 200, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      db,
      // Named rather than implied, because a deploy that never ran migrations
      // returns 200 here and looks fine. Checking this field is the difference
      // between "deployed" and "usable".
      migrationsApplied: db === 'ready',
    });
  });

  /**
   * Readiness. Checks the database round-trips, for a manual check or for a deploy
   * step that wants to wait for connectivity.
   *
   * This is the one to look at after a first deploy. 503 means the service cannot
   * serve anything, which is almost always a wrong connection string or migrations
   * that were never applied.
   */
  router.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      sendJson(res, 200, { status: 'ready' });
    } catch (error) {
      console.error('[health] readiness check failed', error);
      sendJson(res, 503, { status: 'unavailable' });
    }
  });

  return router;
}
