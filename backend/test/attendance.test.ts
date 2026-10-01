/**
 * Attendance.
 *
 * Three things are being defended here.
 *
 * **The day boundary.** Render runs in UTC; the workspace is Asia/Kolkata. A punch
 * is filed under the *app zone's* day, which differs from the UTC day for six and a
 * half hours every evening. Using `toISOString().slice(0, 10)` here would be
 * correct for half the day and silently wrong for the rest, and the test that
 * catches it is the one that pins the zone rather than the clock.
 *
 * **The rules are the server's.** Late and overtime are computed from the stored
 * value, not echoed back from the client. A test that sends a client-claimed status
 * and asserts it is ignored is what stops the rule being "helpfully" moved back to
 * the browser.
 *
 * **Scoping.** One person per request, with no `userId` parameter to widen it.
 */

import './setup-env.js';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, signedInClient, startHarness, type Client, type Harness } from './helpers.js';
import { EMPLOYEE, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';
import { prisma } from '../src/db.js';
import { APP_TIME_ZONE, appDayKey, appMinutesOfDay } from '../src/app-time.js';
import { LATE_AFTER_MINUTES, OVERTIME_AFTER_MINUTES } from '../src/routes/attendance.js';

type AttendanceRow = {
  id: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: 'PRESENT' | 'LATE' | 'REMOTE' | 'ABSENT' | 'HALF_DAY';
  overtimeMinutes: number;
};

let harness: Harness;
let client: Client;

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
  client = await signedInClient(harness, EMPLOYEE, TEST_PASSWORD);
});

after(async () => {
  await harness?.close();
});

/** Deletes today's row for u1, so each test starts from a known absence. */
beforeEach(async () => {
  const today = new Date(`${appDayKey(new Date())}T00:00:00Z`);
  await prisma.attendance.deleteMany({ where: { userId: 'u1', date: today } });
});

async function list(query = ''): Promise<{ records: AttendanceRow[]; from: string; to: string }> {
  const response = await client.get(`/api/attendance${query}`);
  assert.equal(response.status, 200, `GET /api/attendance${query} returned ${response.status}`);
  return readJson(response);
}

/**
 * A punch that is expected to succeed.
 *
 * `postJson` already asserts 2xx and parses the body, so this returns the record
 * rather than a Response. The cases expecting a 400 use `post` directly, because
 * `postJson` would throw on them.
 */
async function punch(action: 'in' | 'out', extra: Record<string, unknown> = {}): Promise<AttendanceRow> {
  const body = await client.postJson<{ record: AttendanceRow }>('/api/attendance/punch', {
    action,
    ...extra,
  });
  return body.record;
}

describe('app time', () => {
  it('resolves the day in Asia/Kolkata, not UTC', () => {
    // The +05:30 offset is what makes this worth testing at all: the UTC day and
    // the app-zone day disagree for six and a half hours every evening, so "today"
    // is genuinely ambiguous from the server's point of view.
    //
    // 20:00 UTC on the 30th is 01:30 on the 31st in IST.
    assert.equal(appDayKey(new Date('2026-09-30T20:00:00Z')), '2026-10-01');
    // 18:29 UTC is 23:59 on the 30th -- still the 30th, one minute before rollover.
    assert.equal(appDayKey(new Date('2026-09-30T18:29:00Z')), '2026-09-30');
    // 18:30 UTC is exactly midnight, so the day has just rolled over.
    assert.equal(appDayKey(new Date('2026-09-30T18:30:00Z')), '2026-10-01');
    // And a UTC-slice would have disagreed with both of those.
    assert.equal(new Date('2026-09-30T20:00:00Z').toISOString().slice(0, 10), '2026-09-30');
  });

  it('agrees with the zone it declares', () => {
    assert.equal(APP_TIME_ZONE, 'Asia/Kolkata');
    // The zone has no DST, so the offset is constant at +05:30. A change to the
    // constant above would show up here as a different offset.
    const beforeMidnight = new Date('2026-09-30T18:29:59Z');
    assert.equal(appMinutesOfDay(beforeMidnight), 23 * 60 + 59);
    assert.equal(appMinutesOfDay(new Date('2026-09-30T00:00:00Z')), 5 * 60 + 30);
  });

  it('handles midnight as hour 0, not 24', () => {
    // Intl renders midnight as 24 in some locales, which would make 00:30 compute
    // as 1470 minutes and every midnight punch look like 24 hours late.
    assert.equal(appMinutesOfDay(new Date('2026-09-30T18:30:00Z')), 0);
  });
});

