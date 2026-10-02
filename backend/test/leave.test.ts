/**
 * Leave requests.
 *
 * Four things are defended here.
 *
 * **The day count is the server's.** The form always showed a number, and it used
 * to be computed in the browser from two date inputs. A test that submits a window
 * and asserts the returned `days` is what stops the calculation quietly moving back
 * to the client, where it would be as editable as the rest of the request.
 *
 * **Overlap is refused.** Two live requests covering the same day is a bug a person
 * has to notice. The test asserts a 409 rather than that both rows exist.
 *
 * **The HR queue is gated, and the gate is on the route.** A test signs in as an
 * employee and asserts 403 on the queue and on the decision. If the role check were
 * a query parameter instead, this is the test that would notice it had moved.
 *
 * **The decision record is the server's.** `decidedBy` and `decidedAt` come back as
 * the approver, not as whatever the body claimed.
 *
 * `postJson` returns the parsed body and asserts 2xx, so every status assertion here
 * goes through `post`, which returns the raw `Response`.
 */

import './setup-env.js';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readJson,
  signedInClient,
  startHarness,
  type Client,
  type Harness,
} from './helpers.js';
import {
  EMPLOYEE,
  HR_ADMIN,
  SECOND_EMPLOYEE,
  TEST_PASSWORD,
  ensureTestPasswords,
} from './fixtures.js';
import { prisma } from '../src/db.js';
import { countLeaveDays } from '../src/routes/leave.js';

type LeaveRow = {
  id: string;
  userId: string;
  user: { id: string; name: string; avatarUrl: string | null };
  type: string;
  from: string;
  to: string;
  days: number;
  reason: string | null;
  status: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

type LeaveBody = { request: LeaveRow };

let harness: Harness;
let employee: Client;
let hr: Client;
let second: Client;

/** A window far enough out not to collide, with the span in whole days. */
function window(daysFromNow: number, spanDays = 1) {
  const start = new Date(Date.now() + daysFromNow * 86_400_000);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + (spanDays - 1) * 86_400_000);
  end.setUTCHours(17, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Files a request as `who` and returns the created row. */
async function file(
  who: Client,
  body: Record<string, unknown>,
): Promise<{ status: number; row: LeaveRow | null }> {
  const response = await who.post('/api/leave', body);
  if (response.status !== 201) return { status: response.status, row: null };
  const parsed = await readJson<LeaveBody>(response);
  return { status: response.status, row: parsed.request };
}

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
  employee = await signedInClient(harness, EMPLOYEE, TEST_PASSWORD);
  hr = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
  second = await signedInClient(harness, SECOND_EMPLOYEE, TEST_PASSWORD);
});

after(async () => {
  await harness?.close();
});

beforeEach(async () => {
  // Leave rows are the subject under test, so each test starts from an empty table
  // rather than whatever the seed left behind.
  await prisma.leaveRequest.deleteMany();
});

describe('leave: the window is validated before anything is written', () => {
  it('rejects an inverted window rather than storing a negative span', async () => {
    const response = await employee.post('/api/leave', {
      type: 'ANNUAL',
      from: new Date('2027-03-10T09:00:00Z').toISOString(),
      to: new Date('2027-03-01T17:00:00Z').toISOString(),
    });

    assert.equal(response.status, 400);
    assert.equal(await prisma.leaveRequest.count(), 0);
  });

  it('rejects a window longer than the cap', async () => {
    const response = await employee.post('/api/leave', {
      type: 'ANNUAL',
      from: new Date('2027-01-01T09:00:00Z').toISOString(),
      to: new Date('2027-12-01T17:00:00Z').toISOString(),
    });

    assert.equal(response.status, 400);
    assert.equal(await prisma.leaveRequest.count(), 0);
  });

  it('rejects a request filed for someone else, because there is no userId to set', async () => {
    const response = await employee.post('/api/leave', {
      userId: 'u9',
      type: 'ANNUAL',
      ...window(30),
    });

    // Strict schema, so an unexpected key is a 400 rather than a silently ignored
    // field that looks like it worked.
    assert.equal(response.status, 400);
    assert.equal(await prisma.leaveRequest.count(), 0);
  });

  it('requires a session at all', async () => {
    assert.equal((await harness.client().get('/api/leave')).status, 401);
  });
});

