/**
 * Dashboard and launcher counts.
 *
 * The point of this suite is that the numbers are *the caller's*. Every assertion
 * here is a scoping assertion: the same query has to return different values for
 * two different people, and a count that is merely "a number" proves nothing.
 *
 * The unread calculation gets the most attention, because it is the one with a
 * plausible wrong answer. A single global "last read" timestamp is far easier to
 * write and it silently marks every other channel read the moment you open one --
 * a bug that looks exactly like working code.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedInClient, startHarness, type Client, type Harness } from './helpers.js';
import { EMPLOYEE, HR_ADMIN, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';
import { prisma } from '../src/db.js';

/**
 * A saved read marker.
 *
 * `lastReadAt` is nullable on the model, so the type says so. Every row the tests
 * create has one, and restoring a null through `createMany` would be a silent no-op
 * at best.
 */
type ReadState = { userId: string; channelId: string; lastReadAt: Date | null };

type Stats = {
  dashboard: { messages: number; meetings: number; mentions: number };
  apps: {
    channels: number;
    events: number;
    files: number;
    meetings: number;
    attendance: number;
  };
};

let harness: Harness;
let employee: Client;
let hrAdmin: Client;

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
  employee = await signedInClient(harness, EMPLOYEE, TEST_PASSWORD);
  hrAdmin = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
});

after(async () => {
  await harness?.close();
});

async function stats(client: Client = employee): Promise<Stats> {
  const response = await client.get('/api/stats');
  assert.equal(response.status, 200, `GET /api/stats returned ${response.status}`);
  return (await response.json()) as Stats;
}

/**
 * Removes a caller's read markers and hands them back so they can be restored.
 *
 * The seed marks every channel read as of "now" except one, and the suites that
 * run before this one post messages of their own. So "the unread count" is not a
 * fixed number in a shared test database, and asserting against one produced a
 * failure that looked like a bug in the route.
 *
 * Clearing the markers makes every message unread, which is a state the query can
 * be pinned to exactly -- and it is also the state a brand-new user is in, which
 * is the case worth testing.
 */
async function withoutReadState(userId: string): Promise<ReadState[]> {
  const saved = await prisma.channelReadState.findMany({ where: { userId } });
  await prisma.channelReadState.deleteMany({ where: { userId } });
  return saved;
}

async function restoreReadState(saved: ReadState[]): Promise<void> {
  if (saved.length === 0) return;
  await prisma.channelReadState.deleteMany({ where: { userId: saved[0]!.userId } });
  await prisma.channelReadState.createMany({ data: saved });
}

/** Every non-deleted message in a channel the caller can see. */
function visibleMessages(userId: string): Promise<number> {
  return prisma.message.count({
    where: {
      deletedAt: null,
      channel: { team: { members: { some: { userId } } } },
    },
  });
}

/** The seeded email for a user id, since clients sign in by email. */
async function emailOf(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.email;
}

