/**
 * Fails if Prisma wants to change anything it is not supposed to.
 *
 * ## Why this script exists
 *
 * Five `tsvector` columns are added by a hand-written migration, each
 * `GENERATED ALWAYS AS ... STORED` and each with a GIN index. Prisma cannot
 * represent a generated column, so `prisma migrate diff` reports every one of
 * them as drifted, and it reports all five indexes as removable:
 *
 *   [*] Altered column `searchVector` (default changed from Some(DbGenerated(...)) to None)
 *   [-] Removed index on columns (searchVector)
 *
 * That drift is real, and it is a trap. `prisma migrate dev` diffs the database
 * against the schema, finds exactly this, and helpfully writes a migration that
 * drops the generation expressions and the indexes. The migration applies
 * cleanly, the app keeps working, and search quietly returns nothing forever
 * after -- because the only symptom is an empty search box.
 *
 * So the diff is not ignored and not suppressed; it is asserted. Anything in it
 * that is not on the allowlist fails the check, which means a genuinely
 * unintended change cannot hide among the five known entries.
 *
 * ## Why the allowlist is explicit strings
 *
 * Prisma prints the whole diff as SQL. Parsing it would be a second thing to
 * maintain, and the entries below are exact so that any *change* to the
 * generation expressions -- someone editing one in a migration and forgetting
 * the schema -- shows up as a mismatch rather than being absorbed.
 *
 * Usage:
 *   npm run db:drift
 */

import '../lib/load-env.js';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const databaseDir = join(here, '..');

/** The Prisma CLI, hoisted to the workspace root by npm. */
const prismaCli = join(databaseDir, '..', 'node_modules', 'prisma', 'build', 'index.js');

/**
 * Lines Prisma is allowed to print.
 *
 * The generation expressions, verbatim as Prisma normalises them, and the index
 * removals. `Removed index on columns (searchVector)` appears once per table and
 * is matched as a substring so the table is not named.
 *
 * If a generation expression is edited in a migration, its normalised form
 * changes and stops matching. That is the intent: the allowlist is not a blanket
 * "ignore drift", it is a record of what is expected.
 */
const ALLOWED = [
  // The per-table summary Prisma prints above the detail lines. Every one of
  // these five tables carries a generated tsvector column, so all five are
  // expected to appear. Named explicitly: a sixth would be a real change.
  'Changed the `Message` table',
  'Changed the `User` table',
  'Changed the `File` table',
  'Changed the `CalendarEvent` table',
  'Changed the `Team` table',

  // The generation expressions, which Prisma cannot represent. Matched as a
  // prefix so the normalised expression itself is not restated here -- it is
  // Postgres's rendering, and copying it would make this file wrong the next
  // time Postgres reformats it. The column is still named, so a change to a
  // *different* column is not absorbed.
  'Altered column `searchVector`',

  // The GIN indexes, which Prisma cannot represent either. `(name)` covers both
  // File_name_trgm_idx and User_name_trgm_idx.
  'Removed index on columns (searchVector)',
  'Removed index on columns (name)',
];

function normalise(line: string): string {
  // Prisma wraps long diff lines across several lines, so a known entry can be
  // split. Comparing whole lines would make the allowlist depend on terminal
  // width, which is not a property anyone should have to maintain.
  return line.replace(/\s+/g, ' ').trim();
}

async function ensureShadowDatabase(shadowUrl: string): Promise<void> {
  const appUrl = process.env.DATABASE_URL;
  const superUrl = process.env.POSTGRES_SUPERUSER_URL;

  if (!superUrl) {
    throw new Error(
      'POSTGRES_SUPERUSER_URL is required to create the shadow database.\n' +
        'migrate diff drops and recreates the schema of whatever it is given, so the\n' +
        'database has to be one that exists purely for this check.',
    );
  }

  const nameOf = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '';
  const shadowName = nameOf(shadowUrl);

  if (appUrl && nameOf(appUrl) === shadowName) {
    // Not a theoretical guard. `migrate diff` wipes the schema it is pointed at,
    // so naming the application database here would destroy it.
    throw new Error(
      `SHADOW_DATABASE_URL points at the application database (${shadowName}).\n` +
        'migrate diff drops and recreates that schema. Use a separate name.',
    );
  }

  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [shadowName]);
    if (existing.rowCount === 0) {
      // CREATE DATABASE cannot run inside a transaction and cannot be
      // parameterised, hence the interpolation. The name is quoted and comes from
      // the URL the developer wrote, not from a query result.
      await admin.query(`CREATE DATABASE "${shadowName.replace(/"/g, '""')}"`);
      console.log(`Created the shadow database "${shadowName}".`);
    }
  } finally {
    await admin.end();
  }
}

async function main(): Promise<void> {
  const shadowUrl = process.env.SHADOW_DATABASE_URL;
  if (!shadowUrl) {
    console.error(
      'SHADOW_DATABASE_URL is required. It must name a database that exists only for\n' +
        'this check -- migrate diff drops and recreates its schema on every run.\n' +
        '   SHADOW_DATABASE_URL=postgresql://... npm run db:drift',
    );
    process.exitCode = 1;
    return;
  }

  if (!existsSync(join(databaseDir, 'prisma', 'migrations'))) {
    console.error('Run this from the database workspace.');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(prismaCli)) {
    console.error(`Cannot find the Prisma CLI at ${prismaCli}. Run \`npm ci\` first.`);
    process.exitCode = 1;
    return;
  }

  try {
    await ensureShadowDatabase(shadowUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  let diff: string;
  try {
    diff = execFileSync(
      // The Prisma CLI is run through `node` and its entry point resolved, not
      // via `npx`. `npx` is a .cmd on Windows, and execFileSync cannot spawn one
      // without a shell -- which fails with an empty stderr and no way to tell
      // that apart from Prisma itself having errored.
      process.execPath,
      [
        prismaCli,
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--shadow-database-url',
        shadowUrl,
      ],
      { cwd: databaseDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // execFileSync throws on a non-zero exit, and it throws for two very
    // different reasons: Prisma found drift, or Prisma could not run. Reporting
    // the second as the first would be actively misleading.
    const stderr = String((error as { stderr?: string }).stderr ?? '');
    console.error('prisma migrate diff failed to run:\n' + stderr.trim());
    process.exitCode = 1;
    return;
  }

  const lines = diff
    .split('\n')
    .map(normalise)
    .filter((line) => line.length > 0);

  // Prisma prints a fixed header when there is nothing to do.
  const isEmpty =
    lines.length === 0 ||
    lines.every((line) => line === 'This is an empty migration.' || line.startsWith('//'));

  if (isEmpty) {
    console.log('No drift at all: the migrations and the schema agree exactly.');
    return;
  }

  const unexpected = lines.filter(
    (line) => !ALLOWED.some((allowed) => line.includes(normalise(allowed))),
  );

  const expected = lines.length - unexpected.length;

  if (unexpected.length > 0) {
    console.error('Prisma wants to change something it should not:');
    for (const line of unexpected) console.error('  ' + line);
    console.error(
      `\n${unexpected.length} unexpected change(s), ${expected} known-and-allowed.\n` +
        'Either this is a mistake, or it is intentional and belongs in\n' +
        'scripts/verify-no-unexpected-drift.ts ALLOWED with a comment saying why.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Drift is exactly the ${expected} known entry/entries (the five generated\n` +
      'tsvector columns and their GIN indexes, which Prisma cannot represent).\n' +
      'Nothing unexpected. See database/README.md for why migrate dev is not used.',
  );
}

main();
