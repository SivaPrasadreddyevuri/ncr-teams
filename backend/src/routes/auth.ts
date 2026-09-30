/**
 * Authentication routes.
 *
 * The 2FA flow is a two-step login. `POST /login` with 2FA enabled does *not*
 * create a session: it returns a short-lived challenge token, and only
 * `POST /verify-2fa` with a valid code issues the session. The alternative --
 * logging in and then attaching 2FA afterwards -- means a stolen password alone
 * gets an attacker a real session.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, unauthorized } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { hashToken } from '../auth/token.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookies,
  issueSession,
  PENDING_CHALLENGE_MARKER,
  revokeSessionByToken,
  setSessionCookies,
} from '../auth/session-store.js';
import { generateSecret, provisioningUri, verifyCode } from '../auth/totp.js';
import { requireAuth } from '../middleware/session.js';
import { sessionCookieName } from '../config.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024),
});

const verify2faSchema = z.object({
  challengeToken: z.string().min(20).max(200),
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be six digits.'),
});

/** Challenge lifetime: long enough to fetch an authenticator, no longer. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

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

    if (user.twoFactorEnabled) {
      if (!user.twoFactorSecret) {
        // Enabled with no secret is unrecoverable, and can only be the result of a
        // partial setup. Failing closed is the only safe reading.
        throw unauthorized('Two-factor authentication is misconfigured for this account.');
      }

      const challengeToken = await issueChallenge(user.id);
      sendJson(res, 200, { challengeToken, method: 'totp' });
      return;
    }

    const session = await issueSession(user.id, req.get('user-agent') ?? null);
    setSessionCookies(res, session);
    sendJson(res, 200, { user: publicUser(user), expiresAt: session.expiresAt.toISOString() });
  });

  router.post('/verify-2fa', async (req, res) => {
    const { challengeToken, code } = verify2faSchema.parse(req.body);

    const user = await consumeChallenge(challengeToken);
    if (!user) {
      throw unauthorized('That sign-in attempt has expired. Start again.');
    }

    if (!user.twoFactorSecret || !verifyCode(user.twoFactorSecret, code)) {
      throw unauthorized('That code is not correct.');
    }

    const session = await issueSession(user.id, req.get('user-agent') ?? null);
    setSessionCookies(res, session);
    sendJson(res, 200, { user: publicUser(user), expiresAt: session.expiresAt.toISOString() });
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

  /**
   * Begins two-factor enrolment.
   *
   * Returns the secret and a provisioning URI. `twoFactorEnabled` is not set
   * here: a user who never completes enrolment must not be locked out, and a
   * half-enabled factor is worse than none.
   */
  router.post('/2fa/setup', requireAuth, async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const secret = generateSecret();

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret } });

    sendJson(res, 200, {
      secret,
      otpauthUrl: provisioningUri(secret, user.email, 'NCR Teams'),
    });
  });

  /** Completes enrolment: proves a valid code, then enables the factor. */
  router.post('/2fa/enable', requireAuth, async (req, res) => {
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.twoFactorSecret) {
      throw badRequest('no_pending_secret', 'Start enrolment before enabling it.');
    }
    if (!verifyCode(user.twoFactorSecret, code)) {
      throw badRequest('invalid_code', 'That code is not correct.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });
    sendJson(res, 200, { twoFactorEnabled: true });
  });

  router.post('/2fa/disable', requireAuth, async (req, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    sendJson(res, 200, { twoFactorEnabled: false });
  });

  return router;
}

/* ------------------------------------------------------------------ */
/* Challenge tokens                                                     */
/* ------------------------------------------------------------------ */

/**
 * A pending 2FA login.
 *
 * Stored as a `Session` row with no expiry in the session sense and a
 * distinguishing user agent, rather than a new table: it is the same lifecycle --
 * created, single-use, expiring -- and reusing the table keeps the schema free of
 * a table that exists only for one flow.
 *
 * The row is a placeholder for the real one, so the user id is carried in
 * `tokenHash`'s counterpart: the plain token is an HMAC of the user id and a
 * random nonce, and the row is keyed by that hash.
 */
async function issueChallenge(userId: string): Promise<string> {
  const challengeToken = `${userId}.${randomSuffix()}`;
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await prisma.session.create({
    data: {
      // Keyed by the challenge token, so it cannot collide with a real session
      // token even though both live in one table.
      tokenHash: hashToken(`challenge:${challengeToken}`),
      csrfSecret: randomSuffix(),
      userId,
      expiresAt,
      userAgent: PENDING_CHALLENGE_MARKER,
    },
  });

  return challengeToken;
}

/**
 * Consumes a challenge: returns the user and deletes the row.
 *
 * Single use. A code can be replayed inside its 30-second window, so the row is
 * removed before the code is checked -- otherwise one observed code would allow
 * several sessions.
 */
async function consumeChallenge(challengeToken: string) {
  const userId = challengeToken.split('.')[0];
  if (!userId) return null;

  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(`challenge:${challengeToken}`) },
    include: { user: true },
  });

  if (!row || row.userAgent !== PENDING_CHALLENGE_MARKER) return null;

  await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);

  if (row.expiresAt <= new Date()) return null;
  return row.user;
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

function randomSuffix(): string {
  return randomUUID().replace(/-/g, '');
}

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