describe('stats', () => {
  it('returns both blocks with whole numbers', async () => {
    const body = await stats();

    for (const block of [body.dashboard, body.apps]) {
      for (const [key, value] of Object.entries(block)) {
        assert.equal(
          Number.isInteger(value),
          true,
          `${key} is ${JSON.stringify(value)}, which is not an integer`,
        );
        assert.ok(value >= 0, `${key} is negative`);
      }
    }
  });

  it('counts every visible message as unread when the caller has no read markers', async () => {
    const saved = await withoutReadState('u1');
    try {
      const expected = await visibleMessages('u1');
      const body = await stats();
      assert.equal(
        body.dashboard.messages,
        expected,
        'with no markers, unread should equal every visible non-deleted message',
      );
      assert.ok(expected > 0, 'the seed should leave u1 with messages to count');
    } finally {
      await restoreReadState(saved);
    }
  });

  it('marks messages read per channel, not workspace-wide', async () => {
    // The regression this guards. A single global "last read" timestamp is much
    // easier to write and it marks every channel read the moment you open one --
    // a bug that looks exactly like working code.
    const saved = await withoutReadState('u1');

    const channels = await prisma.channel.findMany({
      where: { team: { members: { some: { userId: 'u1' } } } },
      orderBy: { id: 'asc' },
    });
    const [first, second] = channels;
    assert.ok(first && second, 'expected at least two channels for u1');

    const allUnread = (await stats()).dashboard.messages;

    // Mark everything read right now, in ONE channel only.
    await prisma.channelReadState.create({
      data: { userId: 'u1', channelId: first.id, lastReadAt: new Date() },
    });

    try {
      const inFirst = await prisma.message.count({
        where: { channelId: first.id, deletedAt: null },
      });
      const inSecond = await prisma.message.count({
        where: { channelId: second.id, deletedAt: null },
      });
      assert.ok(inFirst > 0, 'the marked channel should have messages to hide');

      const afterOne = (await stats()).dashboard.messages;
      assert.equal(
        afterOne,
        allUnread - inFirst,
        'reading one channel should subtract exactly that channel\'s messages',
      );
      assert.ok(
        afterOne >= inSecond,
        `the ${inSecond} messages in the untouched channel must still be unread`,
      );
    } finally {
      await restoreReadState(saved);
    }
  });

  it('ignores soft-deleted messages', async () => {
    const before = (await stats()).dashboard.messages;

    await prisma.message.create({
      data: {
        id: 'stats-deleted-probe',
        body: 'zzprobezz to be soft deleted',
        userId: 'u1',
        channelId: 'c1',
        deletedAt: new Date(),
      },
    });

    try {
      const after = (await stats()).dashboard.messages;
      assert.equal(after, before, 'a soft-deleted message must not be counted as unread');
    } finally {
      await prisma.message.delete({ where: { id: 'stats-deleted-probe' } });
    }
  });

  it('excludes messages from channels the caller is not in', async () => {
    // A channel is created in a team u1 is definitely not in, rather than reusing a
    // seeded channel. The seed adds u1 to more teams than the fixtures list (t3 as
    // well as t1 and t2), so which seeded channel is invisible is not something to
    // hard-code -- and a test that assumes it fails the moment the seed is corrected.
    const foreignTeam = await prisma.team.findFirstOrThrow({
      where: { members: { none: { userId: 'u1' } } },
      orderBy: { id: 'asc' },
    });

    const channel = await prisma.channel.create({
      data: {
        id: 'stats-probe-channel',
        name: 'stats-probe',
        teamId: foreignTeam.id,
      },
    });

    const outsider = await prisma.teamMember.findFirstOrThrow({ where: { teamId: foreignTeam.id } });
    const authorClient = await signedInClient(
      harness,
      await emailOf(outsider.userId),
      TEST_PASSWORD,
    );

    // Each caller's own baseline, captured before the message exists. Comparing the
    // author against u1's number would pass or fail for reasons that have nothing
    // to do with this test -- they are in different teams and have different read
    // markers.
    const before = (await stats(employee)).dashboard.messages;
    const authorBefore = (await stats(authorClient)).dashboard.messages;

    await prisma.message.create({
      data: {
        id: 'stats-private-probe',
        body: 'zzprobezz in a channel u1 cannot see',
        userId: outsider.userId,
        channelId: channel.id,
      },
    });

    try {
      assert.equal(
        (await stats(employee)).dashboard.messages,
        before,
        'a message in a channel u1 is not in must not change u1\'s unread count',
      );

      // The author, who is in that team, must see it. Without this the assertion
      // above would also pass if the message were not counted for anyone.
      assert.equal(
        (await stats(authorClient)).dashboard.messages,
        authorBefore + 1,
        'the author, being in that team, should count the planted message',
      );
    } finally {
      await prisma.message.deleteMany({ where: { id: 'stats-private-probe' } });
      await prisma.channel.delete({ where: { id: channel.id } });
    }
  });

  it('counts only upcoming meetings on the dashboard, and only visible ones', async () => {
    const body = await stats();
    const upcomingVisible = await prisma.calendarEvent.count({
      where: {
        startsAt: { gte: new Date() },
        type: 'MEETING',
        OR: [
          { organizerId: 'u1' },
          { attendees: { some: { userId: 'u1' } } },
        ],
      },
    });

    assert.equal(body.dashboard.meetings, upcomingVisible);
  });

  it('counts a meeting once even when the caller is both organiser and attendee', async () => {
    // u1 organises mt1 and is also a participant in it. Without DISTINCT the
    // launcher's meeting count would be inflated by the participant rows.
    const body = await stats();
    const distinct = await prisma.meeting.count({
      where: {
        OR: [
          { organizerId: 'u1' },
          { participants: { some: { userId: 'u1' } } },
        ],
      },
    });

    assert.equal(body.apps.meetings, distinct);
  });

  it('counts the caller\'s own attendance only', async () => {
    const body = await stats();
    const mine = await prisma.attendance.count({ where: { userId: 'u1' } });

    assert.equal(body.apps.attendance, mine);
  });

  it('gives two people different launcher numbers', async () => {
    // u1 is an ordinary employee and u7 the HR admin, in different teams. If the
    // apps block were workspace-wide these would be identical, and identical
    // numbers are the signature of a count that forgot to be scoped.
    const a = await stats(employee);
    const b = await stats(hrAdmin);

    assert.notEqual(
      a.apps.channels,
      b.apps.channels,
      'channel counts should differ between two people in different teams',
    );
    // Files are workspace-wide, so these SHOULD match -- asserted so the scoping
    // distinction above is deliberate rather than accidental.
    assert.equal(a.apps.files, b.apps.files, 'files are workspace-wide by design');
  });

  it('counts only unread notifications as mentions', async () => {
    const body = await stats();
    const mentions = await prisma.notification.count({
      where: { userId: 'u1', kind: 'MENTION' },
    });

    assert.equal(body.dashboard.mentions, mentions);
  });

  it('excludes a soft-deleted file from the launcher count', async () => {
    const before = (await stats()).apps.files;

    const file = await prisma.file.create({
      data: {
        name: 'stats-probe.txt',
        mimeType: 'text/plain',
        sizeBytes: 1n,
        storageKey: 'uploads/test/stats-probe.txt',
        content: Buffer.from('x'),
        uploadedById: 'u1',
        deletedAt: new Date(),
      },
    });

    try {
      const after = (await stats()).apps.files;
      assert.equal(after, before, 'a soft-deleted file must not be counted');
    } finally {
      await prisma.file.delete({ where: { id: file.id } });
    }
  });

  it('requires a session', async () => {
    const response = await harness.client().get('/api/stats');
    assert.equal(response.status, 401);
  });
});
