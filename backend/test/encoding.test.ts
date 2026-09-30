/**
 * Encoding guard.
 *
 * Scans the repository's text files for double-encoded UTF-8 -- mojibake.
 *
 * This exists because the hazard is real and invisible. Windows PowerShell's
 * `Get-Content -Raw` reads a file with the ANSI codepage rather than UTF-8, so
 * reading a UTF-8 file and writing it back re-encodes every non-ASCII
 * character. A reaction emoji in the seed and an em dash in a CSS comment were
 * both corrupted this way, and nothing failed: the seed ran, the tests passed,
 * and the database held the re-encoded bytes where a thumbs-up belonged. Only a
 * value-level assertion in a different suite caught it.
 *
 * Note that this file deliberately spells out no example of the corruption it
 * looks for -- writing one literally in a comment would trip the guard on
 * itself.
 *
 * A linter would be the usual place for this, and there is no linter here.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Directories that hold no hand-written source. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'out',
  'var',
  'pgsql',
  '.git',
  'coverage',
]);

/** Extensions worth reading as text. */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
  '.md', '.css', '.yml', '.yaml', '.ps1', '.txt', '.example', '.prisma', '.sql',
]);

/**
 * A U+00C2, U+00C3 or U+00E2 is the signature of a UTF-8 sequence that was read
 * as latin1 and written back as UTF-8.
 *
 * Not sufficient on its own: a file may legitimately contain one of these
 * characters as real text. So a hit is reported with context and the assertion
 * is on the *absence* of the pattern in files that should be pure ASCII or
 * correct UTF-8. In practice a correctly encoded file never contains these.
 */
const MOJIBAKE = /[\u00C2\u00C3\u00E2\u00EF\u00E5\u00C4\u00CB]/;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield path.join(dir, entry.name);
    }
  }
}

describe('source encoding', () => {
  it('contains no double-encoded UTF-8', async () => {
    const offenders: string[] = [];

    for await (const file of walk(repoRoot)) {
      const text = await readFile(file, 'utf8').catch(() => null);
      if (text === null) continue;

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!MOJIBAKE.test(lines[i]!)) continue;
        const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
        const excerpt = lines[i]!.trim().slice(0, 70);
        offenders.push(`${relative}:${i + 1}  ${excerpt}`);
      }
    }

    assert.equal(
      offenders.length,
      0,
      'double-encoded UTF-8 found. Do not edit source with PowerShell Get-Content/Set-Content ' +
        'on a UTF-8 file: it reads with the ANSI codepage and re-encodes every non-ASCII ' +
        'character. Use the editor or a Node script.\n\n  ' +
        offenders.join('\n  '),
    );
  });

  it('reads emoji as a single code point where the fixtures use them', async () => {
    // The specific corruption this guard was written for: the seed's reaction
    // emoji, compared against the frontend fixture they are transcribed from.
    const seed = await readFile(path.join(repoRoot, 'database/prisma/seed.ts'), 'utf8');
    const fixture = await readFile(path.join(repoRoot, 'frontend/lib/data.ts'), 'utf8');

    // Compared as distinct sets: the seed holds one row per person, so a fixture
    // with two people reacting carries the same emoji twice in the seed and once
    // in the fixture.
    const distinct = (source: string) =>
      [...new Set([...source.matchAll(/emoji: '([^']+)'/g)].map((m) => m[1]!))].sort();

    const seedEmoji = distinct(seed);
    const fixtureEmoji = distinct(fixture);

    assert.ok(seedEmoji.length > 0, 'the seed should define reaction emoji');
    assert.deepEqual(
      seedEmoji,
      fixtureEmoji,
      'the seed must carry the same emoji, as single code points, as the fixtures',
    );
  });
});
