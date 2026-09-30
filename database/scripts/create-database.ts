/**
 * Creates the application role and database.
 *
 * Why this exists instead of a `createdb` call: the PostgreSQL build in
 * `../pgsql` ships only `initdb`, `pg_ctl` and `postgres`. There is no
 * `psql` or `createdb` client, so the administrative SQL has to be issued
 * programmatically. `pg` talks the simple query protocol for parameterless
 * statements, which is what `CREATE DATABASE` requires -- it cannot run inside
 * a transaction block, and that is precisely the case where a parameterised
 * query would fail.
 *
 * Idempotent: safe to re-run. The role is created only if missing and the
 * password is reset either way, so a rotated credential does not require
 * dropping the database.
 *
 * Run with:  npm run db:bootstrap  (from the repository root)
 */

import '../lib/load-env.js';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
const superuserUrl = process.env.POSTGRES_SUPERUSER_URL;

if (!url || !superuserUrl) {
  console.error('DATABASE_URL and POSTGRES_SUPERUSER_URL must both be set. See database/.env.example.');
  process.exit(1);
}

const appDatabase = new URL(url).pathname.replace(/^\//, '');
const appUser = new URL(url).username;
const appPassword = decodeURIComponent(new URL(url).password);

/** `pg` parses a full postgres:// URI itself; do not strip the scheme. */
async function main() {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();

  try {
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
    if (role.rowCount === 0) {
      // Identifiers cannot be parameterised, so the role name is quoted
      // instead. It comes from a trusted local .env, never from a request.
      await client.query(`CREATE ROLE "${appUser}" LOGIN CREATEDB`);
      console.log(`created role ${appUser}`);
    } else {
      console.log(`role ${appUser} already exists`);
    }

    await client.query(`ALTER ROLE "${appUser}" PASSWORD '${appPassword.replace(/'/g, "''")}'`);

    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [appDatabase]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${appDatabase}" OWNER "${appUser}"`);
      console.log(`created database ${appDatabase}`);
    } else {
      console.log(`database ${appDatabase} already exists`);
    }

    await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${appDatabase}" TO "${appUser}"`);
    console.log('granted privileges');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
