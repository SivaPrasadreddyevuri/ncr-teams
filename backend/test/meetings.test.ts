/**
 * Meetings.
 *
 * Three things are defended here.
 *
 * **Scoping is a participant check.** Every query filters to meetings the caller is
 * in. The tests sign in as someone who is not in a meeting and read it by id, and
 * assert 404 rather than 403 -- a meeting you are not in is indistinguishable from
 * one that does not exist, so the response does not confirm that it does.
 *
 * **"Past" is derived from the clock.** There is no status column, so a meeting that
 * ended a minute ago is past and one ending in a minute is not, with no write to make
 * that true. The test asserts the boundary in both directions rather than trusting a
 * fixed set of fixtures, because a test with static dates passes right up until the
 * dates drift into the past.
 *
 * **The join time is a meeting, not an event.** `/events` already returns MEETING
 * rows for the calendar, so the risk here is building the call history out of those
 * and losing `roomName`, the participant list, and the transcript. The tests assert
 * the meeting's own fields survive, which is what a calls screen reads.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
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
  SECOND_EMPLOYEE,
  TEST_PASSWORD,
  ensureTestPasswords,
} from './fixtures.js';
import { prisma } from '../src/db.js';

type MeetingRow = {
  id: string;
  title: string;
  roomName: string;
  organizerId: string;
  startsAt: string;
  endsAt: string;
  participants: { id: string; name: string; avatarUrl: string | null; isOrganizer: boolean }[];
  participantCount: number;
  ended: boolean;
};

type MeetingMessage = {
  id: string;
  body: string;
  meetingId: string | null;
  channelId: string;
  authorId: string;
  createdAt: string;
  deleted: boolean;
  editedAt: string | null;
  parentId: string | null;
  parentAuthor: string | null;
};

type ListBody = {
  meetings: MeetingRow[];
  scope: string;
  evaluatedAt: string;
};

type DetailBody = {
  meeting: MeetingRow;
  messages: { id: string; body: string; createdAt: string; author: { id: string; name: string } }[];
  messagesTruncated: boolean;
};

let harness: Harness;
let employee: Client;
let outsider: Client;

/**
 * A meeting the caller is in, `hoursFromNow` long.
 *
 * Created per test rather than seeded, so "upcoming" and "past" can be expressed as
 * offsets from now instead of fixed dates that quietly expire.
 */
async function makeMeeting(opts: {
  organizerId?: string;
  participantIds?: string[];
  hoursFromNow?: number;
  durationHours?: number;
  title?: string;
}): Promise<string> {
  const startsAt = new Date(Date.now() + (opts.hoursFromNow ?? 24) * 3_600_000);
  const endsAt = new Date(startsAt.getTime() + (opts.durationHours ?? 1) * 3_600_000);

  const meeting = await prisma.meeting.create({
    data: {
      title: opts.title ?? 'Test Meeting',
      roomName: `room-${Math.random().toString(36).slice(2, 10)}`,
      organizerId: opts.organizerId ?? 'u1',
      startsAt,
      endsAt,
      participants: {
        create: (opts.participantIds ?? ['u1']).map((userId) => ({ userId })),
      },
    },
  });

  return meeting.id;
}

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
  employee = await signedInClient(harness, EMPLOYEE, TEST_PASSWORD);
  outsider = await signedInClient(harness, SECOND_EMPLOYEE, TEST_PASSWORD);
});

after(async () => {
  await harness?.close();
});

