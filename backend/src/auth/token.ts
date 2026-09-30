/**
 * Session tokens.
 *
 * The cookie carries a 256-bit random token. The database stores a *keyed hash*
 * of it, never the token, so a leaked database dump does not hand an attacker
 * usable session cookies.
 *
 * The keying is the part that matters. A bare SHA-256 of a 256-bit random value
 * is not really attackable -- there is no preimage to search for at that
 * entropy. HMAC with a server-held pepper is used anyway because it costs
 * nothing and means a database leak alone is not sufficient: the attacker also
 * needs SESSION_PEPPER, which never leaves the environment.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/** A fresh 256-bit token, base64url encoded. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The value stored in `Session.tokenHash`. */
export function hashToken(token: string): string {
  return createHmac('sha256', config.SESSION_PEPPER).update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on a hash leaks its length prefix through timing. The digests are fixed
 * length so the practical window is small, but the correct primitive costs
 * nothing and this is exactly the code where that argument belongs.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** CSRF secrets are compared the same way. */
export function generateCsrfSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfSecretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
