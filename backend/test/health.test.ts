/**
 * Health.
 *
 * This is the endpoint a deployment is judged by, and it had no test at all --
 * which is how it came to return `{"status":"ok"}` against a database that did not
 * exist. A deploy with no migrations applied looked healthy.
 *
 * The unreachable-database branch is *not* asserted here. `createApp()` builds
 * routes over the shared Prisma singleton, so reaching it would mean injecting a
 * broken client into every route -- a dependency-injection refactor of the whole
 * app for one test. The branch is a try/catch around `SELECT 1`, and the honest
 * statement is that it is exercised by the deploy runbook rather than by a test.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, startHarness, type Harness } from './helpers.js';
import { ensureTestPasswords } from './fixtures.js';

let harness: Harness;

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
});

after(async () => {
  await harness?.close();
});

type Health = {
  status: string;
  uptime: number;
  db: 'ready' | 'unreachable';
  migrationsApplied: boolean;
};

describe('health', () => {
  it('reports the database as reachable', async () => {
    const response = await harness.client().get('/api/health');
    assert.equal(response.status, 200);

    const body = await readJson<Health>(response);
    assert.equal(body.status, 'ok');
    assert.equal(body.db, 'ready', 'the database is up in the test environment');
  });

  it('states whether migrations have been applied', async () => {
    // The field a human checks after a first deploy. A service that boots without
    // ever having run `db:deploy` returns 200 here and looks fine; reading this
    // field is the difference between "deployed" and "usable".
    const body = await readJson<Health>(await harness.client().get('/api/health'));
    assert.equal(
      body.migrationsApplied,
      true,
      'the suite only runs against a migrated database, so this must be true',
    );
  });

  it('reports an uptime that increases', async () => {
    const first = await readJson<Health>(await harness.client().get('/api/health'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await readJson<Health>(await harness.client().get('/api/health'));

    assert.ok(typeof first.uptime === 'number' && first.uptime >= 0);
    assert.ok(second.uptime >= first.uptime);
  });

  it('answers readiness separately, and agrees with liveness when healthy', async () => {
    const live = await readJson<Health>(await harness.client().get('/api/health'));
    const response = await harness.client().get('/api/health/ready');

    assert.equal(response.status, 200);
    assert.deepEqual(
      await readJson<{ status: string }>(response),
      { status: 'ready' },
    );
    // The two endpoints must not disagree, or one of them is lying. This is the
    // invariant that the old shape broke: liveness said ok while readiness said no.
    assert.equal(live.db, 'ready');
  });

  it('needs no session, because Render does not have one', async () => {
    const response = await harness.client().get('/api/health');
    assert.equal(response.status, 200, 'an unauthenticated probe must not be a 401');

    const ready = await harness.client().get('/api/health/ready');
    assert.equal(ready.status, 200);
  });
});