describe('meetings: scoping is a participant check', () => {
  it('requires a session', async () => {
    assert.equal((await harness.client().get('/api/meetings')).status, 401);
  });

  it('returns a meeting the caller is a participant in', async () => {
    const id = await makeMeeting({ participantIds: ['u1'] });

    const response = await employee.get(`/api/meetings/${id}`);
    assert.equal(response.status, 200);

    const body = await readJson<DetailBody>(response);
    assert.equal(body.meeting.id, id);
    assert.equal(body.meeting.roomName.length > 0, true);
    assert.ok(
      body.meeting.participants.some((p) => p.id === 'u1'),
      'the caller must appear in their own meeting',
    );
  });

  it('will not show a meeting the caller is not in, even with the id', async () => {
    // Deliberately excluding both `u1` (employee) and `u2` (outsider), since neither
    // is meant to be in this one.
    const id = await makeMeeting({ participantIds: ['u3', 'u4'], organizerId: 'u3' });

    // 404, not 403: a 403 would confirm the meeting exists, which is the only
    // information an outsider should not get.
    assert.equal((await employee.get(`/api/meetings/${id}`)).status, 404);
    assert.equal((await outsider.get(`/api/meetings/${id}`)).status, 404);
  });

  it('leaves a meeting nobody is in out of every listing', async () => {
    await makeMeeting({ participantIds: ['u3', 'u4'], title: 'Private One' });

    for (const scope of ['upcoming', 'past', 'all']) {
      const body = await employee.getJson<ListBody>(`/api/meetings?scope=${scope}`);
      assert.equal(
        body.meetings.some((m) => m.title === 'Private One'),
        false,
        `scope=${scope} leaked a meeting the caller is not in`,
      );
    }
  });

  it('marks the organiser, from the meeting rather than from the first participant', async () => {
    const id = await makeMeeting({ organizerId: 'u2', participantIds: ['u1', 'u2'] });
    const body = await employee.getJson<DetailBody>(`/api/meetings/${id}`);

    const organiser = body.meeting.participants.find((p) => p.id === 'u2');
    const attendee = body.meeting.participants.find((p) => p.id === 'u1');

    assert.equal(organiser?.isOrganizer, true);
    assert.equal(attendee?.isOrganizer, false);
  });
});

describe('meetings: past and upcoming come from the clock', () => {
  it('puts a meeting that has ended in past and one that has not in upcoming', async () => {
    const ended = await makeMeeting({ hoursFromNow: -48, title: 'Already Finished' });
    const running = await makeMeeting({ hoursFromNow: -1, durationHours: 3, title: 'Still Running' });
    const future = await makeMeeting({ hoursFromNow: 48, title: 'Later' });

    const upcoming = await employee.getJson<ListBody>('/api/meetings?scope=upcoming');
    const upcomingIds = upcoming.meetings.map((m) => m.id);
    assert.ok(upcomingIds.includes(running), 'a meeting in progress is still joinable');
    assert.ok(upcomingIds.includes(future));
    assert.equal(upcomingIds.includes(ended), false);

    const past = await employee.getJson<ListBody>('/api/meetings?scope=past');
    const pastIds = past.meetings.map((m) => m.id);
    assert.ok(pastIds.includes(ended));
    assert.equal(pastIds.includes(future), false);
  });

  it('reports `ended` consistently with the list it appeared in', async () => {
    const ended = await makeMeeting({ hoursFromNow: -48 });
    const future = await makeMeeting({ hoursFromNow: 48 });

    const past = await employee.getJson<ListBody>('/api/meetings?scope=past&days=120');
    const upcoming = await employee.getJson<ListBody>('/api/meetings?scope=upcoming');

    const pastRows = past.meetings.filter((m) => m.id === ended);
    const futureRows = upcoming.meetings.filter((m) => m.id === future);

    assert.equal(pastRows[0]?.ended, true);
    assert.equal(futureRows[0]?.ended, false);
  });

  it('honours the past window rather than returning everything ever', async () => {
    await makeMeeting({ hoursFromNow: -24 * 200, title: 'Ancient' });

    const narrow = await employee.getJson<ListBody>('/api/meetings?scope=past&days=7');
    assert.equal(
      narrow.meetings.some((m) => m.title === 'Ancient'),
      false,
      'a 200-day-old meeting must not appear in a 7-day window',
    );
  });

  it('orders upcoming forwards and past backwards', async () => {
    const near = await makeMeeting({ hoursFromNow: 2, title: 'Near' });
    const far = await makeMeeting({ hoursFromNow: 72, title: 'Far' });

    const upcoming = await employee.getJson<ListBody>('/api/meetings?scope=upcoming');
    const ids = upcoming.meetings.map((m) => m.id);
    assert.ok(ids.indexOf(near) < ids.indexOf(far), 'the soonest meeting comes first');

    const pastOld = await makeMeeting({ hoursFromNow: -100, title: 'Past Old' });
    const pastRecent = await makeMeeting({ hoursFromNow: -10, title: 'Past Recent' });

    const past = await employee.getJson<ListBody>('/api/meetings?scope=past&days=120');
    const pastIds = past.meetings.map((m) => m.id);
    // Descending by start, so the more recent meeting sorts first.
    assert.ok(
      pastIds.indexOf(pastRecent) < pastIds.indexOf(pastOld),
      'the most recent past meeting comes first',
    );
  });

  it('rejects an unknown scope instead of defaulting to it', async () => {
    assert.equal((await employee.get('/api/meetings?scope=someday')).status, 400);
  });
});

