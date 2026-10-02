/**
 * WebSocket.
 *
 * Driven over a real handshake against a real listening server, because the
 * things that break here -- the upgrade being rejected, a frame arriving before
 * the subscription is acknowledged, the publisher receiving its own message --
 * only exist at the protocol level and cannot be reached by calling a function.
 *
 * Two clients are used throughout. A single client cannot demonstrate a
 * broadcast, and most of these assertions are about what the *other* one sees.
 */

import './setup-env.js';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, WsClient, type Harness } from './helpers.js';
import {
  EMPLOYEE,
  SECOND_EMPLOYEE,
  TEST_PASSWORD,
  ensureTestPasswords,
} from './fixtures.js';
import { prisma } from '../src/db.js';
import { issueWsToken, verifyWsToken } from '../src/realtime/ws-token.js';
import { reset as resetPresence, statusOf } from '../src/realtime/presence.js';
import type { Client as HttpClient } from './helpers.js';

let harness: Harness;
let open: WsClient[] = [];
let http: HttpClient;

before(async () => {
  await ensureTestPasswords();
  resetPresence();
  harness = await startHarness();
  http = await harness.signIn(EMPLOYEE, TEST_PASSWORD);
});

after(async () => {
  for (const socket of open) socket.terminate();
  await harness?.close();
});

beforeEach(() => {
  for (const socket of open) socket.terminate();
  open = [];
  resetPresence();
});

/** Opens an authenticated socket for `email`. */
async function connect(email: string): Promise<WsClient> {
  const client = await harness.signIn(email, TEST_PASSWORD);
  const response = await client.get('/api/auth/ws-token');
  assert.equal(response.status, 200, `${email} could not get a ws-token`);

  const { token } = (await response.json()) as { token: string };
  const socket = await WsClient.connect(`${harness.wsUrl}?token=${encodeURIComponent(token)}`);
  open.push(socket);
  return socket;
}

describe('ws-token', () => {
  it('is accepted right after issue', () => {
    const { token } = issueWsToken('u1');
    assert.equal(verifyWsToken(token), 'u1');
  });

  it('is rejected once expired', () => {
    const { token } = issueWsToken('u1', new Date());
    // 61 seconds on: past the 60 second lifetime.
    assert.equal(verifyWsToken(token, new Date(Date.now() + 61_000)), null);
  });

  it('rejects a tampered user id', () => {
    const { token } = issueWsToken('u1');
    const parts = token.split('.');
    const forged = ['u7', parts[1], parts[2]].join('.');

    // The user id is inside the signed payload, so changing it invalidates the
    // signature. This is the whole reason the token is an HMAC rather than a
    // plain "userId:expiry" pair.
    assert.equal(verifyWsToken(forged), null);
  });

  it('rejects a tampered expiry', () => {
    const { token } = issueWsToken('u1');
    const parts = token.split('.');
    const extended = [parts[0], String(Number(parts[1]) + 86_400), parts[2]].join('.');
    assert.equal(verifyWsToken(extended), null);
  });

  it('rejects garbage', () => {
    for (const value of [undefined, '', 'a.b', 'a.b.c.d', 'nope.abc.def', '.b.c']) {
      assert.equal(verifyWsToken(value), null, `should reject: ${value}`);
    }
  });

  it('requires a session to be issued', async () => {
    assert.equal((await harness.client().get('/api/auth/ws-token')).status, 401);
  });
});

describe('handshake', () => {
  it('rejects a connection with no token', async () => {
    await assert.rejects(
      () => WsClient.connect(harness.wsUrl),
      /rejected with 401/,
    );
  });

  it('rejects a connection with a bad token', async () => {
    await assert.rejects(
      () => WsClient.connect(`${harness.wsUrl}?token=nonsense`),
      /rejected with 401/,
    );
  });

  it('does not upgrade a path other than /ws', async () => {
    await assert.rejects(
      () => WsClient.connect(`${harness.wsUrl.replace('/ws', '/other')}?token=x`),
      /rejected with 404/,
    );
  });

  it('greet an authenticated client with ready', async () => {
    const socket = await connect(EMPLOYEE);
    const ready = await socket.waitForType('ready');

    assert.equal(ready.payload.userId, 'u1');
    assert.ok(Array.isArray(ready.payload.onlineUserIds));
  });
});

