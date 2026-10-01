/**
 * Messages.
 *
 * The emphasis is on cursor pagination and soft delete, because those are the two
 * places where the obvious implementation is subtly wrong: `OFFSET` shifts under
 * concurrent inserts, and a hard delete breaks every reply that pointed at the
 * message.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, signedInClient, startHarness, type Client, type Harness } from './helpers.js';
import { EMPLOYEE, HR_ADMIN, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';
import { prisma } from '../src/db.js';
import { subscribe, type RealtimeEvent } from '../src/realtime/bus.js';

type MessageDto = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
  reactions: Array<{ emoji: string; userIds: string[] }>;
  attachments: Array<{ id: string; name: string; size: number; type: string }>;
  deleted: boolean;
  editedAt: string | null;
  parentId: string | null;
  /** Null when the parent is gone, which is not the same as "Unknown". */
  parentAuthor: string | null;
};

type ErrorBody = { error: { code: string; message: string } };

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

/** Records every event published while `run` executes. */
async function captureEvents<T>(run: () => Promise<T>): Promise<{ result: T; events: RealtimeEvent[] }> {
  const events: RealtimeEvent[] = [];
  const unsubscribe = subscribe((event) => events.push(event));
  try {
    const result = await run();
    return { result, events };
  } finally {
    unsubscribe();
  }
}

describe('GET /api/messages', () => {
  it('returns the ChatMessage shape, with authorId rather than userId', async () => {
    const response = await client.get('/api/messages?channelId=c1');
    assert.equal(response.status, 200);

    const { messages } = await readJson<{ messages: MessageDto[] }>(response);
    assert.ok(messages.length > 0);

    for (const message of messages) {
      for (const field of [
        'id', 'channelId', 'authorId', 'body', 'createdAt', 'reactions', 'attachments',
      ]) {
        assert.ok(field in message, `Message is missing "${field}"`);
      }
      // The column is userId; the fixture and the component are authorId.
      assert.ok(!('userId' in message), 'the response must not leak the column name');
    }
  });

  it('returns a thread oldest-first', async () => {
    const { messages } = await readJson<{ messages: MessageDto[] }>(
      await client.get('/api/messages?channelId=c1'),
    );
    const times = messages.map((m) => new Date(m.createdAt).getTime());
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i]! >= times[i - 1]!, 'messages must be in ascending time order');
    }
  });

  it('groups reactions by emoji with the people who gave them', async () => {
    const { messages } = await readJson<{ messages: MessageDto[] }>(
      await client.get('/api/messages?channelId=c1'),
    );
    const m3 = messages.find((m) => m.id === 'm3');
    assert.deepEqual(m3?.reactions, [{ emoji: '👍', userIds: ['u2', 'u4'] }]);
  });

  it('includes attachment metadata', async () => {
    const { messages } = await readJson<{ messages: MessageDto[] }>(
      await client.get('/api/messages?channelId=c1'),
    );
    const m3 = messages.find((m) => m.id === 'm3');
    assert.equal(m3?.attachments.length, 1);
    assert.equal(m3?.attachments[0]?.name, 'dashboard-design.fig');
    assert.equal(m3?.attachments[0]?.size, 4_400_000);
  });

  it('pages with a cursor without repeating or skipping', async () => {
    const all = await readJson<{ messages: MessageDto[] }>(
      await client.get('/api/messages?channelId=c1'),
    );
    const expectedIds = all.messages.map((m) => m.id);

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url: string =
        `/api/messages?channelId=c1&limit=2` +
        (cursor ? `&before=${encodeURIComponent(cursor)}` : '');
      const page = await readJson<{ messages: MessageDto[]; nextCursor: string | null }>(
        await client.get(url),
      );
      collected.unshift(...page.messages.map((m) => m.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    assert.deepEqual(collected, expectedIds, 'paging must reconstruct the thread exactly');
    assert.equal(new Set(collected).size, collected.length, 'no row may appear twice');
  });

  it('is stable when a message arrives mid-scroll', async () => {
    // The case OFFSET gets wrong: the window shifts and a row is duplicated at
    // one end and lost at the other.
    const first = await readJson<{ messages: MessageDto[]; nextCursor: string | null }>(
      await client.get('/api/messages?channelId=c5&limit=2'),
    );
    const firstIds = first.messages.map((m) => m.id);

    // A message older than the cursor, inserted between the two requests.
    const inserted = await prisma.message.create({
      data: {
        channelId: 'c5',
        userId: 'u1',
        body: 'inserted between pages',
        createdAt: new Date(Date.now() - 150_000),
      },
      select: { id: true },
    });

    try {
      const second = await readJson<{ messages: MessageDto[] }>(
        await client.get(
          `/api/messages?channelId=c5&limit=10&before=${encodeURIComponent(first.nextCursor!)}`,
        ),
      );
      const secondIds = second.messages.map((m) => m.id);

      for (const id of secondIds) {
        assert.ok(!firstIds.includes(id), `page 2 repeated a row from page 1: ${id}`);
      }
      assert.equal(new Set([...firstIds, ...secondIds]).size, firstIds.length + secondIds.length);
    } finally {
      // In a finally, so a failed assertion does not leave a stray message for
      // the next run to trip over.
      await prisma.message.delete({ where: { id: inserted.id } });
    }
  });

  it('rejects a malformed cursor rather than returning the whole thread', async () => {
    const response = await client.get('/api/messages?channelId=c1&before=not-a-cursor');
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'invalid_cursor');
  });

  it('requires a channelId', async () => {
    assert.equal((await client.get('/api/messages')).status, 400);
  });

  it('requires authentication', async () => {
    assert.equal((await harness.client().get('/api/messages?channelId=c1')).status, 401);
  });
});

