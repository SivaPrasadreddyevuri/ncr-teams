/**
 * File storage.
 *
 * Local disk under `backend/var/uploads`, addressed by the opaque key held in
 * `File.storageKey`. One module rather than a pluggable driver: this is a
 * showcase deployment on an ephemeral filesystem, and a provider abstraction with
 * a single implementation is structure without a second thing to abstract.
 *
 * ## The two things that must be right
 *
 * **1. A key never becomes a path unchecked.** `resolveKey` resolves the key
 * against the storage root and then confirms the result is still inside it. A
 * key of `../../../../etc/passwd` or an absolute `/etc/passwd` resolves outside
 * the root and is rejected. The keys this module generates are safe by
 * construction, but a containment check that only the generator satisfies is a
 * check that breaks the day someone adds a second caller.
 *
 * **2. Uploads stream, never buffer.** A multipart body is piped straight to its
 * destination and counted as it goes. Buffering first would mean a 50 MB upload
 * occupies 50 MB of heap per in-flight request, which is how a free-tier
 * instance runs out of memory. The size cap is enforced while streaming, so an
 * oversized upload is abandoned part-way rather than after the whole thing has
 * already been received.
 *
 * ## Ephemeral by design
 *
 * Render's free tier wipes the filesystem on every deploy and on instance
 * restart, so bytes here do not survive. Database rows do, which is why a row can
 * exist whose bytes are gone. `exists()` distinguishes "deleted" from "never had
 * bytes", and the download route reports the difference rather than pretending.
 * See backend/README.md.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';

/** Resolved absolute path of the storage root. */
export const storageRoot = path.resolve(config.STORAGE_DIR);

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_key' | 'too_large' | 'not_found',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Resolves a storage key to an absolute path inside the root.
 *
 * Throws `invalid_key` for anything that escapes. The comparison is done on
 * resolved paths with a trailing separator, because a plain `startsWith` would
 * treat a sibling directory like `uploads-evil` as being inside `uploads`.
 */
export function resolveKey(key: string): string {
  if (key.includes('\0')) throw new StorageError('Invalid storage key.', 'invalid_key');

  const resolved = path.resolve(storageRoot, key);
  const rootWithSep = storageRoot.endsWith(path.sep) ? storageRoot : storageRoot + path.sep;

  if (resolved !== storageRoot && !resolved.startsWith(rootWithSep)) {
    throw new StorageError('Invalid storage key.', 'invalid_key');
  }
  return resolved;
}

/**
 * A fresh key for an uploaded file.
 *
 * Random, and never derived from the client-supplied filename. A path built from
 * user input is a directory-traversal or overwrite bug; the original name lives
 * in `File.name` and is only ever a label. The extension is kept purely so a
 * downloaded file opens in something plausible.
 */
export function newStorageKey(originalName: string): string {
  const extension = path.extname(originalName).toLowerCase();
  // Only a short, alphanumeric extension is honoured. Anything else is dropped,
  // so a name like `report.pdf.php` or `x.<script>` cannot smuggle a double
  // extension into the key.
  const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';

  const day = new Date().toISOString().slice(0, 10);
  return `uploads/${day}/${randomBytes(16).toString('hex')}${safeExtension}`;
}

/**
 * Writes a stream to `key`, counting bytes and aborting past the cap.
 *
 * `overwrite` is off by default and the write uses `wx`, so an upload cannot
 * replace a different file's content. The demo materialise script turns it on,
 * because regenerating the seeded files on every deploy is the whole point of it
 * -- and because it addresses those files by their known keys rather than by
 * anything a client chose.
 */
export async function putStream(
  key: string,
  source: Readable,
  options: { maxBytes?: number; overwrite?: boolean } = {},
): Promise<{ bytes: number }> {
  const maxBytes = options.maxBytes ?? config.MAX_UPLOAD_BYTES;
  const destination = resolveKey(key);

  await mkdir(path.dirname(destination), { recursive: true });

  let bytes = 0;
  // A counting transform would need the stream pipeline's error type narrowed;
  // checking on 'data' and destroying the stream is explicit and keeps the
  // rejection reason as our own StorageError.
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      source.destroy(
        new StorageError(
          `Upload exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`,
          'too_large',
        ),
      );
    }
  });

  try {
    await pipeline(source, createWriteStream(destination, { flags: options.overwrite ? 'w' : 'wx' }));
  } catch (error) {
    // A partially written file must not survive: a row pointing at truncated
    // bytes is worse than no file at all.
    await unlink(destination).catch(() => undefined);
    if (error instanceof StorageError) throw error;
    throw error;
  }

  return { bytes };
}

/** Convenience for small in-process buffers, used by the demo seed script. */
export async function putBuffer(key: string, contents: Buffer | string): Promise<{ bytes: number }> {
  return putStream(key, Readable.from(contents instanceof Buffer ? [contents] : [Buffer.from(contents)]));
}

export function createReadStreamFor(key: string, range?: { start: number; end: number }) {
  return createReadStream(resolveKey(key), range);
}

export async function exists(key: string): Promise<boolean> {
  try {
    await stat(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function sizeOf(key: string): Promise<number | null> {
  try {
    return (await stat(resolveKey(key))).size;
  } catch {
    return null;
  }
}

export async function deleteKey(key: string): Promise<boolean> {
  try {
    await unlink(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

/** Empties the whole root. Used by the test harness between runs. */
export async function clearAll(): Promise<void> {
  await rm(storageRoot, { recursive: true, force: true });
  await mkdir(storageRoot, { recursive: true });
}