describe('subscriptions', () => {
  it('acknowledges only the channels the user is in', async () => {
    const socket = await connect(EMPLOYEE);
    socket.send('subscribe', { channelIds: ['c1', 'c5'] });

    const subscribed = await socket.waitForType('subscribed');
    // u1 is a member of t1 and t8's General, and of t2. Both c1 and c5 are in
    // teams they belong to, so both are granted.
    assert.deepEqual((subscribed.payload.channelIds as string[]).sort(), ['c1', 'c5']);
  });

  it('refuses a channel the user is not a member of', async () => {
    // A channel in t7 (Sales), which u1 is not in. Subscription is not a claim
    // of membership -- otherwise any authenticated socket could name any channel
    // id and start receiving its traffic.
    const sales = await prisma.channel.create({
      data: { name: 'sales-private-look', teamId: 't7' },
      select: { id: true },
    });

    try {
      const socket = await connect(EMPLOYEE);
      socket.send('subscribe', { channelIds: [sales.id] });

      const subscribed = await socket.waitForType('subscribed');
      assert.deepEqual(subscribed.payload.channelIds, []);
    } finally {
      await prisma.channel.delete({ where: { id: sales.id } });
    }
  });

  it('rejects a malformed frame without dropping the socket', async () => {
    const socket = await connect(EMPLOYEE);
    socket.sendRaw('{not json');

    const error = await socket.waitForType('error');
    assert.equal(error.payload.code, 'malformed');

    // Still usable, which is the point of answering rather than closing.
    socket.send('ping');
    await socket.waitForType('pong');
  });

  it('answers an unknown frame type', async () => {
    const socket = await connect(EMPLOYEE);
    socket.send('something.else');
    const error = await socket.waitForType('error');
    assert.equal(error.payload.code, 'unknown_type');
  });
});

describe('message broadcast', () => {
  it('delivers a message to the other subscriber', async () => {
    const sender = await connect(EMPLOYEE);
    const receiver = await connect(SECOND_EMPLOYEE);

    for (const socket of [sender, receiver]) {
      socket.send('subscribe', { channelIds: ['c1'] });
      await socket.waitForType('subscribed');
    }

    const post = http.post('/api/messages', { channelId: 'c1', body: 'over the wire' });
    const created = (await (await post).json()) as { message: { id: string } };

    const frame = await receiver.waitForType('message.created');
    const message = frame.payload.message as { id: string; body: string };
    assert.equal(message.id, created.message.id);
    assert.equal(message.body, 'over the wire');
  });

  it("does not echo the message back to its author", async () => {
    const author = await connect(EMPLOYEE);
    const other = await connect(SECOND_EMPLOYEE);
    for (const socket of [author, other]) {
      socket.send('subscribe', { channelIds: ['c1'] });
      await socket.waitForType('subscribed');
    }

    await http.post('/api/messages', { channelId: 'c1', body: 'mine' });

    await other.waitForType('message.created');
    // The author already has this from the HTTP response. Receiving it again
    // would render the row twice.
    assert.equal(await author.seesNo('message.created', 400), false);
  });

  it('does not reach a socket subscribed to another channel', async () => {
    const writer = await connect(EMPLOYEE);
    const elsewhere = await connect(SECOND_EMPLOYEE);
    for (const socket of [writer, elsewhere]) {
      socket.send('subscribe', { channelIds: ['c1'] });
      await socket.waitForType('subscribed');
    }

    // Deliberately publish to a channel neither is subscribed to.
    const channel = await prisma.channel.create({
      data: { name: 'quiet', teamId: 't1' },
      select: { id: true },
    });

    try {
      await http.post('/api/messages', { channelId: channel.id, body: 'not for you' });
      assert.equal(await elsewhere.seesNo('message.created', 400), false);
    } finally {
      await prisma.channel.delete({ where: { id: channel.id } });
    }
  });

  it('broadcasts a reaction change', async () => {
    const author = await connect(EMPLOYEE);
    const other = await connect(SECOND_EMPLOYEE);
    for (const socket of [author, other]) {
      socket.send('subscribe', { channelIds: ['c1'] });
      await socket.waitForType('subscribed');
    }

    const created = await prisma.message.create({
      data: { channelId: 'c1', userId: 'u2', body: 'react to this' },
      select: { id: true },
    });

    await http.post(`/api/messages/${created.id}/reactions`, { emoji: '🚀' });

    const frame = await other.waitForType('message.updated');
    const message = frame.payload.message as { reactions: Array<{ emoji: string }> };
    assert.equal(message.reactions[0]?.emoji, '🚀');

    await prisma.message.delete({ where: { id: created.id } });
  });
});