describe('POST /api/messages', () => {
  it('creates a message and publishes it', async () => {
    const { result, events } = await captureEvents(async () =>
      client.postJson<{ message: MessageDto }>('/api/messages', {
        channelId: 'c1',
        body: '  Sent from the test  ',
      }),
    );

    assert.equal(result.message.body, 'Sent from the test', 'body must be trimmed');
    assert.equal(result.message.authorId, 'u1');
    assert.equal(result.message.channelId, 'c1');

    const created = events.find((e) => e.type === 'message.created');
    assert.ok(created, 'a message.created event must be published');
    assert.equal(created.type === 'message.created' ? created.channelId : null, 'c1');

    await prisma.message.delete({ where: { id: result.message.id } });
  });

  it('rejects an empty message with no attachment', async () => {
    const response = await client.post('/api/messages', { channelId: 'c1', body: '   ' });
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'empty_message');
  });

  it('rejects a non-member of the team', async () => {
    // t5 (HR) has no channels, so use a channel in a team u1 is not in: t7 is
    // Sales. u1 is not a member.
    const channel = await prisma.channel.create({
      data: { name: 'sales-internal', teamId: 't7' },
      select: { id: true },
    });

    const response = await client.post('/api/messages', { channelId: channel.id, body: 'hi' });
    assert.equal(response.status, 403);

    await prisma.channel.delete({ where: { id: channel.id } });
  });

  it('rejects an unknown channel', async () => {
    assert.equal((await client.post('/api/messages', { channelId: 'nope', body: 'hi' })).status, 404);
  });

  it("refuses to attach somebody else's file", async () => {
    // A file owned by u7, attached by u1. If the endpoint only checked that the
    // id exists, this would let anyone attach any file in the workspace.
    const theirs = await prisma.file.create({
      data: {
        name: 'u7-private.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10n,
        storageKey: 'uploads/test/u7-private.pdf',
        uploadedById: 'u7',
      },
      select: { id: true },
    });

    const response = await client.post('/api/messages', {
      channelId: 'c1',
      body: 'borrowed',
      attachmentIds: [theirs.id],
    });

    assert.equal(response.status, 400);
    assert.equal(
      (await readJson<ErrorBody>(response)).error.code,
      'unknown_attachment',
    );

    await prisma.file.delete({ where: { id: theirs.id } });
  });

  it('attaches the caller’s own file', async () => {
    const mine = await prisma.file.create({
      data: {
        name: 'mine.txt',
        mimeType: 'text/plain',
        sizeBytes: 5n,
        storageKey: 'uploads/test/mine.txt',
        uploadedById: 'u1',
      },
      select: { id: true },
    });

    const { message } = await client.postJson<{ message: MessageDto }>('/api/messages', {
      channelId: 'c1',
      body: 'with a file',
      attachmentIds: [mine.id],
    });

    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0]?.id, mine.id);

    await prisma.message.delete({ where: { id: message.id } });
    await prisma.file.delete({ where: { id: mine.id } });
  });

  it('rejects a reply whose parent is in another channel', async () => {
    const response = await client.post('/api/messages', {
      channelId: 'c2',
      body: 'cross-channel reply',
      parentId: 'm1', // lives in c1
    });
    assert.equal(response.status, 400);
    assert.equal(
      (await readJson<ErrorBody>(response)).error.code,
      'parent_in_other_channel',
    );
  });

  it('rejects unknown fields', async () => {
    const response = await client.post('/api/messages', {
      channelId: 'c1',
      body: 'hi',
      userId: 'u7',
    });
    assert.equal(response.status, 400);
  });
});

