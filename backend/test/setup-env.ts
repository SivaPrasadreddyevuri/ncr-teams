/**
 * Test environment.
 *
 * Imported first by every test file, before anything reads `config` or builds
 * the Prisma client. Both of those happen at import time, so the variables have
 * to be in place before the first import resolves -- hence a side-effect module
 * rather than a setup call.
 *
 * The tests run against `ncr_teams_test`, never `ncr_teams`. Tests truncate the
 * database to set up their fixtures, and pointing them at the development
 * database would destroy the demo data.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';

/**
 * Read from the real `.env` so the test database lives on the same server, and
 * only the database name differs. If a developer points the service at Neon,
 * their tests follow it there rather than silently testing a different machine.
 */
loadDotenv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const TEST_DATABASE = 'ncr_teams_test';

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const adminUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error('Neither DIRECT_DATABASE_URL nor DATABASE_URL is set; cannot locate the test database.');
}

const testUrl = withDatabase(adminUrl, TEST_DATABASE);

process.env.DATABASE_URL = testUrl;
process.env.DIRECT_DATABASE_URL = testUrl;

// A fixed pepper, so a session token created in a test verifies in another test
// in the same run, and so a fixture is reproducible.
process.env.SESSION_PEPPER = process.env.SESSION_PEPPER ?? 'test-pepper-fixed-value-32-chars-long';
process.env.CORS_ORIGINS = '';

export { TEST_DATABASE, testUrl };