describe('meetings: the transcript', () => {
  it('returns meeting messages oldest-first, and excludes the calendar rows', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    await prisma.message.createMany({
      data: [
        { meetingId: id, userId: 'u2', body: 'First', createdAt: new Date(Date.now() - 3000) },
        { meetingId: id, userId: 'u1', body: 'Second', createdAt: new Date(Date.now() - 2000) },
        { meetingId: id, userId: 'u2', body: 'Third', createdAt: new Date(Date.now() - 1000) },
      ],
    });

    const body = await employee.getJson<DetailBody>(`/api/meetings/${id}`);
    assert.deepEqual(
      body.messages.map((m) => m.body),
      ['First', 'Second', 'Third'],
    );
    // Each line carries its author, joined rather than left as an id the caller has
    // to resolve separately.
    assert.ok(
      body.messages.every((m) => m.author.name.length > 0),
      'every transcript line needs an author name',
    );
  });

  it('hides a soft-deleted message rather than showing an empty bubble', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    await prisma.message.createMany({
      data: [
        { meetingId: id, userId: 'u2', body: 'Still here', createdAt: new Date(Date.now() - 2000) },
        {
          meetingId: id,
          userId: 'u2',
          // A soft delete blanks the body but keeps the row, so it would otherwise
          // render as an empty message.
          body: '',
          deletedAt: new Date(),
          createdAt: new Date(Date.now() - 1000),
        },
      ],
    });

    const body = await employee.getJson<DetailBody>(`/api/meetings/${id}`);
    assert.deepEqual(
      body.messages.map((m) => m.body),
      ['Still here'],
    );
  });

  it('returns no transcript rather than another meeting\'s', async () => {
    const mine = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });
    const theirs = await makeMeeting({ participantIds: ['u3'], organizerId: 'u3' });

    await prisma.message.create({
      data: { meetingId: theirs, userId: 'u2', body: 'Not for you' },
    });

    const body = await employee.getJson<DetailBody>(`/api/meetings/${mine}`);
    assert.deepEqual(body.messages, []);
  });
});

describe('meetings: the join link is a meeting', () => {
  it('carries the meeting\'s own fields, which the calendar endpoint does not have', async () => {
    const id = await makeMeeting({
      participantIds: ['u1', 'u2'],
      title: 'Roadmap Review',
      hoursFromNow: 3,
    });

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id } });

    const body = await employee.getJson<DetailBody>(`/api/meetings/${id}`);

    // These three are what a call history reads and what `/events` cannot supply.
    assert.equal(body.meeting.roomName, stored.roomName);
    assert.equal(body.meeting.participantCount, 2);
    assert.equal(body.meeting.startsAt, stored.startsAt.toISOString());
    assert.equal(body.meeting.endsAt, stored.endsAt.toISOString());
    assert.equal(body.meeting.title, 'Roadmap Review');
  });

  it('reports how many participants without the caller having to count the array', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    await prisma.meetingParticipant.create({ data: { meetingId: id, userId: 'u2' } });
    await prisma.meetingParticipant.create({ data: { meetingId: id, userId: 'u3' } });

    const body = await employee.getJson<DetailBody>(`/api/meetings/${id}`);

    assert.equal(body.meeting.participantCount, 3);
    assert.equal(body.meeting.participants.length, 3);
  });
});

