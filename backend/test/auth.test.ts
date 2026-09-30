/**
 * Authentication and session behaviour.
 *
 * The failure modes worth protecting against here are the ones that are
 * invisible until exploited: a session that outlives logout, a CSRF check that
 * silently passes, a cookie without `httpOnly`, an unknown account answering
 * differently from a wrong password.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, startHarness, type Harness } from './helpers.js';
import {
  EMPLOYEE,
  HR_ADMIN,
  TEST_PASSWORD,
  clearSessions,
  enableTwoFactor,
  ensureTestPasswords,
} from './fixtures.js';
import { currentCode } from '../src/auth/totp.js';
import { prisma } from '../src/db.js';

type ErrorBody = { error: { code: string; message: string; details?: Array<{ path: string }> } };
type LoginBody = { user?: { email: string; role: string }; challengeToken?: string; expiresAt?: string };

let harness: Harness;

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
});

after(async () => {
  await harness?.close();
});

/** Turns 2FA back off, so a failed test cannot poison the ones after it. */
async function resetTwoFactor() {
  await prisma.user.update({
    where: { email: HR_ADMIN },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
}

/** Signs in and returns the challenge token, for a 2FA-enabled user. */
async function challengeFor(email: string) {
  const client = harness.client();
  const response = await client.post('/api/auth/login', { email, password: TEST_PASSWORD });
  const body = await readJson<LoginBody>(response);
  assert.ok(body.challengeToken, `expected a challenge token, got ${response.status}`);
  return { client, challengeToken: body.challengeToken };
}

describe('login', () => {
  it('signs in with correct credentials and sets both cookies', async () => {
    const client = harness.client();
    const response = await client.post('/api/auth/login', {
      email: EMPLOYEE,
      password: TEST_PASSWORD,
    });

    assert.equal(response.status, 200);
    const body = await readJson<LoginBody>(response);
    assert.equal(body.user?.email, EMPLOYEE);
    assert.equal(body.user?.role, 'EMPLOYEE');

    const setCookies = response.headers.getSetCookie();
    const session = setCookies.find((c) => c.startsWith('ncr_session='));
    const csrf = setCookies.find((c) => c.startsWith('ncr_csrf='));

    assert.ok(session, 'session cookie must be set');
    assert.ok(csrf, 'csrf cookie must be set');

    // The session token must not be readable by JavaScript.
    assert.match(session!, /HttpOnly/i);
    // SameSite is the CSRF backstop for a cookie sent automatically.
    assert.match(session!, /SameSite=Lax/i);
    // The CSRF cookie must be readable, or the frontend cannot echo it back.
    assert.doesNotMatch(csrf!, /HttpOnly/i);
  });

  it('never returns the password hash', async () => {
    const client = harness.client();
    const response = await client.post('/api/auth/login', {
      email: EMPLOYEE,
      password: TEST_PASSWORD,
    });
    const text = await response.text();
    assert.doesNotMatch(text, /argon2/i);
    assert.doesNotMatch(text, /passwordHash/);
  });

  it('accepts an email in any case', async () => {
    const client = harness.client();
    const response = await client.post('/api/auth/login', {
      email: EMPLOYEE.toUpperCase(),
      password: TEST_PASSWORD,
    });
    assert.equal(response.status, 200);
  });

  it('rejects a wrong password with 401', async () => {
    const client = harness.client();
    const response = await client.post('/api/auth/login', {
      email: EMPLOYEE,
      password: 'not the password',
    });
    assert.equal(response.status, 401);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'unauthorized');
  });

  it('answers an unknown email exactly like a wrong password', async () => {
    const unknown = await harness.client().post('/api/auth/login', {
      email: 'nobody@company.com',
      password: 'whatever, correct length',
    });
    const wrongPassword = await harness.client().post('/api/auth/login', {
      email: EMPLOYEE,
      password: 'whatever, correct length',
    });

    assert.equal(unknown.status, wrongPassword.status);

    // Identical message, so the response does not disclose which emails exist.
    const a = await readJson<ErrorBody>(unknown);
    const b = await readJson<ErrorBody>(wrongPassword);
    assert.equal(a.error.message, b.error.message);
  });

  it('sets no cookie when the login fails', async () => {
    const client = harness.client();
    const response = await client.post('/api/auth/login', {
      email: EMPLOYEE,
      password: 'wrong',
    });
    assert.equal(response.headers.getSetCookie().length, 0);
  });

  it('rejects a malformed body with a 400 and names the field', async () => {
    const client = harness.client();
    const response = await client.post('/api/auth/login', { email: 'not-an-email' });
    assert.equal(response.status, 400);

    const body = await readJson<ErrorBody>(response);
    assert.equal(body.error.code, 'validation_failed');
    assert.ok(body.error.details?.some((d) => d.path === 'email'));
  });

  it('rejects a body that is not JSON at all', async () => {
    const response = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    });
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'malformed_json');
  });
});

