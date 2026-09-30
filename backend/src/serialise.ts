/**
 * Response serialisation.
 *
 * `File.sizeBytes` is a Prisma `BigInt`, and `JSON.stringify` throws a
 * `TypeError` on any BigInt. That failure is late and specific: the code that
 * built the response is correct, the tests that only inspect objects pass, and
 * the error surfaces as a broken request on whichever route happens to include a
 * file. `database/prisma/seed.ts` asserts the throw so the trap stays visible.
 *
 * So nothing is handed to `res.json()` directly. `sendJson` is the only way a
 * handler answers, and it handles BigInt everywhere in the tree.
 */

import type { Response } from 'express';

/**
 * `JSON.stringify` replacer.
 *
 * A replacer rather than a recursive walk: the replacer receives the value
 * *after* the engine has descended into it, so a BigInt nested in an array, an
 * object, or several levels deep is all handled by one function. A hand-written
 * walk has to be re-implemented for every container type and is exactly where
 * this goes wrong.
 *
 * BigInt becomes a string rather than a number, deliberately. A string cannot
 * lose precision the way `Number()` does, and the frontend's `formatBytes`
 * already accepts `number | bigint`. Callers that want a number get
 * `Number(value)` explicitly.
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Serialises `payload`, converting BigInt to string. */
export function toJson(payload: unknown): string {
  return JSON.stringify(payload, bigintReplacer);
}

/** The only sanctioned way to answer a request with JSON. */
export function sendJson(res: Response, status: number, payload: unknown): void {
  res.status(status).type('application/json').send(toJson(payload));
}

/** `Date` -> ISO string, for query results returned as strings. */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