describe('leave: the day count belongs to the server', () => {
  it('counts whole days across a multi-day window', async () => {
    const { status, row } = await file(employee, { type: 'ANNUAL', ...window(40, 3) });

    assert.equal(status, 201);
    assert.ok(row);

    // Asserted against the value the server computed from the window it stored, not
    // echoed from the request.
    assert.equal(row!.days, 3);
    assert.equal(
      row!.days,
      countLeaveDays(new Date(row!.from), new Date(row!.to)),
      'the stored count must match the stored window',
    );
  });

  it('refuses a client-supplied day count rather than trusting it', async () => {
    // `days` is a column the server computes, so accepting it from the client would
    // mean the number on the HR board is whatever the requester typed. The strict
    // schema rejects it outright, which is stronger than ignoring it.
    const withDays = await employee.post('/api/leave', {
      type: 'ANNUAL',
      days: 99,
      ...window(41, 2),
    });

    assert.equal(withDays.status, 400);
    assert.equal(await prisma.leaveRequest.count(), 0);

    // The same window without it is counted by the server.
    const { row } = await file(employee, { type: 'ANNUAL', ...window(42, 2) });
    assert.equal(row!.days, 2);
  });

  it('counts an inclusive single day as one, not zero', async () => {
    const { row } = await file(employee, { type: 'SICK', ...window(50, 1) });

    assert.equal(row!.days, 1);
  });

  it('stores an empty reason as null rather than an empty string', async () => {
    const { row } = await file(employee, { type: 'ANNUAL', reason: '   ', ...window(51) });

    assert.equal(row!.reason, null);
  });
});

describe('leave: overlap is refused', () => {
  it('rejects a second live request covering the same day', async () => {
    const target = window(60, 2);
    assert.equal((await file(employee, { type: 'ANNUAL', ...target })).status, 201);

    const second = await employee.post('/api/leave', {
      type: 'SICK',
      from: target.from,
      to: target.to,
    });

    assert.equal(second.status, 409);
    assert.equal(await prisma.leaveRequest.count(), 1);
  });

  it('rejects a window that partially overlaps an existing request', async () => {
    const target = window(65, 3);
    assert.equal((await file(employee, { type: 'ANNUAL', ...target })).status, 201);

    // Starts inside the first window and runs past its end.
    const overlapping = await employee.post('/api/leave', {
      type: 'PERSONAL',
      from: target.from,
      to: new Date(new Date(target.to).getTime() + 2 * 86_400_000).toISOString(),
    });

    assert.equal(overlapping.status, 409);
    assert.equal(await prisma.leaveRequest.count(), 1);
  });

  it("does not treat another person's request as an overlap", async () => {
    const target = window(68, 2);
    assert.equal((await file(employee, { type: 'ANNUAL', ...target })).status, 201);

    // The overlap check is scoped to the caller, so this must succeed.
    assert.equal((await file(second, { type: 'ANNUAL', ...target })).status, 201);
  });

  it('allows a new request once the previous one is rejected', async () => {
    const target = window(70, 2);
    const created = await file(employee, { type: 'ANNUAL', ...target });
    assert.ok(created.row);

    const decision = await hr.post(
      `/api/leave/requests/${created.row!.id}/decision`,
      { status: 'REJECTED' },
    );
    assert.equal(decision.status, 200);

    // A rejected request holds no time, so the same window must be requestable again.
    assert.equal((await file(employee, { type: 'ANNUAL', ...target })).status, 201);
  });

  it('allows a new request once the previous one is withdrawn', async () => {
    const target = window(72, 2);
    const created = await file(employee, { type: 'ANNUAL', ...target });
    assert.ok(created.row);

    const cancelled = await employee.post(`/api/leave/${created.row!.id}/cancel`);
    assert.equal(cancelled.status, 200);

    assert.equal((await file(employee, { type: 'ANNUAL', ...target })).status, 201);
  });
});