describe('two-factor', () => {
  it('returns a challenge instead of a session when 2FA is on', async () => {
    const secret = await enableTwoFactor(HR_ADMIN);
    const client = harness.client();

    const response = await client.post('/api/auth/login', {
      email: HR_ADMIN,
      password: TEST_PASSWORD,
    });
    assert.equal(response.status, 200);

    const body = await readJson<LoginBody>(response);
    assert.ok(body.challengeToken, 'expected a challenge token');
    // No session: the password alone must not be enough.
    assert.equal(body.user, undefined);
    assert.equal(
      response.headers.getSetCookie().filter((c) => c.startsWith('ncr_session=')).length,
      0,
    );

    const verified = await client.post('/api/auth/verify-2fa', {
      challengeToken: body.challengeToken,
      code: currentCode(secret),
    });
    assert.equal(verified.status, 200);
    assert.equal((await readJson<LoginBody>(verified)).user?.email, HR_ADMIN);

    await resetTwoFactor();
  });

  it('refuses a wrong code and issues no session', async () => {
    const secret = await enableTwoFactor(HR_ADMIN);
    const { client, challengeToken } = await challengeFor(HR_ADMIN);

    const response = await client.post('/api/auth/verify-2fa', {
      challengeToken,
      // Whatever the real code is, this must not be it.
      code: currentCode(secret) === '000000' ? '111111' : '000000',
    });

    assert.equal(response.status, 401);
    assert.equal(
      response.headers.getSetCookie().filter((c) => c.startsWith('ncr_session=')).length,
      0,
    );

    await resetTwoFactor();
  });

  it('burns a challenge so a code cannot be replayed', async () => {
    const secret = await enableTwoFactor(HR_ADMIN);
    const { client, challengeToken } = await challengeFor(HR_ADMIN);

    // First use succeeds, which consumes the row.
    const first = await client.post('/api/auth/verify-2fa', {
      challengeToken,
      code: currentCode(secret),
    });
    assert.equal(first.status, 200);

    // A code stays valid for its 30-second window, so without single use one
    // observed code would allow several sessions.
    const replay = await harness.client().post('/api/auth/verify-2fa', {
      challengeToken,
      code: currentCode(secret),
    });
    assert.equal(replay.status, 401, 'a consumed challenge must not work twice');

    await resetTwoFactor();
  });

  it('rejects an expired or unknown challenge', async () => {
    const response = await harness.client().post('/api/auth/verify-2fa', {
      challengeToken: 'u1.thisisnotarealchallengeatall',
      code: '123456',
    });
    assert.equal(response.status, 401);
  });
});

describe('session', () => {
  it('identifies the caller on /me', async () => {
    const client = harness.client();
    await client.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });

    const response = await client.get('/api/auth/me');
    assert.equal(response.status, 200);
    assert.equal((await readJson<LoginBody>(response)).user?.email, EMPLOYEE);
  });

  it('401s on /me with no session', async () => {
    assert.equal((await harness.client().get('/api/auth/me')).status, 401);
  });

  it('invalidates the session on logout', async () => {
    const client = harness.client();
    await client.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });
    assert.equal((await client.get('/api/auth/me')).status, 200);

    assert.equal((await client.post('/api/auth/logout')).status, 204);

    // The row is revoked, so the same token must stop working.
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });

  it('rejects a garbage session cookie rather than erroring', async () => {
    const response = await harness.client().get('/api/auth/me', {
      headers: { cookie: 'ncr_session=not-a-real-token' },
    });
    assert.equal(response.status, 401);
  });

  it('ends a previous session when the same user signs in again', async () => {
    await clearSessions();
    const first = harness.client();
    await first.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });
    assert.equal((await first.get('/api/auth/me')).status, 200);

    const second = harness.client();
    await second.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });

    // Single-session policy: the old token is dead, the new one works.
    assert.equal((await first.get('/api/auth/me')).status, 401);
    assert.equal((await second.get('/api/auth/me')).status, 200);
  });

  it('does not treat a 2FA challenge as a session', async () => {
    await enableTwoFactor(HR_ADMIN);
    const { challengeToken } = await challengeFor(HR_ADMIN);

    // A challenge token lives in the same table as sessions, so this is the
    // check that stops it being usable as a session cookie.
    const response = await harness.client().get('/api/auth/me', {
      headers: { cookie: `ncr_session=${challengeToken}` },
    });
    assert.equal(response.status, 401);

    await resetTwoFactor();
  });
});

describe('CSRF', () => {
  it('refuses a state-changing request with no CSRF header', async () => {
    const client = harness.client();
    await client.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });

    // The session cookie rides along automatically, exactly as it would on a
    // cross-site form post. Only the missing header distinguishes the two.
    const response = await client.post(
      '/api/users/me',
      { name: 'Changed By Attacker' },
      { withCsrf: false },
    );

    assert.equal(response.status, 403);
    assert.match((await readJson<ErrorBody>(response)).error.message, /csrf/i);
  });

  it('refuses a mismatched CSRF token', async () => {
    const client = harness.client();
    await client.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });

    const response = await client.post(
      '/api/users/me',
      { name: 'Changed By Attacker' },
      { withCsrf: false, headers: { 'x-csrf-token': 'not-the-right-token' } },
    );
    assert.equal(response.status, 403);
  });

  it('allows a state-changing request that carries the token', async () => {
    const client = harness.client();
    await client.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });
    assert.equal((await client.patch('/api/users/me', { name: 'Alex Johnson' })).status, 200);
  });

  it('does not require a token for a safe method', async () => {
    const client = harness.client();
    await client.post('/api/auth/login', { email: EMPLOYEE, password: TEST_PASSWORD });
    assert.equal((await client.get('/api/users')).status, 200);
  });
});
