/**
 * Files.
 *
 * The important assertions are the ones about failure, because a working upload
 * path is easy and a leaky one is what matters: a cap that only applies after the
 * whole body is buffered, a header built from a user-chosen filename, a "deleted"
 * file whose content is still one request away.
 */

import './setup-env.js';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, signedInClient, startHarness, type Client, type Harness } from './helpers.js';
import { EMPLOYEE, HR_ADMIN, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';

type FileDto = {
  id: string;
  meetingId: string | null;
  name: string;
  size: number;
  mimeType: string;
  isFolder: boolean;
  folder?: boolean;
  starred: boolean;
  uploaded: boolean;
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

beforeEach(async () => {
  // Rows created by a previous test, so a failure cannot cascade.
  //
  // Also clears the fixtures below, which are re-created with an upsert so this
  // suite is safe to run repeatedly without a re-seed in between. A test that
  // only passes against a pristine database is a test that passes once.
  await prisma.file.deleteMany({ where: { storageKey: { startsWith: 'uploads/' } } });
  await prisma.file.deleteMany({
    where: { storageKey: { in: ['seed/metadata-only.md', 'seed/never-existed-lost.txt'] } },
  });

  // Un-deletes the seeded rows. A test that soft-deletes a seeded file would
  // otherwise leave it hidden for every later run of this file.
  await prisma.file.updateMany({
    where: { storageKey: { startsWith: 'seed/' } },
    data: { deletedAt: null },
  });
});

/** Builds a multipart body with one file part. */
function formWith(
  name: string,
  contents: Blob | string | Uint8Array<ArrayBuffer>,
  type = 'text/plain',
): FormData {
  const form = new FormData();
  // Always a Blob: Node's FormData.append rejects a bare string, and a
  // Uint8Array is not a Blob either. Wrapping keeps the bytes byte-for-byte,
  // which is the point of the binary round-trip test.
  //
  // The third argument is the filename *string*, not an options object. Passing
  // an object is stringified to "[object Object]" by FormData, and busboy then
  // reports that as the filename.
  const part =
    typeof contents === 'string'
      ? new Blob([contents], { type })
      : contents instanceof Blob
        ? contents
        : new Blob([contents], { type });

  form.append('file', part, name);
  return form;
}

describe('upload', () => {
  it('stores the bytes in the row itself', { timeout: 30_000 }, async () => {
    const contents = 'the quick brown fox';
    const response = await client.upload('/api/files', formWith('notes.txt', contents));

    assert.equal(response.status, 201);
    const { file } = await readJson<{ file: FileDto }>(response);

    assert.equal(file.name, 'notes.txt');
    assert.equal(file.size, contents.length);
    assert.equal(file.mimeType, 'text/plain');
    assert.equal(file.uploaded, true);
    assert.equal(file.starred, false);

    // The bytes live in the row, so they cannot be separated from it the way a
    // filesystem path could be.
    const row = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    assert.equal(Buffer.from(row.content!).toString('utf8'), contents);
    assert.equal(Number(row.sizeBytes), contents.length);
  });

  it('round-trips the exact bytes through a download', { timeout: 30_000 }, async () => {
    // Binary, not text: an encoding mistake that a string comparison would hide
    // shows up as a byte mismatch here.
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i);

    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('bytes.bin', payload, 'application/octet-stream')),
    );

    const download = await client.get(`/api/files/${file.id}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-length'), '256');

    const received = new Uint8Array(await download.arrayBuffer());
    assert.equal(received.length, payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      assert.equal(received[i], payload[i], `byte ${i} differs`);
    }
  });

  it('rejects a body over the cap with 413', { timeout: 30_000 }, async () => {
    const tooBig = 'x'.repeat(config.MAX_UPLOAD_BYTES + 1024);
    const response = await client.upload('/api/files', formWith('big.txt', tooBig));

    assert.equal(response.status, 413);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'file_too_large');

    // The partial write must be gone, not left as a truncated file.
    const rows = await prisma.file.count({ where: { name: 'big.txt' } });
    assert.equal(rows, 0);
  });

  it('rejects an empty file', { timeout: 30_000 }, async () => {
    const response = await client.upload('/api/files', formWith('empty.txt', ''));
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'empty_file');
  });

  it('rejects a non-multipart body', { timeout: 30_000 }, async () => {
    const response = await client.post('/api/files', { name: 'nope' });
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'not_multipart');
  });

  it('rejects a request with no file part', { timeout: 30_000 }, async () => {
    const form = new FormData();
    form.append('folderId', '');
    const response = await client.upload('/api/files', form);
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'no_file');
  });

  it('never lets the filename become a path', { timeout: 30_000 }, async () => {
    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('../../../escape.txt', 'x')),
    );

    const row = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    assert.ok(!row.storageKey.includes('..'), `storage key leaked a traversal: ${row.storageKey}`);
    assert.ok(!row.storageKey.includes('escape'), 'the name must not reach the key');

    // The path component is stripped on the way in, so even the stored label
    // cannot be walked. What is left is a plain filename.
    assert.equal(row.name, 'escape.txt');
  });

  it('requires authentication', { timeout: 30_000 }, async () => {
    const response = await harness.client().upload('/api/files', formWith('x.txt', 'x'));
    assert.equal(response.status, 401);
  });

  it('requires the CSRF token', { timeout: 30_000 }, async () => {
    const response = await client.upload('/api/files', formWith('x.txt', 'x'), { withCsrf: false });
    assert.equal(response.status, 403);
  });
});

describe('download', () => {
  it('sanitises a hostile filename out of the header', { timeout: 30_000 }, async () => {
    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('a"b\r\nX-Evil: 1.txt', 'x')),
    );

    const response = await client.get(`/api/files/${file.id}/download`);
    const disposition = response.headers.get('content-disposition') ?? '';

    // A quote or a newline in a user-chosen name would let someone inject
    // response headers, so both are replaced rather than escaped.
    assert.match(disposition, /^attachment; filename="/);
    assert.ok(!disposition.includes('\r'), 'CR must not survive into the header');
    assert.ok(!disposition.includes('\n'), 'LF must not survive into the header');
    // The ASCII fallback form holds exactly one quoted pair of quotes: the
    // opening and closing delimiters. The injected quote was neutralised.
    assert.equal((disposition.match(/"/g) ?? []).length, 2);
    // `encodeURIComponent` leaves an apostrophe alone, so the UTF-8 form reads
    // UTF-8'' rather than UTF-8%27.
    assert.ok(disposition.includes("filename*=UTF-8''"), `no UTF-8 form in: ${disposition}`);
  });

  it('410s a row whose bytes are gone', { timeout: 30_000 }, async () => {
    // Which is the state the free-tier ephemeral filesystem leaves behind: the
    // row survives a redeploy, the object does not.
    const created = await prisma.file.create({
      data: {
        name: 'lost.txt',
        mimeType: 'text/plain',
        sizeBytes: 5n,
        storageKey: 'seed/never-existed-lost.txt',
        uploadedById: 'u1',
      },
      select: { id: true },
    });

    const response = await client.get(`/api/files/${created.id}/download`);
    // 410, not 404: the file is known to exist and is gone, which is a different
    // thing from never having had an id.
    assert.equal(response.status, 410);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'content_missing');
  });

  it('404s an unknown id', { timeout: 30_000 }, async () => {
    assert.equal((await client.get('/api/files/nope/download')).status, 404);
  });
});

describe('list', () => {
  it('reports uploaded:false when the bytes are missing', { timeout: 30_000 }, async () => {
    await prisma.file.create({
      data: {
        name: 'metadata-only.md',
        mimeType: 'text/markdown',
        sizeBytes: 100n,
        storageKey: 'seed/metadata-only.md',
        uploadedById: 'u1',
      },
      select: { id: true },
    });

    const { files } = await client.getJson<{ files: FileDto[] }>('/api/files');
    const row = files.find((f) => f.name === 'metadata-only.md');

    // The fixture is display data with no bytes behind it. Reporting that
    // honestly is what keeps it from rendering as a working download button.
    assert.equal(row?.uploaded, false);
  });

  it('hides soft-deleted rows by default', { timeout: 30_000 }, async () => {
    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('gone-soon.txt', 'x')),
    );
    await client.delete(`/api/files/${file.id}`);

    const visible = await client.getJson<{ files: FileDto[] }>('/api/files');
    assert.ok(!visible.files.some((f) => f.id === file.id));

    const withDeleted = await client.getJson<{ files: FileDto[] }>('/api/files?includeDeleted=true');
    assert.ok(withDeleted.files.some((f) => f.id === file.id));
  });

  it('marks a folder without claiming it has bytes', { timeout: 30_000 }, async () => {
    const { files } = await client.getJson<{ files: FileDto[] }>('/api/files');
    const folder = files.find((f) => f.id === 'f1');
    assert.equal(folder?.isFolder, true);
    assert.equal(folder?.folder, true);
    assert.equal(folder?.uploaded, false);
  });

  it('filters by channel, which is what the chat Files tab reads', { timeout: 30_000 }, async () => {
    // The reason this filter exists: a file's channel is set at upload and its
    // message when attached, so "what was shared here" was a column the listing
    // could not ask about.
    const inC1 = await prisma.file.create({
      data: {
        id: 'chan-c1-file',
        name: 'shared-in-c1.txt',
        mimeType: 'text/plain',
        sizeBytes: 2n,
        storageKey: 'uploads/test/c1',
        content: Buffer.from('hi'),
        uploadedById: 'u1',
        channelId: 'c1',
      },
      select: { id: true },
    });
    const inC2 = await prisma.file.create({
      data: {
        id: 'chan-c2-file',
        name: 'shared-in-c2.txt',
        mimeType: 'text/plain',
        sizeBytes: 2n,
        storageKey: 'uploads/test/c2',
        content: Buffer.from('hi'),
        uploadedById: 'u1',
        channelId: 'c2',
      },
      select: { id: true },
    });

    try {
      const { files } = await client.getJson<{ files: FileDto[] }>('/api/files?channelId=c1');
      const ids = files.map((f) => f.id);

      assert.ok(ids.includes(inC1.id), 'the file uploaded to c1 should be listed');
      assert.ok(!ids.includes(inC2.id), 'and the one uploaded to c2 should not');
    } finally {
      await prisma.file.deleteMany({ where: { id: { in: [inC1.id, inC2.id] } } });
    }
  });

  it('returns only root-of-channel files, not the ones inside a folder', { timeout: 30_000 }, async () => {
    // A file is either at the root of a channel or inside a folder, never both, so
    // `folderId: null` has to keep applying when channelId is given. Dropping it
    // would silently return every file in the workspace.
    const nested = await prisma.file.create({
      data: {
        id: 'chan-nested-file',
        name: 'inside-a-folder.txt',
        mimeType: 'text/plain',
        sizeBytes: 2n,
        storageKey: 'uploads/test/nested',
        content: Buffer.from('hi'),
        uploadedById: 'u1',
        channelId: 'c1',
        folderId: 'f1',
      },
      select: { id: true },
    });

    try {
      const { files } = await client.getJson<{ files: FileDto[] }>('/api/files?channelId=c1');
      assert.ok(
        !files.some((f) => f.id === nested.id),
        'a file inside a folder is reachable through its folder, not the channel root',
      );
    } finally {
      await prisma.file.delete({ where: { id: nested.id } });
    }
  });

  it('rejects a malformed channelId', { timeout: 30_000 }, async () => {
    const response = await client.get(`/api/files?channelId=${'x'.repeat(200)}`);
    assert.equal(response.status, 400);
  });
});

describe('star', () => {
  it('toggles and is per-user', { timeout: 30_000 }, async () => {
    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('starme.txt', 'x')),
    );

    const on = await client.postJson<{ file: FileDto }>(`/api/files/${file.id}/star`);
    assert.equal(on.file.starred, true);

    // The seeded f5 is starred by u1 only, so u7 must see it unstarred.
    const asOther = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
    const otherView = await asOther.getJson<{ files: FileDto[] }>('/api/files');
    assert.equal(otherView.files.find((f) => f.id === 'f5')?.starred, false);

    const off = await client.postJson<{ file: FileDto }>(`/api/files/${file.id}/star`);
    assert.equal(off.file.starred, false);
  });
});

describe('delete', () => {
  it('soft deletes the row and removes the bytes', { timeout: 30_000 }, async () => {
    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('deleteme.txt', 'x')),
    );
    const row = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    assert.notEqual(row.content, null);

    const response = await client.delete(`/api/files/${file.id}`);
    assert.equal(response.status, 200);

    const after = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    assert.ok(after.deletedAt, 'the row must survive as a tombstone');
    // A soft delete that leaves the content means a "deleted" file is still one
    // request away, and the row still occupies the space the delete was meant to
    // reclaim.
    assert.equal(after.content, null);
  });

  it("refuses to delete somebody else's file", async () => {
    const { file } = await readJson<{ file: FileDto }>(
      await client.upload('/api/files', formWith('mine.txt', 'x')),
    );

    const other = await signedInClient(harness, HR_ADMIN, TEST_PASSWORD);
    const response = await other.delete(`/api/files/${file.id}`);
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'not_yours');
  });

  it('refuses to delete a folder that still has children', { timeout: 30_000 }, async () => {
    // The seed gives no file a folderId, so f1 is empty and a precondition has to
    // be established here rather than assumed.
    const child = await prisma.file.create({
      data: {
        name: 'inside.txt',
        mimeType: 'text/plain',
        sizeBytes: 1n,
        storageKey: 'uploads/test/inside.txt',
        uploadedById: 'u1',
        folderId: 'f1',
      },
      select: { id: true },
    });

    const response = await client.delete('/api/files/f1');
    assert.equal(response.status, 400);
    assert.equal((await readJson<ErrorBody>(response)).error.code, 'folder_not_empty');

    // The folder must still be there: a failed delete that removed it anyway
    // would orphan the child.
    const folder = await prisma.file.findUniqueOrThrow({ where: { id: 'f1' } });
    assert.equal(folder.deletedAt, null);

    await prisma.file.delete({ where: { id: child.id } });
  });

  it('deletes an empty folder', { timeout: 30_000 }, async () => {
    // The counterpart, so the guard above is not merely refusing everything.
    const response = await client.delete('/api/files/f1');
    assert.equal(response.status, 200);

    const folder = await prisma.file.findUniqueOrThrow({ where: { id: 'f1' } });
    assert.ok(folder.deletedAt);
  });
});

describe('files: sharing into a call', () => {
  /**
   * A meeting the demo users share, created directly so the participation checks have
   * something to pass. Removed in `finally` because the test database is shared.
   */
  async function makeSharedMeeting(): Promise<string> {
    const meeting = await prisma.meeting.create({
      data: {
        title: 'File Scope Call',
        roomName: `fs-${Math.random().toString(36).slice(2, 10)}`,
        organizerId: 'u1',
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
        participants: { create: [{ userId: 'u1' }, { userId: 'u2' }] },
      },
      select: { id: true },
    });
    return meeting.id;
  }

  it('stores a file shared into a call, and says which call', async () => {
    const meetingId = await makeSharedMeeting();

    try {
      const form = formWith('agenda.txt', 'three items');
      form.append('meetingId', meetingId);

      const response = await client.upload('/api/files', form);
      assert.equal(response.status, 201);

      const { file } = await readJson<{ file: FileDto }>(response);
      // The scope travels on the DTO, which is what lets the in-call file panel tell
      // its own files from the channel's.
      assert.equal(file.meetingId, meetingId);

      // Readable through the ordinary download route -- one upload path, not two.
      const download = await client.get(`/api/files/${file.id}/download`);
      assert.equal(download.status, 200);
      assert.equal(await download.text(), 'three items');
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });

  it('lists the files shared into one call', async () => {
    const meetingId = await makeSharedMeeting();

    try {
      const form = formWith('notes.txt', 'in the room');
      form.append('meetingId', meetingId);
      const uploaded = await readJson<{ file: FileDto }>(await client.upload('/api/files', form));

      const listed = await client.getJson<{ files: FileDto[] }>(
        `/api/files?meetingId=${meetingId}`,
      );
      assert.deepEqual(
        listed.files.map((f) => f.id),
        [uploaded.file.id],
      );
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });

  it('will not share into a call the caller is not a participant in', async () => {
    const meeting = await prisma.meeting.create({
      data: {
        title: 'Not Yours',
        roomName: `fs-theirs-${Math.random().toString(36).slice(2, 10)}`,
        organizerId: 'u2',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        participants: { create: [{ userId: 'u2' }] },
      },
      select: { id: true },
    });

    try {
      const form = formWith('sneaky.txt', 'should not land');
      form.append('meetingId', meeting.id);

      const response = await client.upload('/api/files', form);
      // Existence is not the test -- participation is. Without this a caller could
      // name any meeting id and share a file into someone else's call.
      assert.equal(response.status, 400);
      const body = await readJson<{ error: { code: string } }>(response);
      assert.equal(body.error.code, 'bad_meeting');
    } finally {
      await prisma.meeting.delete({ where: { id: meeting.id } });
    }
  });

  it('will not list the files of a call the caller is not in', async () => {
    const meeting = await prisma.meeting.create({
      data: {
        title: 'Private Call',
        roomName: `fs-private-${Math.random().toString(36).slice(2, 10)}`,
        organizerId: 'u2',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        participants: { create: [{ userId: 'u2' }] },
      },
      select: { id: true },
    });

    try {
      // Scoped in the query by participation, so this returns an empty list rather
      // than the files -- and rather than confirming that any exist.
      const listed = await client.getJson<{ files: FileDto[] }>(
        `/api/files?meetingId=${meeting.id}`,
      );
      assert.deepEqual(listed.files, []);
    } finally {
      await prisma.meeting.delete({ where: { id: meeting.id } });
    }
  });

  it('does not put a call file in the channel listing', async () => {
    const meetingId = await makeSharedMeeting();

    try {
      const form = formWith('room-only.txt', 'not in c1');
      form.append('meetingId', meetingId);
      const uploaded = await readJson<{ file: FileDto }>(await client.upload('/api/files', form));

      const inChannel = await client.getJson<{ files: FileDto[] }>('/api/files?channelId=c1');
      assert.equal(
        inChannel.files.some((f) => f.id === uploaded.file.id),
        false,
        'a file shared into a call is not a channel file',
      );
    } finally {
      await prisma.meeting.delete({ where: { id: meetingId } });
    }
  });
});