describe('leave: the HR queue is gated on the route', () => {
  it('refuses the queue to an employee', async () => {
    assert.equal((await employee.get('/api/leave/requests/queue')).status, 403);
  });

  it('refuses the decision endpoint to an employee', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(80) });
    assert.ok(created.row);

    const response = await employee.post(
      `/api/leave/requests/${created.row!.id}/decision`,
      { status: 'APPROVED' },
    );

    assert.equal(response.status, 403);

    // Still pending, so the refusal actually prevented the write rather than
    // answering 403 after the fact.
    const stored = await prisma.leaveRequest.findUniqueOrThrow({
      where: { id: created.row!.id },
    });
    assert.equal(stored.status, 'PENDING');
    assert.equal(stored.decidedById, null);
  });

  it('serves the queue to HR, pending by default', async () => {
    await file(employee, { type: 'ANNUAL', ...window(82) });
    await file(second, { type: 'SICK', ...window(83) });

    const queue = await hr.get('/api/leave/requests/queue');
    assert.equal(queue.status, 200);

    const body = await readJson<{ requests: LeaveRow[]; status: string }>(queue);
    assert.equal(body.status, 'PENDING');
    assert.equal(body.requests.length, 2, 'the queue spans the whole workspace');

    // Both parties are joined in, so the board can render a name per row without a
    // second request per person.
    assert.ok(body.requests.every((row) => typeof row.user.name === 'string' && row.user.name.length > 0));
  });
});

describe("leave: the decision record is the server's", () => {
  it('records the approver and the instant, not what the body claimed', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(90) });
    assert.ok(created.row);

    const response = await hr.post(`/api/leave/requests/${created.row!.id}/decision`, {
      status: 'APPROVED',
      note: 'Cover arranged.',
    });

    assert.equal(response.status, 200);
    const row = (await readJson<LeaveBody>(response)).request;

    assert.equal(row.status, 'APPROVED');
    assert.equal(
      row.decidedBy?.id,
      'u7',
      'the signer must be the approver, taken from the session rather than the request',
    );
    assert.ok(row.decidedAt, 'a decision must carry a timestamp');
    assert.ok(
      new Date(row.decidedAt!).getTime() > Date.now() - 60_000,
      'the instant must be now, not the one the body supplied',
    );
    assert.equal(row.decisionNote, 'Cover arranged.');
  });

  it('refuses a second decision on the same request', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(95) });
    assert.ok(created.row);
    const path = `/api/leave/requests/${created.row!.id}/decision`;

    assert.equal((await hr.post(path, { status: 'APPROVED' })).status, 200);

    const secondDecision = await hr.post(path, { status: 'REJECTED' });
    assert.equal(secondDecision.status, 409);

    // The first decision stands rather than being silently overwritten.
    const stored = await prisma.leaveRequest.findUniqueOrThrow({
      where: { id: created.row!.id },
    });
    assert.equal(stored.status, 'APPROVED');
  });

  it('refuses a decision that is neither approve nor reject', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(100) });
    assert.ok(created.row);

    const response = await hr.post(`/api/leave/requests/${created.row!.id}/decision`, {
      status: 'PENDING',
    });

    assert.equal(response.status, 400);
  });

  it("refuses to decide the approver's own request", async () => {
    // HR files a request as themselves, then tries to approve it. Without this rule
    // the most privileged account in the demo would be self-approving. HR is u7.
    await prisma.leaveRequest.create({
      data: {
        userId: 'u7',
        type: 'ANNUAL',
        fromDate: new Date(Date.now() + 140 * 86_400_000),
        toDate: new Date(Date.now() + 141 * 86_400_000),
        days: 2,
      },
    });

    const own = await prisma.leaveRequest.findFirstOrThrow({ where: { userId: 'u7' } });
    const response = await hr.post(`/api/leave/requests/${own.id}/decision`, {
      status: 'APPROVED',
    });

    assert.equal(response.status, 403);

    // And the refusal left the row alone.
    const stored = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: own.id } });
    assert.equal(stored.status, 'PENDING');
  });

  it('reports 404 for a request that does not exist', async () => {
    const response = await hr.post('/api/leave/requests/does-not-exist/decision', {
      status: 'APPROVED',
    });

    assert.equal(response.status, 404);
  });
});

