/**
 * Authentication routes.
 *
 * Password only. Two-factor authentication was removed: the TOTP implementation
 * was correct and tested, but nothing in the app could turn the factor on, so
 * with the setup screen gone the login challenge was unreachable and the whole
 * path was dead code.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, unauthorized } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookies,
  issueSession,
  revokeSessionByToken,
  setSessionCookies,
} from '../auth/session-store.js';
import { requireAuth } from '../middleware/session.js';
import { sessionCookieName } from '../config.js';
import { issueWsToken } from '../realtime/ws-token.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024),
});

export function authRouter() {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });

    // Hash against a dummy value when the user does not exist, so a missing
    // account and a wrong password take comparable time. Without this, response
    // latency alone enumerates which emails are registered.
    const storedHash = user?.passwordHash ?? DUMMY_HASH;
    const passwordOk = await verifyPassword(storedHash, password);

    if (!user || !passwordOk) {
      // One message for both cases, deliberately.
      throw unauthorized('That email and password combination is not correct.');
    }

    // An invited account that has never set a credential cannot be signed in
    // to; it has to be activated first.
    if (user.mustChangePassword) {
      throw badRequest('password_change_required', 'Activate your account before signing in.');
    }

    const session = await issueSession(user.id, req.get('user-agent') ?? null);
    setSessionCookies(res, session);
    sendJson(res, 200, { user: publicUser(user), expiresAt: session.expiresAt.toISOString() });
  });

  /**
   * Issues a short-lived token for the WebSocket handshake.
   *
   * The session cookie cannot do this job: it is `SameSite=Lax`, and a WebSocket
   * to a different origin is a cross-site request, so the browser would not
   * attach it. See src/realtime/ws-token.ts for the full reasoning and the
   * query-string trade-off.
   */
  router.get('/ws-token', requireAuth, (req, res) => {
    const { token, expiresAt } = issueWsToken(req.user!.id);
    sendJson(res, 200, {
      token,
      expiresAt,
      // 60 seconds, so a value sitting in a server access log is close to
      // worthless by the time anyone reads it.
      expiresInSeconds: 60,
    });
  });

  router.post('/logout', async (req, res) => {
    const token = req.cookies?.[sessionCookieName] as string | undefined;
    if (token) await revokeSessionByToken(token);
    clearSessionCookies(res);
    // 204: nothing to say, and a body would only tempt a client to parse one.
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    sendJson(res, 200, { user: req.user });
  });

  return router;
}

/**
 * A real Argon2id hash of a value nobody knows.
 *
 * Spending comparable time when the account does not exist is the point, and
 * that only works if the comparison actually performs the same work. A
 * hand-written or malformed hash would fail to parse and return almost
 * immediately, reintroducing exactly the timing difference this hides -- while
 * still looking like it was defended.
 *
 * Generated once at import, so a real hash cannot be mistaken for a credential
 * by anything scanning the repository, and it can never be used to sign in.
 */
const DUMMY_HASH = await hashPassword(randomUUID());

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  departmentId: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    departmentId: user.departmentId,
  };
}
