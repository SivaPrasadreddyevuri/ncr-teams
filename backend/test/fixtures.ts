/**
 * Test fixtures.
 *
 * The seed deliberately leaves `passwordHash` null -- it was written before a
 * hash algorithm had been chosen. The suite sets one here rather than teaching
 * the seed about passwords, which would put an auth dependency in the
 * `database` workspace and change what a fresh clone contains.
 *
 * One hash is computed and shared by every user. Argon2id salts internally, so
 * each user still gets a distinct stored value; sharing the *input* across
 * fixtures saves a few hundred milliseconds of the suite's runtime without
 * weakening anything that is being tested.
 */

import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/password.js';

export const TEST_PASSWORD = 'integration-test-password';

/** Emails from the seed. `u1` is EMPLOYEE and `u7` is the HR admin. */
export const EMPLOYEE = 'alex@company.com';
export const HR_ADMIN = 'priya@company.com';
export const SECOND_EMPLOYEE = 'sarah@company.com';

let prepared = false;

export async function ensureTestPasswords(): Promise<void> {
  if (prepared) return;
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await prisma.user.updateMany({ data: { passwordHash, mustChangePassword: false } });
  prepared = true;
}

/** Removes every live session, so one test cannot leak into the next. */
export async function clearSessions(): Promise<void> {
  await prisma.session.deleteMany({});
}