describe('reply context', () => {
  /**
   * Created rows are hard-deleted in `after`.
   *
   * These post into `c1`, and `read.test.ts` runs later against the same database
   * asserting that `c1`'s newest message is a specific seeded row. A row left
   * behind here is newer than all of them, so the failure surfaces in a different
   * file pointing at something unrelated. See the same note on the edit suite.
   *
   * An `after` rather than a delete at the end of each test, because a test that
   * throws before reaching its cleanup would otherwise leave the mess behind --
   * which is exactly the failure mode being defended against.
   */
  const created: string[] = [];

  after(async () => {
    await prisma.message.deleteMany({ where: { id: { in: created } } });
  });

  async function post(body: string, parentId?: string): Promise<MessageDto> {
    const { message } = await client.postJson<{ message: MessageDto }>('/api/messages', {
      channelId: 'c1',
      body,
      ...(parentId ? { parentId } : {}),
    });
    created.push(message.id);
    return message;
  }

  it('carries the parent id and the parent\'s name on a reply', async () => {
    // Resolved server-side in the same query as the message. A client that had to
    // look up "who is m2" would need one request per reply on screen.
    const reply = await post('replying inline', 'm2');

    assert.equal(reply.parentId, 'm2');
    assert.equal(reply.parentAuthor, 'Alex Johnson', 'm2 is authored by u1');
  });

  it('reports no parent for an ordinary message', async () => {
    const message = await post('not a reply');

    assert.equal(message.parentId, null);
    assert.equal(message.parentAuthor, null);
  });

  it('keeps the attribution when the parent has been deleted', async () => {
    // Deleting a message must not orphan its replies, and the reply still points at
    // something Sarah wrote -- so the attribution stays. Discord and Slack do the
    // same, showing the parent as deleted text and keeping its author.
    const parent = await prisma.message.create({
      data: {
        id: 'reply-probe-parent',
        body: 'about to be deleted',
        userId: 'u2',
        channelId: 'c1',
      },
    });
    const reply = await prisma.message.create({
      data: {
        id: 'reply-probe-child',
        body: 'a reply to the above',
        userId: 'u1',
        channelId: 'c1',
        parentId: parent.id,
      },
    });

    try {
      await prisma.message.update({
        where: { id: parent.id },
        data: { deletedAt: new Date(), body: '' },
      });

      const body = await client.getJson<{ messages: MessageDto[] }>('/api/messages?channelId=c1&limit=100');
      const row = body.messages.find((m) => m.id === reply.id);

      assert.ok(row, 'the reply must survive its parent being deleted');
      assert.equal(row.parentId, parent.id, 'the link is kept, so thread position holds');
      assert.equal(row.parentAuthor, 'Sarah Johnson', 'the parent was still hers to write');
    } finally {
      await prisma.message.deleteMany({ where: { id: { in: [parent.id, reply.id] } } });
    }
  });
});

describe('PATCH /api/messages/:id', () => {
  /**
   * Every message these tests create is recorded here and hard-deleted in `after`.
   *
   * Not a nicety. These tests post into `c1`, and `read.test.ts` runs later in the
   * same database and asserts that `c1`'s newest message is a specific seeded row.
   * A message left behind here is newer than all of them, so the failure lands in a
   * different file pointing at something that has nothing to do with editing.
   *
   * A hard delete rather than the API's soft one, because the soft version keeps
   * the row and a tombstone is still a row.
   */
  const created: string[] = [];

  after(async () => {
    await prisma.message.deleteMany({ where: { id: { in: created } } });
  });

  /** A message owned by `client` (u1), for the author cases. */
  async function mine(): Promise<MessageDto> {
    const created_ = await client.postJson<{ message: MessageDto }>('/api/messages', {
      channelId: 'c1',
      body: 'original text',
    });
    created.push(created_.message.id);
    return created_.message;
  }

  it('edits the body and stamps editedAt', async () => {
    const message = await mine();
    const response = await client.patch('/api/messages/' + message.id, { body: '  corrected text  ' });
    assert.equal(response.status, 200);

    const { message: edited } = await readJson<{ message: MessageDto }>(response);
    assert.equal(edited.body, 'corrected text', 'the body is trimmed on the way in');
    assert.ok(edited.editedAt, 'editedAt should be set by an edit');
    assert.equal(edited.id, message.id, 'the id does not change on an edit');
  });

  it('publishes message.updated so other clients see the edit', async () => {
    const message = await mine();
    const events: RealtimeEvent[] = [];
    const unsubscribe = subscribe((event) => events.push(event));

    try {
      await client.patch('/api/messages/' + message.id, { body: 'edited for broadcast' });
      const published = events.find((e) => e.type === 'message.updated');
      assert.ok(published, 'an edit should broadcast, or nobody else sees it');
    } finally {
      unsubscribe();
    }
  });

  it("refuses to edit somebody else's message", async () => {
    // m1 is u2's. Author-only, not role-based, for the same reason delete is.
    const response = await client.patch('/api/messages/m1', { body: 'not mine to change' });
    assert.equal(response.status, 403);
  });

  it('refuses to edit a deleted message', async () => {
    // Editing a tombstone would put text back into a thread where the original is
    // deliberately unreadable.
    const message = await mine();
    await client.delete('/api/messages/' + message.id);

    const response = await client.patch('/api/messages/' + message.id, { body: 'back from the dead' });
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'message_deleted');
  });

  it('rejects an empty or whitespace-only edit', async () => {
    // Unlike create -- where a message may be attachments only -- an edit that
    // empties the text would leave an attachment nobody can describe.
    const message = await mine();
    const blank = await client.patch('/api/messages/' + message.id, { body: '   ' });
    assert.equal(blank.status, 400, 'the schema rejects an empty string');

    const missing = await client.patch('/api/messages/' + message.id, {});
    assert.equal(missing.status, 400, 'and body is required');
  });

  it('rejects an over-long edit', async () => {
    const message = await mine();
    const response = await client.patch('/api/messages/' + message.id, { body: 'x'.repeat(4001) });
    assert.equal(response.status, 400);
  });

  it('returns 404 for an unknown message', async () => {
    const response = await client.patch('/api/messages/nope', { body: 'hello' });
    assert.equal(response.status, 404);
  });

  it('requires a session', async () => {
    const message = await mine();
    const response = await harness.client().patch('/api/messages/' + message.id, { body: 'anon' });
    assert.equal(response.status, 401);
  });
});

