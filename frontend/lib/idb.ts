/**
 * A minimal IndexedDB wrapper for uploaded file contents.
 *
 * Why not localStorage: it caps out around 5MB *total*, and base64 inflates
 * bytes by a third. A handful of real documents would exhaust it, and the
 * failure mode is an exception on write rather than a gradual decline. IndexedDB
 * stores `Blob`s natively, so nothing is inflated and the practical limit is the
 * browser's own quota.
 *
 * Only file *contents* live here. The rows the UI renders -- name, size, type --
 * are metadata and stay in `localStorage` alongside everything else, so the
 * files list renders without an async round trip.
 *
 * No dependency: the API surface needed is small enough that a promise wrapper
 * around the raw calls is clearer than a library.
 */

const DB_NAME = 'ncr-teams-files';
const DB_VERSION = 1;
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    // Private mode and locked-down profiles can refuse IndexedDB outright.
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so uploads cannot be stored.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the file store.'));
    // A second tab requesting an upgrade leaves this connection holding a stale
    // version open; closing lets the new one through.
    request.onblocked = () => reject(new Error('The file store is in use by another tab.'));
  });

  // Do not cache a failed open, or every later call reuses the same rejection.
  dbPromise = opening.catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('File store request failed.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('File store transaction aborted.'));
      }),
  );
}

export class StorageError extends Error {}

/** Store a file's bytes. `id` must match the `FileRow` it belongs to. */
export async function putBlob(id: string, blob: Blob): Promise<void> {
  try {
    await run('readwrite', (store) => store.put({ id, blob, storedAt: Date.now() }));
  } catch (error) {
    throw new StorageError(
      error instanceof StorageError || error instanceof Error
        ? `Could not save the file: ${error.message}`
        : 'Could not save the file.',
    );
  }
}

/** Read a file's bytes back, or null when it was never stored. */
export async function getBlob(id: string): Promise<Blob | null> {
  const record = await run<{ id: string; blob: Blob } | undefined>('readonly', (store) => store.get(id));
  return record?.blob ?? null;
}

/** Remove a file's bytes. Missing entries are not an error. */
export async function deleteBlob(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

/** Every stored id, used to tell real uploads from demo fixture rows. */
export async function listBlobIds(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  return keys.map(String);
}

/**
 * Bytes actually used, from the browser's own accounting.
 *
 * This replaces the 50GB figure the files page used to display, which was never
 * anything more than a hardcoded constant and made the meter untethered from
 * reality.
 */
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