describe('attendance list', () => {
  it('returns only the caller\'s own records', async () => {
    const mine = (await list('?days=60')).records;
    assert.ok(mine.length > 0, 'the seed should give u1 some attendance');
    assert.ok(
      mine.every((row) => row.userId === 'u1'),
      'records for another person leaked into the response',
    );
  });

  it('reports the window it searched', async () => {
    const body = await list('?days=7');
    const span =
      (new Date(`${body.to}T00:00:00Z`).getTime() - new Date(`${body.from}T00:00:00Z`).getTime()) /
      86_400_000;
    assert.equal(span, 6, 'a 7-day window spans 7 days inclusive, so the difference is 6');
    assert.equal(body.to, appDayKey(new Date()));
  });

  it('honours an explicit range', async () => {
    const body = await list('?from=2026-01-01&to=2026-01-31');
    assert.equal(body.from, '2026-01-01');
    assert.equal(body.to, '2026-01-31');
    for (const row of body.records) {
      assert.ok(row.date >= '2026-01-01' && row.date <= '2026-01-31', `${row.date} is outside`);
    }
  });

  it('publishes the thresholds so the client does not hardcode them', async () => {
    const response = await client.get('/api/attendance?days=1');
    const body = await readJson<{ rules: { lateAfterMinutes: number; overtimeAfterMinutes: number } }>(
      response,
    );
    assert.equal(body.rules.lateAfterMinutes, LATE_AFTER_MINUTES);
    assert.equal(body.rules.overtimeAfterMinutes, OVERTIME_AFTER_MINUTES);
  });

  it('rejects an inverted range and a malformed date', async () => {
    assert.equal((await client.get('/api/attendance?from=2026-02-01&to=2026-01-01')).status, 400);
    assert.equal((await client.get('/api/attendance?from=yesterday')).status, 400);
    assert.equal((await client.get('/api/attendance?days=9999')).status, 400);
  });

  it('requires a session', async () => {
    assert.equal((await harness.client().get('/api/attendance')).status, 401);
  });
});

describe('punching', () => {
  it('creates a record on check-in, filed under the app-zone day', async () => {
    const record = await punch('in');

    assert.equal(record.userId, 'u1');
    assert.equal(record.date, appDayKey(new Date()));
    assert.ok(record.checkIn, 'checkIn should be set');
    assert.equal(record.checkOut, null);
    assert.equal(record.overtimeMinutes, 0);
  });

  it('refuses to check out of a day with no check-in', async () => {
    // `post`, not `postJson`: this one is expected to be a 400 and postJson
    // asserts 2xx. A silent success here would look like the punch worked and the
    // record simply had no time on it later.
    const response = await client.post('/api/attendance/punch', { action: 'out' });
    assert.equal(response.status, 400);

    const body = await readJson<{ error: { code: string } }>(response);
    assert.equal(body.error.code, 'not_checked_in');
  });

  it('records the checkout and the overtime on check-out', async () => {
    await punch('in');
    const record = await punch('out');

    assert.ok(record.checkOut, 'checkOut should be set');
    assert.equal(record.overtimeMinutes, Math.max(0, appMinutesOfDay(new Date()) - OVERTIME_AFTER_MINUTES));
  });

  it('keeps one row per person per day when checked in twice', async () => {
    const first = await punch('in');
    const second = await punch('in');

    assert.equal(second.id, first.id, 'a second check-in must update, not duplicate');

    const today = new Date(`${appDayKey(new Date())}T00:00:00Z`);
    assert.equal(
      await prisma.attendance.count({ where: { userId: 'u1', date: today } }),
      1,
      'exactly one row for today',
    );
  });

  it('clears a previous checkout when checked in again', async () => {
    await punch('in');
    await punch('out');
    const again = await punch('in');

    assert.equal(again.checkOut, null, 'the superseded shift must not leave its checkout behind');
  });

  it('ignores a status the client tries to dictate', async () => {
    // The rule is the server's. A client claiming PRESENT at 23:00 must not be able
    // to avoid being marked late -- which is the entire reason the thresholds moved
    // out of the browser.
    const record = await punch('in', { status: 'PRESENT', overtimeMinutes: 0, date: '2020-01-01' });

    const expected =
      appMinutesOfDay(new Date()) > LATE_AFTER_MINUTES ? 'LATE' : 'PRESENT';
    assert.equal(record.status, expected, 'status must be derived, not accepted');
    assert.notEqual(record.date, '2020-01-01', 'the day must be derived, not accepted');
  });

  it('rejects an unknown action', async () => {
    const response = await client.post('/api/attendance/punch', { action: 'sideways' });
    assert.equal(response.status, 400);
  });

  it('requires a session', async () => {
    const response = await harness.client().post('/api/attendance/punch', { action: 'in' });
    assert.equal(response.status, 401);
  });

  it("leaves another person's record alone", async () => {
    const other = await signedInClient(harness, 'emma@company.com', TEST_PASSWORD);
    const today = new Date(`${appDayKey(new Date())}T00:00:00Z`);

    // u1 checks in first, so there is a row that must survive someone else's punch.
    await punch('in');
    const u1Before = await prisma.attendance.findUniqueOrThrow({
      where: { userId_date: { userId: 'u1', date: today } },
    });

    await other.post('/api/attendance/punch', { action: 'in' });

    const u1After = await prisma.attendance.findUniqueOrThrow({
      where: { userId_date: { userId: 'u1', date: today } },
    });
    assert.deepEqual(u1After, u1Before, "one person's punch must not touch another's row");

    // And the row u3's punch created belongs to u3 -- not to u1, and not to nobody.
    const todayRows = await prisma.attendance.findMany({ where: { date: today } });
    assert.ok(
      todayRows.every((row) => row.userId === 'u1' || row.userId === 'u3'),
      `unexpected owner on a row created today: ${JSON.stringify(todayRows.map((r) => r.userId))}`,
    );
    assert.ok(
      todayRows.some((row) => row.userId === 'u3' && row.checkIn !== null),
      "u3's own punch should have created u3's row",
    );
  });
});