describe('reactions', () => {
  it('toggles on and off', async () => {
    const created = await prisma.message.create({
      data: { channelId: 'c1', userId: 'u1', body: 'react to me' },
      select: { id: true },
    });

    const on = await client.postJson<{ message: MessageDto }>(
      `/api/messages/${created.id}/reactions`,
      { emoji: '🎉' },
    );
    assert.deepEqual(on.message.reactions, [{ emoji: '🎉', userIds: ['u1'] }]);

    // A second tap removes it rather than adding a second identical row.
    const off = await client.postJson<{ message: MessageDto }>(
      `/api/messages/${created.id}/reactions`,
      { emoji: '🎉' },
    );
    assert.deepEqual(off.message.reactions, []);

    await prisma.message.delete({ where: { id: created.id } });
  });

  it('counts different people separately', async () => {
    const created = await prisma.message.create({
      data: { channelId: 'c1', userId: 'u1', body: 'two people react' },
      select: { id: true },
    });

    await client.post(`/api/messages/${created.id}/reactions`, { emoji: '👍' });
    const other = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
    const result = await other.postJson<{ message: MessageDto }>(
      `/api/messages/${created.id}/reactions`,
      { emoji: '👍' },
    );

    assert.equal(result.message.reactions[0]?.userIds.length, 2);
    assert.ok(result.message.reactions[0]?.userIds.includes('u1'));
    assert.ok(result.message.reactions[0]?.userIds.includes('u7'));

    await prisma.message.delete({ where: { id: created.id } });
  });

  it('refuses to react to a deleted message', async () => {
    const created = await prisma.message.create({
      data: { channelId: 'c1', userId: 'u1', body: 'soon gone', deletedAt: new Date() },
      select: { id: true },
    });

    // A deleted message is a tombstone. Reacting to it would put content back in
    // the feed that nobody can read.
    const response = await client.post(`/api/messages/${created.id}/reactions`, { emoji: '👍' });
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'message_deleted');

    await prisma.message.delete({ where: { id: created.id } });
  });

  it('404s an unknown message', async () => {
    assert.equal(
      (await client.post('/api/messages/nope/reactions', { emoji: '👍' })).status,
      404,
    );
  });
});

describe('DELETE /api/messages/:id', () => {
  it('soft deletes: the row survives with a blank body', async () => {
    const created = await prisma.message.create({
      data: { channelId: 'c1', userId: 'u1', body: 'regrettable' },
      select: { id: true },
    });

    const { result, events } = await captureEvents(async () =>
      client.delete(`/api/messages/${created.id}`),
    );
    const body = await readJson<{ message: MessageDto }>(result);

    assert.equal(result.status, 200);
    assert.equal(body.message.body, '');
    assert.equal(body.message.deleted, true);
    assert.ok(events.some((e) => e.type === 'message.deleted'));

    // The row is still there. A hard delete would break every reply pointing at
    // it and renumber the thread.
    const row = await prisma.message.findUnique({ where: { id: created.id } });
    assert.ok(row, 'the row must survive a soft delete');
    assert.ok(row!.deletedAt);

    await prisma.message.delete({ where: { id: created.id } });
  });

  it("refuses to delete somebody else's message", async () => {
    const created = await prisma.message.create({
      data: { channelId: 'c1', userId: 'u7', body: 'not yours' },
      select: { id: true },
    });

    assert.equal((await client.delete(`/api/messages/${created.id}`)).status, 403);

    await prisma.message.delete({ where: { id: created.id } });
  });
});