describe('meetings: bounds', () => {
  it('caps the page size', async () => {
    assert.equal((await employee.get('/api/meetings?limit=500')).status, 400);
  });

  it('caps the past window', async () => {
    assert.equal((await employee.get('/api/meetings?scope=past&days=365')).status, 400);
  });

  it('returns 404 for an id that does not exist', async () => {
    assert.equal((await employee.get('/api/meetings/nope')).status, 404);
  });

  it('rejects an unexpected query parameter rather than ignoring it', async () => {
    assert.equal((await employee.get('/api/meetings?showAll=true')).status, 400);
  });
});

describe('meetings: the transcript is persisted and participant-scoped', () => {
  it('requires a session to read', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });
    assert.equal((await harness.client().get(`/api/meetings/${id}/messages`)).status, 401);
  });

  it('requires a session to post', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });
    const response = await harness.client().post(`/api/meetings/${id}/messages`, { body: 'hi' });
    assert.equal(response.status, 401);
  });

  it('posts a message that survives the call ending', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    const response = await employee.post(`/api/meetings/${id}/messages`, { body: '  shipping now  ' });
    assert.equal(response.status, 201);

    const body = await readJson<{ message: MeetingMessage }>(response);
    assert.equal(body.message.body, 'shipping now');
    // The scope travels with the row. This is what the socket relay routes on, and
    // what lets the UI tell an in-call message from a channel one.
    assert.equal(body.message.meetingId, id);
    assert.equal(body.message.channelId, '');

    // Read back through the paginated transcript, not just the POST response.
    const listed = await employee.getJson<{ messages: MeetingMessage[] }>(
      `/api/meetings/${id}/messages`,
    );
    assert.deepEqual(
      listed.messages.map((m) => m.body),
      ['shipping now'],
    );
  });

  it('will not post to a meeting the caller is not in', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    // 404 rather than 403: a meeting you are not in is indistinguishable from one
    // that does not exist.
    assert.equal((await outsider.post(`/api/meetings/${id}/messages`, { body: 'hi' })).status, 404);
    assert.equal((await outsider.get(`/api/meetings/${id}/messages`)).status, 404);
  });

  it('will not read a meeting that does not exist', async () => {
    assert.equal((await employee.get('/api/meetings/no-such-meeting/messages')).status, 404);
  });

  it('refuses an empty message rather than storing an unreadable row', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    assert.equal((await employee.post(`/api/meetings/${id}/messages`, { body: '   ' })).status, 400);

    const listed = await employee.getJson<{ messages: MeetingMessage[] }>(
      `/api/meetings/${id}/messages`,
    );
    assert.equal(listed.messages.length, 0);
  });

  it('will not attach a reply to a parent in another conversation', async () => {
    const here = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });
    const there = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    const parent = await employee.postJson<{ message: MeetingMessage }>(
      `/api/meetings/${there}/messages`,
      { body: 'over here' },
    );

    const response = await employee.post(`/api/meetings/${here}/messages`, {
      body: 'me too',
      parentId: parent.message.id,
    });
    assert.equal(response.status, 400);
  });

  it('keeps the two conversations apart', async () => {
    const a = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });
    const b = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    await employee.postJson(`/api/meetings/${a}/messages`, { body: 'in a' });
    await employee.postJson(`/api/meetings/${b}/messages`, { body: 'in b' });

    const inA = await employee.getJson<{ messages: MeetingMessage[] }>(`/api/meetings/${a}/messages`);
    assert.deepEqual(
      inA.messages.map((m) => m.body),
      ['in a'],
    );
  });

  it('pages the transcript with an opaque cursor', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });
    // Posted in this order, and asserted against in this order. `cuid` increases
    // within a millisecond, so insertion order is the tiebreak the cursor relies on.
    const posted = ['one', 'two', 'three'];
    const rank = (body: string) => posted.indexOf(body);
    for (const body of posted) {
      await employee.postJson(`/api/meetings/${id}/messages`, { body });
    }

    /**
     * Walks every page rather than asserting one page's contents.
     *
     * Which rows land on the first page depends on how `createdAt` granularity falls
     * across these three inserts, so pinning "page one is one and two" would be a
     * test of the clock. The invariant that actually matters -- and the reason the
     * cursor is keyed on `(createdAt, id)` rather than the timestamp -- is that
     * reading the whole transcript loses nothing and repeats nothing.
     */
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page: { messages: MeetingMessage[]; nextCursor: string | null } =
        await employee.getJson(
          `/api/meetings/${id}/messages?limit=2${
            cursor ? `&before=${encodeURIComponent(cursor)}` : ''
          }`,
        );
      // Oldest-first within a page, which is the order a transcript reads in.
      const bodies = page.messages.map((m) => m.body);
      assert.deepEqual(
        bodies,
        [...bodies].sort((a, b) => rank(a) - rank(b)),
        'each page reads oldest-first',
      );
      seen.push(...bodies);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    assert.deepEqual(
      seen.sort((a, b) => rank(a) - rank(b)),
      posted,
    );
    assert.equal(new Set(seen).size, 3, 'no message appears on two pages');
    assert.equal(cursor, null, 'the last page reports the history is exhausted');
  });

  it('rejects a broken cursor instead of silently returning everything', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], hoursFromNow: -48 });

    const response = await employee.get(`/api/meetings/${id}/messages?before=not-a-cursor`);
    assert.equal(response.status, 400);
  });
});

