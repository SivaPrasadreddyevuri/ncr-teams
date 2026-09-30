/**
 * Storage.
 *
 * The tests that matter here are the hostile ones. `resolveKey` is the single
 * boundary between a database string and the filesystem, and every way of
 * escaping that boundary has to be closed -- including the sibling-directory
 * case, which a naive `startsWith` allows and which is the one that actually
 * works in practice.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as storage from '../src/storage.js';

before(async () => {
  await storage.clearAll();
});

after(async () => {
  await storage.clearAll();
});

describe('path containment', () => {
  it('resolves an ordinary key inside the root', () => {
    const resolved = storage.resolveKey('uploads/2026-09-30/abc123.pdf');
    assert.ok(resolved.startsWith(storage.storageRoot));
  });

  it('rejects a relative traversal', () => {
    for (const key of [
      '../etc/passwd',
      '../../../../etc/passwd',
      'uploads/../../escape.txt',
      '..',
    ]) {
      assert.throws(
        () => storage.resolveKey(key),
        (error: unknown) => error instanceof storage.StorageError && error.code === 'invalid_key',
        `should have rejected: ${key}`,
      );
    }
  });

  it('rejects an absolute path', () => {
    for (const key of ['/etc/passwd', 'C:/Windows/System32/config/SAM']) {
      assert.throws(
        () => storage.resolveKey(key),
        (error: unknown) => error instanceof storage.StorageError && error.code === 'invalid_key',
        `should have rejected: ${key}`,
      );
    }
  });

  it('rejects a null byte', () => {
    assert.throws(
      () => storage.resolveKey('a\u0000.txt'),
      (error: unknown) => error instanceof storage.StorageError && error.code === 'invalid_key',
    );
  });

  it('rejects a sibling directory that shares the root prefix', () => {
    // The one a plain `startsWith` lets through: `uploads-evil` is not inside
    // `uploads`, but every string comparison without a separator says it is.
    const sibling = `${storage.storageRoot}-evil`;
    assert.ok(!sibling.startsWith(storage.storageRoot + '/'));
    assert.throws(
      () => storage.resolveKey(`../${storage.storageRoot.split(/[\\/]/).pop()}-evil/secret.txt`),
      (error: unknown) => error instanceof storage.StorageError && error.code === 'invalid_key',
    );
  });

  it('rejects a Windows separator traversal', () => {
    assert.throws(
      () => storage.resolveKey('..\\..\\secret.txt'),
      (error: unknown) => error instanceof storage.StorageError && error.code === 'invalid_key',
    );
  });
});

describe('key generation', () => {
  it('never embeds the client filename', () => {
    const key = storage.newStorageKey('../../etc/passwd.txt');
    assert.ok(!key.includes('passwd'));
    assert.ok(!key.includes('..'));
  });

  it('keeps a plain extension', () => {
    assert.match(storage.newStorageKey('report.pdf'), /\.pdf$/);
  });

  it('drops an extension that is not alphanumeric', () => {
    // A double extension is the interesting case: `report.pdf.php` must not
    // survive intact, or a viewer may pick the wrong one.
    const key = storage.newStorageKey('report.pdf.php');
    assert.ok(!key.endsWith('.pdf.php'));
    assert.match(key, /\.php$/);
  });

  it('produces only a date segment and random hex when there is no extension', () => {
    const key = storage.newStorageKey('no-extension');
    assert.match(key, /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}$/);
  });

  it('produces a different key every time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => storage.newStorageKey('a.txt')));
    assert.equal(keys.size, 50);
  });
});

describe('write and read', () => {
  it('round-trips bytes', async () => {
    const key = storage.newStorageKey('round.txt');
    const payload = Buffer.from('hello storage', 'utf8');

    const { bytes } = await storage.putStream(key, Readable.from([payload]));
    assert.equal(bytes, payload.length);
    assert.equal(await storage.sizeOf(key), payload.length);

    const chunks: Buffer[] = [];
    for await (const chunk of storage.createReadStreamFor(key)) chunks.push(chunk as Buffer);
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'hello storage');
  });

  it('refuses to overwrite an existing key', async () => {
    const key = storage.newStorageKey('twice.txt');
    await storage.putStream(key, Readable.from([Buffer.from('first')]));

    // `flags: 'wx'`. A silent overwrite would mean an upload could replace a
    // different file's content.
    await assert.rejects(() => storage.putStream(key, Readable.from([Buffer.from('second')])));
  });

  it('rejects an oversized write and leaves no partial file', async () => {
    const key = storage.newStorageKey('big.bin');
    const tooBig = Buffer.alloc(4096, 0x41);

    await assert.rejects(
      () => storage.putStream(key, Readable.from([tooBig]), { maxBytes: 1024 }),
      (error: unknown) => error instanceof storage.StorageError && error.code === 'too_large',
    );

    // The truncated file must not survive: a row pointing at half a file is worse
    // than no file.
    assert.equal(await storage.exists(key), false);
  });

  it('reports existence and size for a missing key', async () => {
    assert.equal(await storage.exists('uploads/nothing-here.txt'), false);
    assert.equal(await storage.sizeOf('uploads/nothing-here.txt'), null);
  });

  it('deletes', async () => {
    const key = storage.newStorageKey('gone.txt');
    await storage.putStream(key, Readable.from([Buffer.from('x')]));
    assert.equal(await storage.deleteKey(key), true);
    assert.equal(await storage.deleteKey(key), false);
    assert.equal(await storage.exists(key), false);
  });
});
