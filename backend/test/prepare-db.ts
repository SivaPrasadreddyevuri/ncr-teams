/**
 * Creates and prepares the test database.
 *
 * Runs as `pretest`, before the suite. Creates the database if it is missing,
 * then applies the real migrations and the real seed by invoking the same
 * commands a developer runs -- rather than reimplementing either here. A harness
 * that builds its own schema can pass while the actual migration is broken; this
 * way the suite exercises the shipped artefacts.
 *
 * Migrations run against `DIRECT_DATABASE_URL` because DDL and session state
 * cannot go through a transaction pooler.
 */

import './setup-env.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { testUrl } from './setup-env.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const databaseDir = `${repoRoot.replace(/\/$/, '')}/database`;

const prismaCli = `${repoRoot.replace(/\/$/, '')}/node_modules/prisma/build/index.js`;
const seedScript = `${databaseDir}/prisma/seed.ts`;

/**
 * The target is `testUrl` from setup-env, not a name derived here.
 *
 * Deriving it in both places is how they drift: `setup-env` decides where the
 * suite reads from, and if this file computed the name independently the two
 * could quietly disagree -- the suite would then run against a database this
 * function never created, and fail with "relation does not exist" in a way that
 * looks like a migration bug.
 */
async function ensureDatabase() {
  // Connect to the maintenance database: CREATE DATABASE cannot run inside the
  // database it would create.
  const target = new URL(testUrl);
  const name = target.pathname.replace(/^\//, '');
  target.pathname = '/postgres';

  const client = new Client({ connectionString: target.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`[test-db] created ${name}`);
    } else {
      console.log(`[test-db] reusing ${name}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Runs a command with no shell.
 *
 * The repository path contains spaces, and a `.cmd` shim would need
 * `shell: true` to be executable at all -- so the Prisma CLI's JavaScript entry
 * is invoked directly through node instead. That keeps arguments intact and
 * avoids quoting problems entirely.
 */
function runNode(args: string[], cwd: string) {
  execFileSync(process.execPath, args, {
    cwd,
    // `pipe` rather than `inherit`, so Prisma's output does not bury the test
    // run's own. It is surfaced on failure below.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // The seed refuses to truncate a populated database, which is right for
      // ncr_teams and useless here: ncr_teams_test is disposable and is
      // re-seeded before every run. Scoped to the child process so it cannot
      // leak into a real seeding run.
      SEED_ALLOW_WIPE: 'true',
    },
    encoding: 'utf8',
  });
}

async function main() {
  await ensureDatabase();

  console.log('[test-db] applying migrations');
  runNode([prismaCli, 'migrate', 'deploy'], databaseDir);

  console.log('[test-db] seeding');
  // The seed loads database/.env through dotenv, which does not overwrite
  // variables already in the environment -- so the test URL set by setup-env
  // wins, and the development database is not touched.
  runNode(['--import', 'tsx', seedScript], `${repoRoot.replace(/\/$/, '')}/backend`);

  console.log('[test-db] ready');
}

try {
  await main();
} catch (error: unknown) {
  const failure = error as { stdout?: string; stderr?: string; message?: string };
  if (failure.stdout) process.stdout.write(failure.stdout);
  if (failure.stderr) process.stderr.write(failure.stderr);
  console.error('[test-db] failed to prepare:', failure.message ?? error);
  process.exit(1);
}