describe('typing', () => {
  it('relays to the other subscriber but not the sender', async () => {
    const typer = await connect(EMPLOYEE);
    const watcher = await connect(SECOND_EMPLOYEE);
    for (const socket of [typer, watcher]) {
      socket.send('subscribe', { channelIds: ['c1'] });
      await socket.waitForType('subscribed');
    }

    typer.send('typing.start', { channelId: 'c1' });

    const frame = await watcher.waitForType('typing.start');
    assert.equal(frame.payload.userId, 'u1');
    assert.equal(frame.payload.channelId, 'c1');

    // A client rendering its own typing frame would show a phantom cursor.
    assert.equal(await typer.seesNo('typing.start', 300), false);
  });

  it('refuses typing for a channel that was not subscribed to', async () => {
    const socket = await connect(EMPLOYEE);
    socket.send('subscribe', { channelIds: ['c1'] });
    await socket.waitForType('subscribed');

    socket.send('typing.start', { channelId: 'c9' });
    const error = await socket.waitForType('error');
    assert.equal(error.payload.code, 'not_subscribed');
  });
});

describe('presence', () => {
  it('reports the connecting user as online to everyone', async () => {
    const first = await connect(EMPLOYEE);
    await first.waitForType('ready');

    const second = await connect(SECOND_EMPLOYEE);
    const ready = await second.waitForType('ready');

    // The second client is told who is already here.
    assert.ok((ready.payload.onlineUserIds as string[]).includes('u1'));
  });

  it('reports offline only when the last connection closes', async () => {
    const first = await connect(EMPLOYEE);
    const second = await connect(SECOND_EMPLOYEE);
    for (const socket of [first, second]) {
      socket.send('subscribe', { channelIds: ['c1'] });
      await socket.waitForType('subscribed');
    }

    const watcher = await connect('sarah@company.com');
    watcher.send('subscribe', { channelIds: ['c1'] });
    await watcher.waitForType('subscribed');

    first.close();
    const afterFirst = await watcher.waitFor(
      (f) => f.type === 'presence.changed' && f.payload.userId === 'u1' && f.payload.status === 'offline',
    );
    assert.equal(afterFirst.payload.status, 'offline');
  });

  it('tracks status in the registry', async () => {
    resetPresence();
    assert.equal(statusOf('u1'), 'offline');

    const socket = await connect(EMPLOYEE);
    await socket.waitForType('ready');
    assert.equal(statusOf('u1'), 'online');
  });
});

