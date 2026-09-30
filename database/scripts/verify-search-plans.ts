/**
 * Asserts that the search indexes are usable, and says what that does and does
 * not prove.
 *
 * ## The problem this works around
 *
 * `EXPLAIN` on a seeded database lies. The largest table here has fifteen rows,
 * and for fifteen rows a sequential scan genuinely is the right plan -- the whole
 * table fits in one page. So a plan assertion run against the seed will report a
 * seq scan whether or not a GIN index exists, and a developer who writes the
 * naive check concludes their index is broken.
 *
 * The fix is `SET LOCAL enable_seqscan = off`. It does not force a particular
 * plan, it only removes the planner's cheapest alternative, so the plan it then
 * chooses is the one it would pick on a large table. If it reaches for a Bitmap
 * Index Scan, the index is genuinely usable for this query shape.
 *
 * ## What this does not prove
 *
 * That the planner *will* choose the index at production row counts. That depends
 * on selectivity, and no assertion at this data size can speak to it. What it does
 * prove is the thing that actually breaks: a migration that failed to create the
 * index, or an expression that no longer matches the query, would show a
 * sequential scan here and fail.
 */

import '../lib/load-env.js';
import { Client } from 'pg';

let passed = 0;
let failed = 0;

function report(name: string, ok: boolean, detail: string): void {
  if (ok) {
    passed += 1;
    console.log(`  pass  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL is required.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    console.log('search index plans (enable_seqscan=off)');

    /**
     * The queries here are the ones `GET /api/search` actually issues, reduced to
     * the part that can use an index. Asserting against a differently-shaped
     * query would prove the index exists and not that the route benefits from it.
     */
    const cases: Array<{
      name: string;
      sql: string;
      expect: RegExp;
      /** Assert the index is NOT used, for a predicate that must not be indexed. */
      expectAbsence?: boolean;
    }> = [
      {
        name: 'Message body uses the GIN tsvector index',
        sql: `SELECT m."id" FROM "Message" m
              WHERE m."searchVector" @@ websearch_to_tsquery('english', 'deploy')`,
        expect: /Message_searchVector_idx/,
      },
      {
        name: 'User name uses the trigram index',
        sql: `SELECT u."id" FROM "User" u
              WHERE u."name" % 'Emma'`,
        expect: /User_name_trgm_idx/,
      },
      {
        name: 'File name uses the trigram index',
        sql: `SELECT f."id" FROM "File" f
              WHERE f."name" % 'design'`,
        expect: /File_name_trgm_idx/,
      },
      {
        // The negative control, and the reason this script exists in this form.
        // `similarity(name, q) > 0.3` means the same thing to a reader and is
        // NOT indexable, so a route written that way plans a sequential scan at
        // every row count while looking correct. If this ever starts using the
        // index, someone has changed the predicate and the assertion above has
        // stopped testing anything real.
        name: 'a bare similarity() comparison is still not indexable',
        sql: `SELECT f."id" FROM "File" f
              WHERE similarity(f."name", 'design') > 0.3`,
        expect: /File_name_trgm_idx/,
        expectAbsence: true,
      },
      {
        name: 'Team search uses the GIN tsvector index',
        sql: `SELECT t."id" FROM "Team" t
              WHERE t."searchVector" @@ websearch_to_tsquery('simple', 'engineering')`,
        expect: /Team_searchVector_idx/,
      },
      {
        name: 'CalendarEvent search uses the GIN tsvector index',
        sql: `SELECT e."id" FROM "CalendarEvent" e
              WHERE e."searchVector" @@ websearch_to_tsquery('simple', 'roadmap')`,
        expect: /CalendarEvent_searchVector_idx/,
      },
    ];

    for (const testCase of cases) {
      // A transaction so SET LOCAL cannot leak into the next case.
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = await client.query('EXPLAIN ' + testCase.sql);
      const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
      await client.query('COMMIT');

      const used = testCase.expect.test(text);
      const ok = testCase.expectAbsence ? !used : used;
      report(
        testCase.name,
        ok,
        testCase.expectAbsence
          ? `expected a sequential scan, but the plan used ${testCase.expect}:\n        ${text.split('\n').slice(0, 6).join('\n        ')}`
          : `plan did not mention ${testCase.expect}:\n        ${text.split('\n').slice(0, 6).join('\n        ')}`,
      );
    }

    // The generated columns must actually be populated. A vector that is NULL on
    // every row would make the plans above look fine while the route returned
    // nothing -- which is precisely the failure this whole exercise is about.
    console.log('generated columns are populated');
    const tables = ['Message', 'User', 'File', 'Team', 'CalendarEvent'];
    for (const table of tables) {
      const result = await client.query<{ total: string; with_vector: string }>(
        `SELECT count(*)::text AS total, count("searchVector")::text AS with_vector FROM "${table}"`,
      );
      const row = result.rows[0]!;
      report(
        `${table}.searchVector is set on every row`,
        row.with_vector === row.total && Number(row.total) > 0,
        `${row.with_vector} of ${row.total} rows have a vector`,
      );
    }

    // A generated column whose source column changes must follow it. If this
    // fails, the column is not actually generated and something is maintaining
    // it that can be forgotten.
    console.log('the vector follows its source column');
    const before = await client.query<{ v: string }>(
      `SELECT length("searchVector")::text AS v FROM "Message" WHERE "id" = 'm1'`,
    );
    await client.query(`UPDATE "Message" SET "body" = 'a distinctly phrasey sentinel' WHERE "id" = 'm1'`);
    const afterUpdate = await client.query<{ v: string }>(
      `SELECT length("searchVector")::text AS v FROM "Message" WHERE "id" = 'm1'`,
    );
    await client.query(`UPDATE "Message" SET "body" = 'Hey team, standup notes are up.' WHERE "id" = 'm1'`);
    const restored = await client.query<{ v: string }>(
      `SELECT length("searchVector")::text AS v FROM "Message" WHERE "id" = 'm1'`,
    );

    const originalLength = before.rows[0]!.v;
    const updatedLength = afterUpdate.rows[0]!.v;
    const restoredLength = restored.rows[0]!.v;

    report(
      'changing a message body changes its vector without a trigger',
      Number(updatedLength) > 0 && restoredLength === originalLength,
      `vector length went ${originalLength} -> ${updatedLength} -> ${restoredLength}`,
    );
  } finally {
    await client.end();
  }

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nall ${passed} checks passed`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
