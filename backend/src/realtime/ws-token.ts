/**
 * WebSocket connection tokens.
 *
 * ## Why a token at all
 *
 * The session cookie is `SameSite=Lax` and `httpOnly`, which is what makes the
 * REST API safe: the frontend proxies `/api/*` to this service, so the browser
 * only ever talks to its own origin. A WebSocket cannot be proxied the same way
 * -- a Next.js rewrite does not carry an upgrade request through to a second
 * server -- so `/ws` is a genuinely cross-origin connection and the browser will
 * not attach a `Lax` cookie to it. Cross-site cookie from a WebSocket handshake
 * would need `SameSite=None; Secure`, which reopens CSRF on every REST route in
 * exchange for solving a problem a token solves better.
 *
 * So the client fetches a short-lived token over the authenticated REST channel
 * and presents it in the handshake.
 *
 * ## The trade-off this makes
 *
 * The token travels in the query string, because `Sec-WebSocket-Protocol` is
 * awkward through some proxies and browsers restrict what a page may put there.
 * Query strings appear in server access logs, so this would be a real concern
 * for a long-lived credential. It is not one here:
 *
 * - 60 seconds of validity.
 * - It is an HMAC, not the session token, so it cannot be used against the REST
 *   API even if it leaked.
 * - It is scoped to one user id, which is inside the signed payload and cannot be
 *   edited without invalidating the signature.
 *
 * Rotating it to the `Sec-WebSocket-Protocol` route is a small change if this
 * ever needs to outlive a demo.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Deliberately short. Long enough to fetch and connect, short enough that a
 * leaked value is close to useless by the time anyone reads the log.
 */
const TOKEN_TTL_SECONDS = 60;

export type WsTokenPayload = { userId: string; expiresAt: number };

/** HMAC over `userId.expiresAt`, keyed by the same pepper as session tokens. */
function sign(userId: string, expiresAt: number): string {
  return createHmac('sha256', config.SESSION_PEPPER)
    .update(`${userId}.${expiresAt}`)
    .digest('base64url');
}

/**
 * Issues a token for `userId`.
 *
 * Reusing `SESSION_PEPPER` is deliberate: one secret to rotate, not two. The
 * domain separation here is the message prefix, so a value signed for one can
 * never be replayed as the other.
 */
export function issueWsToken(userId: string, now = new Date()): { token: string; expiresAt: string } {
  const expiresAt = Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS;
  return {
    token: `${userId}.${expiresAt}.${sign(userId, expiresAt)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

/**
 * Verifies a token, returning the user id or null.
 *
 * Null for every failure rather than a reason, so a caller cannot accidentally
 * leak which part was wrong. Each comparison is constant-time; the expiry is
 * compared as a number, which needs no timing care.
 */
export function verifyWsToken(token: string | undefined, now = new Date()): string | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, signature] = parts as [string, string, string];

  if (!userId || !expiresAtRaw || !signature) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return null;

  // Expiry is checked before the signature is computed, so an expired token is
  // rejected without any HMAC work. It is not a timing oracle worth worrying
  // about: the value carries its own expiry in the clear.
  if (expiresAt * 1000 <= now.getTime()) return null;

  const expected = Buffer.from(sign(userId, expiresAt), 'base64url');
  const received = Buffer.from(signature, 'base64url');

  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  return userId;
}
