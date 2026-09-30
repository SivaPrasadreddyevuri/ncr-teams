/**
 * Read endpoints.
 *
 * These assertions are written against `frontend/lib/data.ts`, not against the
 * schema. The point of the read phase is that the API returns the shapes the
 * existing components already expect, so a drift here is a real defect and not a
 * restatement of the model.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readJson,
  startHarness,
  signedInClient,
  type ActivityItem,
  type Channel,
  type Client,
  type Department,
  type Harness,
  type Person,
  type Team,
} from './helpers.js';
import { EMPLOYEE, HR_ADMIN, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';
import { prisma } from '../src/db.js';
import { toJson } from '../src/serialise.js';

type ActivityList = { activity: ActivityItem[]; nextCursor: string | null };

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

describe('users', () => {
  it('returns the directory in the Person shape', async () => {
    const { users } = await client.getJson<{ users: Person[] }>('/api/users');
    assert.equal(users.length, 8);

    // Every field the frontend's Person type declares must be present, even
    // when null -- a component doing `user.jobTitle.length` depends on the
    // distinction being made in the right place.
    const fields = [
      'id', 'name', 'email', 'jobTitle', 'employeeCode',
      'role', 'department', 'phone', 'online', 'bio',
    ];
    for (const person of users) {
      for (const field of fields) {
        assert.ok(field in person, `Person is missing "${field}"`);
      }
    }
  });

  it('reports a department as a name, matching the fixture', async () => {
    const { users } = await client.getJson<{ users: Person[] }>('/api/users');
    assert.equal(users.find((u) => u.id === 'u1')?.department, 'Product');
  });

  it('filters by search term', async () => {
    const { users } = await client.getJson<{ users: Person[] }>('/api/users?q=priya');
    assert.equal(users.length, 1);
    assert.equal(users[0]?.email, HR_ADMIN);
  });

  it('filters by department name', async () => {
    const { users } = await client.getJson<{ users: Person[] }>('/api/users?department=Engineering');
    assert.equal(users.length, 3);
  });

  it('returns a single person', async () => {
    const { user } = await client.getJson<{ user: Person }>('/api/users/u7');
    assert.equal(user.email, HR_ADMIN);
    assert.equal(user.role, 'HR_ADMIN');
  });

  it('404s an unknown id', async () => {
    const response = await client.get('/api/users/nope');
    assert.equal(response.status, 404);
    assert.equal((await readJson<{ error: { code: string } }>(response)).error.code, 'not_found');
  });

  it('excludes someone who has left', async () => {
    await prisma.user.update({ where: { id: 'u6' }, data: { employmentStatus: 'EXITED' } });
    try {
      const { users } = await client.getJson<{ users: Person[] }>('/api/users');
      assert.ok(!users.some((u) => u.id === 'u6'), 'u6 should be hidden');
    } finally {
      await prisma.user.update({ where: { id: 'u6' }, data: { employmentStatus: 'ACTIVE' } });
    }
  });

  it('requires authentication', async () => {
    assert.equal((await harness.client().get('/api/users')).status, 401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates the caller profile and nothing else', async () => {
    const response = await client.patch('/api/users/me', { bio: 'Updated by a test.' });
    assert.equal(response.status, 200);
    const body = await readJson<{ user: Person }>(response);
    assert.equal(body.user.bio, 'Updated by a test.');

    // Restored so the change does not leak into other tests.
    await client.patch('/api/users/me', {
      bio: 'Product manager focused on the collaboration platform.',
    });
  });

  it('refuses to change the caller role', async () => {
    // An update endpoint that accepts arbitrary keys is an elevation
    // primitive, since `role` is a column on the same row.
    const response = await client.patch('/api/users/me', { role: 'HR_ADMIN' });
    assert.equal(response.status, 400);

    const { users } = await client.getJson<{ users: Person[] }>('/api/users');
    assert.equal(users.find((u) => u.id === 'u1')?.role, 'EMPLOYEE');
  });

  it('refuses to change someone else', async () => {
    const response = await client.patch('/api/users/me', { id: 'u7' });
    assert.equal(response.status, 400);

    const { user } = await client.getJson<{ user: Person }>('/api/users/u7');
    assert.equal(user.email, HR_ADMIN);
  });
});

describe('teams', () => {
  it('returns the Team shape with derived counts', async () => {
    const { teams } = await client.getJson<{ teams: Team[] }>('/api/teams');
    assert.equal(teams.length, 8);

    const fields = [
      'id', 'name', 'description', 'memberIds', 'memberCount', 'channelCount', 'mine', 'myRole',
    ];
    for (const team of teams) {
      for (const field of fields) {
        assert.ok(field in team, `Team is missing "${field}"`);
      }
    }
  });

  it('derives memberCount from real rows, not a stored column', async () => {
    const { teams } = await client.getJson<{ teams: Team[] }>('/api/teams');
    const t1 = teams.find((t) => t.id === 't1');

    // The fixture claimed 12; the real membership is 3. The real number is
    // correct, and the difference is documented in database/README.md.
    assert.ok(t1);
    assert.equal(t1.memberCount, t1.memberIds.length);
    assert.equal(t1.memberCount, 3);
    assert.equal(t1.channelCount, 4);
  });

  it('marks membership and role from the caller own row', async () => {
    const { teams } = await client.getJson<{ teams: Team[] }>('/api/teams');
    const byId = new Map(teams.map((t) => [t.id, t]));

    assert.equal(byId.get('t1')?.mine, true);
    assert.equal(byId.get('t1')?.myRole, 'OWNER');
    // t5 is not one of the caller's teams.
    assert.equal(byId.get('t5')?.mine, false);
    assert.equal(byId.get('t5')?.myRole, null);
  });

  it('includes teams the caller is in but the fixture memberIds omitted', async () => {
    const { teams } = await client.getJson<{ teams: Team[] }>('/api/teams');
    const t2 = teams.find((t) => t.id === 't2');
    // The fixture said mine: true while omitting u1 from memberIds. `mine` won.
    assert.equal(t2?.mine, true);
    assert.ok(t2?.memberIds.includes('u1'));
  });

  it('returns a team with its member list', async () => {
    const body = await client.getJson<{
      team: Team;
      members: Array<Record<string, unknown>>;
    }>('/api/teams/t1');

    assert.equal(body.team.id, 't1');
    assert.equal(body.members.length, 3);
    for (const member of body.members) {
      for (const field of ['userId', 'name', 'role', 'joinedAt']) {
        assert.ok(field in member, `member is missing "${field}"`);
      }
    }
  });
});

describe('channels', () => {
  it('returns the Channel shape with derived last message and unread', async () => {
    const { channels } = await client.getJson<{ channels: Channel[] }>('/api/channels?teamId=t1');
    assert.equal(channels.length, 4);

    const fields = [
      'id', 'name', 'teamName', 'teamId', 'lastMessage', 'lastAt', 'unread', 'memberIds',
    ];
    for (const channel of channels) {
      for (const field of fields) {
        assert.ok(field in channel, `Channel is missing "${field}"`);
      }
    }
  });

  it('derives lastMessage from the newest message, not a stored column', async () => {
    const { channels } = await client.getJson<{ channels: Channel[] }>('/api/channels?teamId=t1');
    const general = channels.find((c) => c.id === 'c1');

    // The seed set u1's marker back 145 minutes, so the 141- and 120-minute
    // messages are newer than it.
    assert.equal(general?.lastMessage, 'Perfect, I will prepare the review.');
    assert.equal(general?.unread, 2);
  });

  it('scopes unread to the reader, not the channel', async () => {
    const asCaller = await client.getJson<{ channels: Channel[] }>('/api/channels?teamId=t1');
    // u1's marker is "now", so nothing is unread for them.
    assert.equal(asCaller.channels.find((c) => c.id === 'c2')?.unread, 0);

    // Established here rather than assumed from a fresh seed: the seed only
    // creates read state for u1, but an earlier run of this suite may have left
    // some behind, and a test that depends on the database being untouched is a
    // test that passes once and fails on the second run.
    const hr = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
    await prisma.channelReadState.deleteMany({ where: { userId: 'u7' } });

    // A reader with no read state at all must see every message as unread.
    const asOther = await hr.getJson<{ channels: Channel[] }>('/api/channels?teamId=t1');
    assert.equal(
      asOther.channels.find((c) => c.id === 'c1')?.unread,
      6,
      'no read state means every message is unread',
    );
  });

  it('clears unread when the channel is marked read', async () => {
    const hr = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
    await prisma.channelReadState.deleteMany({ where: { userId: 'u7' } });

    const before = await hr.getJson<{ channels: Channel[] }>('/api/channels?teamId=t1');
    assert.ok((before.channels.find((c) => c.id === 'c1')?.unread ?? 0) > 0);

    const marked = await hr.post('/api/channels/c1/read');
    assert.equal(marked.status, 200);

    const after = await hr.getJson<{ channels: Channel[] }>('/api/channels?teamId=t1');
    assert.equal(after.channels.find((c) => c.id === 'c1')?.unread, 0);
  });

  it('404s an unknown team', async () => {
    assert.equal((await client.get('/api/channels?teamId=nope')).status, 404);
  });

  it('400s without a teamId rather than listing every channel', async () => {
    assert.equal((await client.get('/api/channels')).status, 400);
  });
});

describe('departments', () => {
  it('returns a head name and a live member count', async () => {
    const { departments } = await client.getJson<{ departments: Department[] }>('/api/departments');
    assert.equal(departments.length, 6);

    const engineering = departments.find((d) => d.name === 'Engineering');
    assert.equal(engineering?.head, 'Sarah Johnson');
    assert.equal(engineering?.members, 3);
  });
});

describe('activity', () => {
  it('resolves each notification target', async () => {
    const { activity } = await client.getJson<ActivityList>('/api/activity');
    assert.equal(activity.length, 6);

    const file = activity.find((a) => a.kind === 'FILE');
    assert.equal(file?.target?.kind, 'file');
    assert.equal(
      file?.target?.kind === 'file' ? file.target.name : null,
      'dashboard-design.fig',
    );
  });

  it('reports file size as a string, because sizeBytes is BigInt', async () => {
    const { activity } = await client.getJson<ActivityList>('/api/activity');
    const file = activity.find((a) => a.kind === 'FILE');

    // A number here would have come from Number() on a BigInt, which is how a
    // 4.4 MB figure silently becomes 4400000 with nothing to notice.
    assert.equal(file?.target?.kind === 'file' ? typeof file.target.sizeBytes : null, 'string');
    assert.equal(file?.target?.kind === 'file' ? file.target.sizeBytes : null, '4400000');
  });

  it('paginates with a cursor and does not repeat rows', async () => {
    const first = await client.getJson<ActivityList>('/api/activity?limit=3');
    assert.equal(first.activity.length, 3);
    assert.ok(first.nextCursor);

    const second = await client.getJson<ActivityList>(
      `/api/activity?limit=3&before=${encodeURIComponent(first.nextCursor!)}`,
    );

    const seen = new Set(first.activity.map((a) => a.id));
    for (const row of second.activity) {
      assert.ok(!seen.has(row.id), `cursor returned a repeated row: ${row.id}`);
    }
  });
});

describe('BigInt safety', () => {
  it('serialises a file response without throwing', async () => {
    // The reason sendJson exists. A raw JSON.stringify on this payload throws,
    // and only on the route that happens to include a file.
    const file = await prisma.file.findUniqueOrThrow({ where: { id: 'f5' } });
    assert.equal(typeof file.sizeBytes, 'bigint');
    assert.throws(() => JSON.stringify(file), TypeError);

    const serialised = toJson({ file });
    assert.equal(typeof JSON.parse(serialised).file.sizeBytes, 'string');
  });
});

describe('error envelope', () => {
  it('never leaks a stack trace', async () => {
    const response = await client.get('/api/users/nope');
    const text = await response.text();
    assert.doesNotMatch(text, /at .*\.ts:/);
    assert.doesNotMatch(text, /node_modules/);
    assert.equal(JSON.parse(text).error.code, 'not_found');
  });

  it('answers an unknown route with the same envelope', async () => {
    const response = await client.get('/api/there-is-no-such-thing');
    assert.equal(response.status, 404);
    assert.equal((await readJson<{ error: { code: string } }>(response)).error.code, 'not_found');
  });
});
