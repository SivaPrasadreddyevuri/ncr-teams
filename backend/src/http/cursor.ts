/**
 * Opaque cursor pagination.
 *
 * Shared by the channel thread and the meeting transcript because both walk the same
 * `(createdAt, id)` pair, and the tie-break on `id` is the part that is easy to get
 * subtly wrong. Duplicating it would mean two places to fix when it breaks.
 *
 * ## Why not OFFSET
 *
 * `OFFSET` re-counts from the start on every page, so a message arriving mid-scroll
 * shifts the window: the reader sees a duplicate at one end and a gap at the other.
 * The cursor here is the `(createdAt, id)` pair the previous page ended on, which is
 * stable no matter what is inserted.
 *
 * ## Why opaque
 *
 * Base64url of `createdAt|id`, so a client cannot construct an invalid one and a
 * future change to the sort key does not become a breaking API change.
 */

import { badRequest } from './errors.js';

export type Cursor = { createdAt: Date; id: string } | null;

/**
 * Decodes an opaque cursor.
 *
 * Throws rather than falling back to "from the beginning": a client with a broken
 * cursor would otherwise receive the entire history and show it as though the scroll
 * had worked.
 */
export function decodeCursor(raw: string | undefined): Cursor {
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw badRequest('invalid_cursor', 'The pagination cursor is not valid.');
  }

  // Split on the last '|', so an id containing a pipe cannot break the parse.
  const separator = decoded.lastIndexOf('|');
  if (separator === -1) throw badRequest('invalid_cursor', 'The pagination cursor is not valid.');

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw badRequest('invalid_cursor', 'The pagination cursor is not valid.');
  }

  return { createdAt, id };
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * The Prisma `where` fragment that pages strictly backwards from a cursor.
 *
 * Strictly older, with the id breaking ties. Two messages can share a `createdAt`
 * millisecond, and an `lt` on the timestamp alone would drop one of them.
 */
export function cursorWhere(cursor: Cursor): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * The cursor for the *next* page, or null when the history is exhausted.
 *
 * Anchored on the oldest row of the page just returned -- the last element of the
 * descending query -- never the newest. Anchoring on the newest would put the next
 * boundary above a row that was already sent, and that row would arrive twice.
 */
export function nextCursorFrom(rows: Array<{ createdAt: Date; id: string }>, limit: number): string | null {
  if (rows.length !== limit) return null;
  const oldest = rows[rows.length - 1]!;
  return encodeCursor(oldest.createdAt, oldest.id);
}