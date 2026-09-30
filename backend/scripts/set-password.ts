/**
 * Sets a password for a user.
 *
 * The seeded users have a null `passwordHash`, because they are display data and
 * no hash algorithm had been chosen when they were written. This is how one
 * becomes able to sign in.
 *
 * It lives here rather than in the seed or in the database workspace because the
 * hashing code is here, and the four folders are meant to hold one concern each:
 * importing the backend's auth module from `database/` would cross that line.
 *
 * Usage:
 *   npm run user:password -- --email alex@company.com
 *   npm run user:password -- --email alex@company.com --password 'correct horse'
 *   npm run user:password -- --email alex@company.com --random
 *
 * With no password and no --random it prompts, so a password does not end up in
 * the shell history.
 */

import '../src/load-env.js';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { prisma } from '../src/db.js';
import { hashPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } from '../src/auth/password.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  // Bulk mode: one shared password for every user, for a demo where a reviewer
  // needs to sign in as whoever they are looking at. Printed at the end, because
  // a password nobody knows is not a demo credential.
  if (flag('all')) {
    const password = arg('password') ?? (flag('random') ? randomBytes(12).toString('base64url') : undefined);
    if (!password) {
      console.error('Usage: npm run user:password -- --all --password <pw> | --random');
      process.exitCode = 1;
      return;
    }
    if (!isAcceptablePassword(password)) {
      console.error(`Too short: ${MIN_PASSWORD_LENGTH} characters minimum.`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    const { count } = await prisma.user.updateMany({
      data: { passwordHash, mustChangePassword: false },
    });

    console.log(`Set the same password for ${count} users.`);
    if (flag('random')) console.log(`  password: ${password}`);
    return;
  }

  const email = arg('email')?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run user:password -- --email <address> [--password <pw> | --random]');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.error(`No user with the email ${email}.`);
    process.exitCode = 1;
    return;
  }

  let password = arg('password');

  if (!password && flag('random')) {
    // base64url of 12 bytes: 16 characters, enough entropy that the value is not
    // guessable, and short enough to read aloud or paste into a form.
    password = randomBytes(12).toString('base64url');
  }

  if (!password) {
    password = await prompt(`New password for ${user.email} (min ${MIN_PASSWORD_LENGTH}): `);
  }

  if (!isAcceptablePassword(password)) {
    console.error(`Too short: ${MIN_PASSWORD_LENGTH} characters minimum.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  // Setting a password completes an invitation, so the activation flag is
  // cleared here. Leaving it set would make the account refuse to sign in even
  // though it now has a valid credential.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  console.log(`Password set for ${user.email} (${user.name}).`);
  if (flag('random')) {
    console.log(`  password: ${password}`);
    console.log('  This is the only time it is shown.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