describe('leave: withdrawing', () => {
  it('marks a pending request CANCELLED and keeps it visible', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(145) });
    assert.ok(created.row);

    const response = await employee.post(`/api/leave/${created.row!.id}/cancel`);
    assert.equal(response.status, 200);

    const row = (await readJson<LeaveBody>(response)).request;
    assert.equal(row.status, 'CANCELLED');

    // Still in the personal list. A withdrawn request is a fact about the person's
    // leave history, not something to erase -- and the UI has a distinct label for it
    // precisely because it is a different outcome from "never asked".
    const mine = await employee.getJson<{ requests: LeaveRow[] }>('/api/leave');
    assert.equal(mine.requests.length, 1);
    assert.equal(mine.requests[0]!.status, 'CANCELLED');
  });

  it('refuses to withdraw a request HR already decided', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(150) });
    assert.ok(created.row);
    assert.equal(
      (await hr.post(`/api/leave/requests/${created.row!.id}/decision`, { status: 'APPROVED' }))
        .status,
      200,
    );

    // Cancelling approved leave has to go through HR, or the approval record and the
    // booking would disagree.
    const response = await employee.post(`/api/leave/${created.row!.id}/cancel`);
    assert.equal(response.status, 409);

    const stored = await prisma.leaveRequest.findUniqueOrThrow({
      where: { id: created.row!.id },
    });
    assert.equal(stored.status, 'APPROVED', 'the decision must survive a refused withdrawal');
  });

  it('does not let HR withdraw somebody else\'s request', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(155) });
    assert.ok(created.row);

    // HR is not the requester here, so the requester-scoped query finds nothing.
    const response = await hr.post(`/api/leave/${created.row!.id}/cancel`);
    assert.equal(response.status, 404);
  });
});

describe('leave: scoping', () => {
  it("returns only the caller's own requests", async () => {
    await file(second, { type: 'ANNUAL', ...window(110) });

    const mine = await employee.getJson<{ requests: LeaveRow[] }>('/api/leave');
    assert.equal(mine.requests.length, 0);

    await file(employee, { type: 'ANNUAL', ...window(111) });
    const after = await employee.getJson<{ requests: LeaveRow[] }>('/api/leave');

    assert.equal(after.requests.length, 1);
    assert.ok(
      after.requests.every((row) => row.userId === 'u1'),
      "a personal list must not contain another person's request",
    );
  });

  it("will not let one person read another person's request by id", async () => {
    const created = await file(second, { type: 'ANNUAL', ...window(115) });
    assert.ok(created.row);

    assert.equal((await employee.get(`/api/leave/${created.row!.id}`)).status, 404);
  });

  it('withdraws only a pending request, and only your own', async () => {
    const approved = await file(employee, { type: 'ANNUAL', ...window(120) });
    assert.ok(approved.row);
    assert.equal(
      (await hr.post(`/api/leave/requests/${approved.row!.id}/decision`, { status: 'APPROVED' }))
        .status,
      200,
    );

    // An approved request cannot be withdrawn by the person who asked for it.
    assert.equal((await employee.post(`/api/leave/${approved.row!.id}/cancel`)).status, 409);

    const pending = await file(employee, { type: 'ANNUAL', ...window(125) });
    assert.ok(pending.row);
    const cancelled = await employee.post(`/api/leave/${pending.row!.id}/cancel`);

    assert.equal(cancelled.status, 200);
    assert.equal((await readJson<LeaveBody>(cancelled)).request.status, 'CANCELLED');
  });

  it("will not let one person withdraw another person's request", async () => {
    const created = await file(second, { type: 'ANNUAL', ...window(118) });
    assert.ok(created.row);

    assert.equal((await employee.post(`/api/leave/${created.row!.id}/cancel`)).status, 404);
  });

  it('filters the personal list by status', async () => {
    const created = await file(employee, { type: 'ANNUAL', ...window(130) });
    assert.ok(created.row);
    await hr.post(`/api/leave/requests/${created.row!.id}/decision`, { status: 'REJECTED' });

    const rejected = await employee.getJson<{ requests: LeaveRow[] }>('/api/leave?status=REJECTED');
    assert.equal(rejected.requests.length, 1);
    assert.equal(rejected.requests[0]!.status, 'REJECTED');

    const pending = await employee.getJson<{ requests: LeaveRow[] }>('/api/leave?status=PENDING');
    assert.equal(pending.requests.length, 0);
  });

  it('rejects an unknown status filter rather than ignoring it', async () => {
    assert.equal((await employee.get('/api/leave?status=MAYBE')).status, 400);
  });
});
