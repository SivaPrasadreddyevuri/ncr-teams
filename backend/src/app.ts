/**
 * The Express application.
 *
 * Kept separate from `server.ts` so tests can mount the app on an ephemeral port
 * without a separate code path. Anything that listens lives in `server.ts`.
 */

import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config, corsOrigins, isProduction } from './config.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { attachSession, requireCsrf } from './middleware/session.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { teamsRouter } from './routes/teams.js';
import { channelsRouter } from './routes/channels.js';
import { departmentsRouter } from './routes/departments.js';
import { activityRouter } from './routes/activity.js';

export function createApp(): Express {
  const app = express();

  // Render terminates TLS and forwards one hop, so the client address is the
  // last entry in X-Forwarded-For rather than the socket.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  /**
   * Credentialed CORS, development only.
   *
   * In production the frontend proxies `/api/*` to this service, so from the
   * browser both are the same origin and no cross-origin request happens at all.
   * `credentials: true` here is only for local development, where the frontend
   * is on :3000 and this service on :4000.
   *
   * The origin list is explicit rather than reflecting the request, because a
   * reflecting CORS policy that allows credentials is the same thing as no
   * policy at all.
   */
  if (!isProduction) {
    app.use(
      cors({
        origin: corsOrigins,
        credentials: true,
      }),
    );
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(attachSession);
  // After attachSession, so a session is known before a token is checked, and
  // before every route, so a new endpoint is CSRF-protected by default rather
  // than by remembering to add it.
  app.use(requireCsrf);

  app.use('/api', healthRouter());
  app.use('/api/auth', authRouter());
  app.use('/api/users', usersRouter());
  app.use('/api/teams', teamsRouter());
  app.use('/api/channels', channelsRouter());
  app.use('/api/departments', departmentsRouter());
  app.use('/api/activity', activityRouter());

  // A path-free handler, so this does not depend on Express 5's wildcard syntax
  // (path-to-regexp v8 removed bare `*` in favour of named segments).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
