/**
 * Loads `backend/.env`.
 *
 * Imported for its side effect by the entrypoint, before anything reads
 * `config`.
 *
 * `dotenv/config` searches from the current working directory, which is not
 * dependable: npm sets it to the workspace, but a test runner or an editor task
 * may not, and a variable that resolves differently by invocation is a
 * confusing class of bug. Resolving the path relative to this module removes the
 * dependency on the working directory entirely.
 *
 * `fileURLToPath` rather than `URL.pathname`: on Windows the latter yields
 * `/C:/Users/...`, and stripping the leading slash to correct that also breaks
 * `/home/...` on Linux, where the slash is meaningful.
 *
 * A missing file is not an error. In production the platform supplies the
 * variables and no .env exists, so failing here would break a correct deploy.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../.env', import.meta.url));
const result = loadDotenv({ path });

if (result.error && process.env.NODE_ENV !== 'test') {
  // A warning, not a throw: the real validation lives in `config`, which fails
  // with a message naming every missing variable. This only notes that the file
  // was absent, which is normal in production.
  console.warn(`[config] no ${path}; relying on the ambient environment`);
}
