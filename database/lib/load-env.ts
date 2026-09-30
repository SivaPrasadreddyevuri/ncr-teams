/**
 * Loads `database/.env`.
 *
 * Imported for its side effect by every script that talks to the database.
 *
 * `dotenv/config` searches from the current working directory, which is not
 * dependable here: `prisma migrate reset` spawns the seed itself, npm sets the
 * working directory to the workspace, and a developer may invoke a script from
 * anywhere. Resolving the path relative to this module removes the dependency on
 * the working directory entirely.
 *
 * `fileURLToPath` rather than `URL.pathname`: on Windows the latter yields
 * `/C:/Users/...`, and stripping the leading slash to fix that also breaks
 * `/home/...` on Linux, where the slash is meaningful.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
