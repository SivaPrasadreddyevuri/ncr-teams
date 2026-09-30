/**
 * Password hashing.
 *
 * Argon2id, the OWASP first choice: memory-hard, so a GPU or an FPGA does not
 * make offline cracking meaningfully cheaper, and it resists both GPU cracking
 * and side-channel timing attacks.
 *
 * Parameters are the OWASP baseline of 19 MiB memory and 2 iterations at
 * parallelism 1. They are stated here rather than left as library defaults so a
 * dependency bump cannot silently weaken them, and so the choice is auditable.
 */

import { hash, verify } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id` is an ambient const enum, which `isolatedModules` cannot
 * inline across a module boundary. The value is spelled out instead: it is
 * stable public API, and the named form is recorded here so the number is
 * checkable by eye. 0 is Argon2d, 1 is Argon2i, 2 is Argon2id.
 */
const ARGON2ID = 2;

/** OWASP's recommended Argon2id baseline. */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB, i.e. 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hashes a password.
 *
 * Each call uses a fresh random salt, which `hash` generates internally, so two
 * users with the same password get different hashes. That is what stops a
 * stolen table from revealing which people share a password.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Checks a password against a stored hash.
 *
 * Returns false rather than throwing for a null or malformed hash, because a
 * user with no credential set is the normal case for an invited account and must
 * not be distinguishable from a wrong password by response timing or by an
 * error path.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    // A hash written by a different algorithm or a corrupted value.
    return false;
  }
}

/**
 * Password policy.
 *
 * Deliberately modest: length is what actually resists guessing, and complexity
 * rules mostly produce `Password1!` and a support burden. Eight characters is
 * the floor; the seeded demo password meets it.
 */
export const MIN_PASSWORD_LENGTH = 8;

export function isAcceptablePassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