describe('meetings: the join token', () => {
  it('requires a session', async () => {
    const id = await makeMeeting({ participantIds: ['u1'] });
    assert.equal((await harness.client().post(`/api/meetings/${id}/token`)).status, 401);
  });

  /**
   * The unconfigured path.
   *
   * Whether this is 503 or 200 depends on the developer's own `backend/.env`, because
   * `setup-env` loads it. So the test asserts the *contract* -- never a token without
   * credentials, and always a labelled refusal -- rather than pinning one status. A
   * developer with LiveKit configured should not see this suite go red.
   */
  it('either mints a token or refuses with a clear code, never a half-token', async () => {
    const id = await makeMeeting({ participantIds: ['u1'] });
    const response = await employee.post(`/api/meetings/${id}/token`);

    if (response.status === 503) {
      const body = await readJson<{ error: { code: string } }>(response);
      // The frontend keys its simulated-room label off this code, so it has to be
      // stable rather than a generic failure.
      assert.equal(body.error.code, 'livekit_not_configured');
      return;
    }

    assert.equal(response.status, 200, 'a configured deployment should mint a token');

    const body = await readJson<{
      token: string;
      expiresInSeconds: number;
      roomName: string;
    }>(response);

    assert.equal(body.token.split('.').length, 3, 'a JWT, not an empty or truncated string');
    assert.ok(body.expiresInSeconds > 0 && body.expiresInSeconds <= 600, 'short-lived');
  });

  it('will not mint a token for a meeting the caller is not in', async () => {
    const id = await makeMeeting({ participantIds: ['u3', 'u4'], organizerId: 'u3' });

    // 404, not 403: the token endpoint's existence already implies the room exists,
    // and a 403 would confirm it to someone who is not a participant.
    const response = await employee.post(`/api/meetings/${id}/token`);

    assert.equal(response.status, 404);
  });

  it('will not mint a token for a meeting that does not exist', async () => {
    assert.equal((await employee.post('/api/meetings/does-not-exist/token')).status, 404);
  });

  it('scopes the minted token to the meeting\'s own room, not the meeting id', async () => {
    const id = await makeMeeting({ participantIds: ['u1'], title: 'Room Scope Check' });
    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id } });

    const response = await employee.post(`/api/meetings/${id}/token`);
    if (response.status === 503) return; // unconfigured; the claim tests cover the shape

    const body = await readJson<{ roomName: string }>(response);
    // The room is the meeting's `roomName`, which is unique and already returned by
    // the detail route -- so two people opening the same meeting land in the same
    // room by construction rather than by a mapping that could drift.
    assert.equal(body.roomName, stored.roomName);
    assert.notEqual(body.roomName, id);
  });
});

/**
 * A throwaway team + channel, so each test below owns its channel and therefore its
 * derived `roomName`. Without that the tests would share one standing room through the
 * idempotent-reopen path and assert against each other's leftovers.
 *
 * Ids are collected so they can be deleted in the cleanup hook: the standing-room tests
 * deliberately create meetings that have not ended yet, and a shared development
 * database keeps them. Left behind they would appear in every later `scope=upcoming`
 * listing -- and since they start four hours out, sooner than anything else the suite
 * creates, they would quietly reorder the "soonest meeting comes first" assertions.
 */