describe('realtime: meetings', () => {
  /**
   * A meeting both demo users are in, created directly so the subscription checks
   * have something to pass. Deleted in `finally` because the test database is shared.
   */
  async function makeSharedMeeting(): Promise<string> {
    const meeting = await prisma.meeting.create({
      data: {
        title: 'Socket Test Call',
        roomName: `rt-${Math.random().toString(36).slice(2, 10)}`,
        organizerId: 'u1',
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
        participants: { create: [{ userId: 'u1' }, { userId: 'u2' }] },
      },
      select: { id: true },
    });
    return meeting.id;
  }

  it('acknowledges only the meetings the user is a participant in', async () => {
    const mine = await prisma.meeting.create({
      data: {
        title: 'Mine',
        roomName: `rt-mine-${Math.random().toString(36).slice(2, 10)}`,
        organizerId: 'u1',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        participants: { create: [{ userId: 'u1' }] },
      },
      select: { id: true },
    });

    // u2 is not a participant, so this must not be acknowledged.
    const theirs = await prisma.meeting.create({
      data: {
        title: 'Theirs',
        roomName: `rt-theirs-${Math.random().toString(36).slice(2, 10)}`,
        organizerId: 'u2',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        participants: { create: [{ userId: 'u2' }] },
      },
      select: { id: true },
    });

    try {
      const socket = await connect(EMPLOYEE);
      socket.send('subscribe', { meetingIds: [mine.id, theirs.id] });

      const subscribed = await socket.waitForType('subscribed');
      // Subscription is not a claim of participation -- otherwise any authenticated
      // socket could name any meeting id and read its transcript.
      assert.deepEqual(subscribed.payload.meetingIds, [mine.id]);
    } finally {
      await prisma.meeting.delete({ where: { id: mine.id } });
      await prisma.meeting.delete({ where: { id: theirs.id } });
    }
  });

  it('delivers an in-call message to the other participant', async () => {
    const meetingId = await makeSharedMeeting();
    const sender = await connect(EMPLOYEE);
    const receiver = await connect(SECOND_EMPLOYEE);

    for (const socket of [sender, receiver]) {
      socket.send('subscribe', { meetingIds: [meetingId] });
      await socket.waitForType('subscribed');
    }

    try {
      const post = http.post(`/api/meetings/${meetingId}/messages`, { body: 'in the room' });
      const created = (await (await post).json()) as { message: { id: string } };

      const frame = await receiver.waitForType('meeting.message.created');
      const message = frame.payload.message as { id: string; body: string; meetingId: string };
      assert.equal(message.id, created.message.id);
      assert.equal(message.body, 'in the room');
      // The frame carries the meeting it belongs to, which is what routed it.
      assert.equal(message.meetingId, meetingId);
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });

  it("does not echo an in-call message back to its author", async () => {
    const meetingId = await makeSharedMeeting();
    const author = await connect(EMPLOYEE);
    const other = await connect(SECOND_EMPLOYEE);

    for (const socket of [author, other]) {
      socket.send('subscribe', { meetingIds: [meetingId] });
      await socket.waitForType('subscribed');
    }

    try {
      await http.post(`/api/meetings/${meetingId}/messages`, { body: 'mine' });

      await other.waitForType('meeting.message.created');
      assert.equal(await author.seesNo('meeting.message.created', 400), false);
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });

  it('does not reach a socket that did not subscribe to the meeting', async () => {
    const meetingId = await makeSharedMeeting();
    const writer = await connect(EMPLOYEE);
    const elsewhere = await connect(SECOND_EMPLOYEE);

    // `elsewhere` is a participant in the meeting, but never asked to follow it.
    // Proving they cannot read it by guessing the id is the point.
    writer.send('subscribe', { meetingIds: [meetingId] });
    await writer.waitForType('subscribed');
    elsewhere.send('subscribe', { meetingIds: [] });
    await elsewhere.waitForType('subscribed');

    try {
      await http.post(`/api/meetings/${meetingId}/messages`, { body: 'not for you' });
      assert.equal(await elsewhere.seesNo('meeting.message.created', 400), false);
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });

  it('keeps a meeting message out of the channel feed', async () => {
    const meetingId = await makeSharedMeeting();

    // Both sockets are the non-author, deliberately. Using the poster's own socket
    // for the "should not receive" side would pass for the wrong reason -- the echo
    // suppression would hide the frame regardless of how it was routed.
    const inRoom = await connect(SECOND_EMPLOYEE);
    const inChannel = await connect(SECOND_EMPLOYEE);

    inRoom.send('subscribe', { meetingIds: [meetingId] });
    await inRoom.waitForType('subscribed');
    // Following c1 is not following the meeting. A channel id and a meeting id live
    // in separate sets precisely so neither can be mistaken for the other.
    inChannel.send('subscribe', { channelIds: ['c1'] });
    await inChannel.waitForType('subscribed');

    try {
      await http.post(`/api/meetings/${meetingId}/messages`, { body: 'room only' });

      await inRoom.waitForType('meeting.message.created');
      assert.equal(await inChannel.seesNo('meeting.message.created', 400), false);
      assert.equal(await inChannel.seesNo('message.created', 400), false);
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });

  it('delivers an edit of an in-call message', async () => {
    const meetingId = await makeSharedMeeting();
    const sender = await connect(EMPLOYEE);
    const receiver = await connect(SECOND_EMPLOYEE);

    for (const socket of [sender, receiver]) {
      socket.send('subscribe', { meetingIds: [meetingId] });
      await socket.waitForType('subscribed');
    }

    try {
      const post = http.post(`/api/meetings/${meetingId}/messages`, { body: 'typo' });
      const created = (await (await post).json()) as { message: { id: string } };

      await http.patch(`/api/messages/${created.message.id}`, { body: 'fixed' });

      // This is what the old `if (message.channelId)` guard silently skipped: the row
      // changed but the room kept showing the old text until a reload.
      const frame = await receiver.waitForType('meeting.message.updated');
      const message = frame.payload.message as { body: string };
      assert.equal(message.body, 'fixed');
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });
});