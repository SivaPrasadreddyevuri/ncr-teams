/**
 * Health check.
 *
 * Render probes this to decide whether to route traffic to the instance, so it
 * must be unauthenticated and must not be slow.
 */

import { Router } from 'express';
import { sendJson } from '../serialise.js';
import { prisma } from '../db.js';

export function healthRouter() {
  const router = Router();

  /**
   * Liveness only. Cheap, and answers "is the process up", which is what a load
   * balancer is asking. It deliberately does not touch the database: a
   * dependency blip would then mark a perfectly good instance as unhealthy and
   * take it out of rotation, which is the wrong response to a database problem.
   */
  router.get('/health', (_req, res) => {
    sendJson(res, 200, { status: 'ok', uptime: Math.round(process.uptime()) });
  });

  /**
   * Readiness. Checks the database round-trips, for a manual check or for a
   * deploy step that wants to wait for connectivity.
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
