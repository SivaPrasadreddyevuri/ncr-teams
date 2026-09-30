/**
 * Session lifecycle.
 *
 * Sessions are rows, not self-contained tokens. A stateless JWT cannot be
 * revoked before it expires, so "sign out everywhere" and "this account is
 * compromised" would both be unimplementable. A row costs one indexed lookup
 * per authenticated request, which is the right trade.
 *
 * The `Session` table has no `userId` index problem: it is indexed on both
 * `userId` and `expiresAt`.
 */

import type { Response } from 'express';
import { prisma } from '../db.js';
import { config, csrfCookieName, isProduction, sessionCookieName } from '../config.js';
import { generateCsrfSecret, generateToken, hashToken } from './token.js';

const SESSION_TTL_MS = config.SESSION_TTL_SECONDS * 1000;

/**
 * Distinguishes a pending two-factor challenge from a live session.
 *
 * Both are rows in `Session`, so `resolveSession` must be able to tell them
 * apart; without this a challenge token presented as a cookie would authenticate.
 */
export const PENDING_CHALLENGE_MARKER = 'pending-2fa-challenge';

/** Deletes sessions that expired or were revoked more than a day ago. */
export async function pruneExpiredSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return count;
}

export type IssuedSession = { token: string; csrfSecret: string; expiresAt: Date };

/**
 * Creates a session row and returns the plaintext token.
 *
 * The plaintext exists only here and in the cookie: only its hash is persisted.
 * Revokes any existing session for the same user first, so signing in on a new
 * device ends the old session rather than accumulating them. That is a
 * single-session policy -- the simplest thing that cannot leak -- and the table
 * is ready for the multi-session variant if it is ever wanted.
 */
export async function issueSession(
  userId: string,
  userAgent: string | null,
  now = new Date(),
): Promise<IssuedSession> {
  await prisma.session.deleteMany({
    where: {
      userId,
      revokedAt: null,
      // Not a pending two-factor challenge. Those share this table, and
      // completing a sign-in must not silently cancel a second, still-valid
      // attempt from another device.
      userAgent: { not: PENDING_CHALLENGE_MARKER },
    },
  });

  const token = generateToken();
  const csrfSecret = generateCsrfSecret();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      csrfSecret,
      userId,
      userAgent: userAgent?.slice(0, 512) ?? null,
      expiresAt,
    },
  });

  return { token, csrfSecret, expiresAt };
}

/** Extends a session's expiry, for an active user. Sliding window. */
export async function touchSession(sessionId: string, now = new Date()): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
  });
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolves a cookie token to a live session with its user.
 *
 * An expired or revoked row is deleted as a side effect, so a stale cookie
 * cleans itself up instead of being re-checked on every request until something
 * prunes it.
 */
export async function resolveSession(token: string | undefined) {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  // A pending 2FA challenge shares this table but is not a session. Returning
  // null here is what stops a challenge token from authenticating.
  if (session.userAgent === PENDING_CHALLENGE_MARKER) return null;

  if (session.revokedAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return session;
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    // `lax` rather than `strict`: `strict` would not send the cookie when the
    // user arrives from an external link at all, which signs them out of a deep
    // link they just clicked.
    sameSite: 'lax',
    // Secure in production only, so the cookie works on http://localhost during
    // development. A browser ignores `Secure` cookies on plain HTTP, which
    // would silently produce a session that never persists.
    secure: isProduction,
    path: '/',
    maxAge: maxAgeMs,
  } as const;
}

/** Writes both cookies. The CSRF cookie is readable by JS by design. */
export function setSessionCookies(res: Response, session: IssuedSession): void {
  res.cookie(sessionCookieName, session.token, cookieOptions(SESSION_TTL_MS));
  res.cookie(csrfCookieName, session.csrfSecret, {
    ...cookieOptions(SESSION_TTL_MS),
    // The whole point is that the frontend reads this to echo it back in a
    // header. httpOnly would make the double-submit pattern impossible.
    httpOnly: false,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(sessionCookieName, { path: '/' });
  res.clearCookie(csrfCookieName, { path: '/' });
}