const throwawayChannels: string[] = [];

async function makeChannel(memberIds: string[]): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const team = await prisma.team.create({
    data: {
      name: `call-test-${suffix}`,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
  });
  const channel = await prisma.channel.create({
    data: { name: `room-${suffix}`, teamId: team.id },
  });
  throwawayChannels.push(channel.id);
  return channel.id;
}

after(async () => {
  // Meetings first: `Message.meetingId` cascades from the meeting, and the rooms
  // reference the channels by name rather than by foreign key, so ordering matters.
  await prisma.meeting.deleteMany({
    where: { roomName: { in: throwawayChannels.map((id) => `channel-${id}`) } },
  });
  // Deleting the team cascades to its channels and its memberships.
  await prisma.team.deleteMany({
    where: { channels: { some: { id: { in: throwawayChannels } } } },
  });
});

describe('meetings: a channel’s call is visible to the channel', () => {
  /**
   * Opens a call in a throwaway channel owned by `memberIds`, and returns both ids.
   *
   * The membership list is the point of most of these: the route is gated on channel
   * membership, so a colleague who cannot read the channel also cannot be told there
   * is a call in it.
   */
  async function openCall(memberIds: string[]): Promise<{ channelId: string; meetingId: string }> {
    const channelId = await makeChannel(memberIds);
    const body = await readJson<{ meeting: MeetingRow; created: boolean }>(
      await employee.post('/api/meetings', { channelId }),
    );
    return { channelId, meetingId: body.meeting.id };
  }

  it('tells a colleague in the channel there is a call, without them having joined it', async () => {
    const { channelId, meetingId } = await openCall(['u1', 'u2']);

    // The gap this route exists for. `GET /api/meetings` is participant-scoped, so the
    // colleague's own list does not mention the room -- which is why reading the tab
    // off that list could never tell them a call was running.
    const listed = await outsider.getJson<{ meetings: MeetingRow[] }>('/api/meetings?scope=upcoming');
    assert.equal(
      listed.meetings.some((m) => m.id === meetingId),
      false,
      'the colleague has not joined, so the meeting list does not include it',
    );

    const body = await outsider.getJson<{ meeting: MeetingRow }>(
      `/api/meetings/channel/${channelId}`,
    );
    assert.equal(body.meeting.id, meetingId);
  });

  it('withholds it from someone who cannot read the channel', async () => {
    const { channelId } = await openCall(['u1']);

    // Channel membership, not participation. Both are true here in reverse: u1 opened
    // the call and is a participant, u2 is neither a member nor a participant.
    assert.equal((await employee.get(`/api/meetings/channel/${channelId}`)).status, 200);
    assert.equal((await outsider.get(`/api/meetings/channel/${channelId}`)).status, 404);
  });

  it('reports no call rather than an error once the window has closed', async () => {
    const { channelId, meetingId } = await openCall(['u1']);

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });

    // 404, so the tab can tell "no call" from a failed read. A room that has lapsed
    // must stop inviting people into it.
    assert.equal((await employee.get(`/api/meetings/channel/${channelId}`)).status, 404);
  });

  it('reports no call for a channel that has never had one', async () => {
    const channelId = await makeChannel(['u1']);

    assert.equal((await employee.get(`/api/meetings/channel/${channelId}`)).status, 404);
  });

  it('returns 404 for a channel that does not exist', async () => {
    assert.equal((await employee.get('/api/meetings/channel/no-such-channel')).status, 404);
  });

  it('requires a session', async () => {
    assert.equal((await harness.client().get('/api/meetings/channel/c1')).status, 401);
  });

  it('is not shadowed by the meeting detail route', async () => {
    // `/channel/:channelId` and `/:id` have the same shape, so a literal segment is
    // only reachable if it is registered first. When it was not, every request here
    // answered 404 for a meeting called "channel".
    const channelId = await makeChannel(['u1']);

    const response = await employee.get(`/api/meetings/channel/${channelId}`);
    assert.equal(response.status, 404);

    const body = await readJson<{ error: { code: string } }>(response);
    assert.equal(body.error.code, 'not_found');
  });
});
