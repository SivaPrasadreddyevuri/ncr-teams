/**
 * Search.
 *
 * One endpoint across five entity types, ranked in the database.
 *
 * ## Why this is raw SQL
 *
 * The page this replaced filtered and scored a fixture array in the browser: it
 * read every message, every file and every person, scored each in JavaScript, and
 * then threw most of them away. That works for a few hundred rows and cannot
 * work against a real table, because the ranking has to happen before the
 * limit -- otherwise you rank everything and return 20, and the 21st-best result
 * never existed as far as the caller is concerned.
 *
 * So the ranking is `ts_rank_cd` over a stored `tsvector`, and the limit applies
 * to already-ranked rows.
 *
 * ## Two kinds of match, on purpose
 *
 * `websearch_to_tsquery` gives the caller real operators -- `"exact phrase"`,
 * `or`, `-exclude` -- which the old substring scorer had no notion of. But a
 * tsvector only matches whole lexemes, so it would *not* find "redesign-notes.md"
 * when searching for "design", and the old scorer's substring tier existed
 * precisely to do that.
 *
 * So names and filenames additionally get `pg_trgm` similarity, and the two
 * signals are combined. Searching "design" finds both a channel called "design"
 * and a file called "dashboard-design.fig", which is what the old page did and
 * what a user actually expects.
 */

import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

export type SearchScope = 'people' | 'messages' | 'files' | 'events' | 'teams';

export type SearchResultDto = {
  id: string;
  scope: SearchScope;
  title: string;
  detail: string;
  context: string;
  href: string;
  /** Highlighted excerpt for long text. Absent where the title says it all. */
  snippet: string | null;
  /** Drives the recency tiebreak. Null for entities with no meaningful timestamp. */
  stamp: string | null;
  /** Relevance, for the client to show or debug. Not comparable across scopes. */
  rank: number;
};

type RawRow = {
  scope: SearchScope;
  id: string;
  title: string;
  detail: string;
  context: string;
  href: string;
  snippet: string | null;
  stamp: Date | null;
  rank: number;
};

const ALL_SCOPES: SearchScope[] = ['people', 'messages', 'files', 'events', 'teams'];

/**
 * The ranked union, as a reusable fragment.
 *
 * `Prisma.sql` rather than a template literal so the same SQL can be embedded in
 * two statements. The counts query needs the identical set of rows -- a second
 * copy of this would be a hundred lines that has to be edited in two places, and
 * a search where the chips and the results disagree is worse than no chips.
 *
 * It reads a CTE named `q` from the enclosing statement, which is what keeps
 * `websearch_to_tsquery` evaluated once per statement rather than once per row.
 */
function rankedUnion(userId: string, term: string) {
  return Prisma.sql`
    -- People. Ranked on the whole document (name + title + bio) but with the name
    -- weighted, so a search for someone's job title does not bury the people who
    -- are actually called that. The trigram term is what makes a partial name
    -- match: "chr" finds "Chris".
    SELECT
      'people'::text AS scope,
      u."id" AS id,
      u."name" AS title,
      coalesce(u."jobTitle", 'Team member') AS detail,
      coalesce(d."name", 'Directory') AS context,
      '/hr'::text AS href,
      NULL::text AS snippet,
      u."createdAt" AS stamp,
      (
        ts_rank_cd(u."searchVector", q.plain_query, 32) * 1.0
        + similarity(u."name", ${term}) * 0.8
      )::float8 AS rank
    FROM "User" u
    LEFT JOIN "Department" d ON d."id" = u."departmentId"
    CROSS JOIN q
    WHERE (
      u."searchVector" @@ q.plain_query
      -- The percent operator rather than "similarity(name, q) > 0.3". Both mean the
      -- same thing, but only the operator form is indexable: the trigram index can
      -- only serve a comparison it can prove implies the filter, and it cannot
      -- prove that against a literal threshold. The observable difference is that
      -- the "greater than" form silently plans a sequential scan, which is correct
      -- on fifteen rows and wrong on a million.
      --
      -- The threshold is now the session's pg_trgm.similarity_threshold rather than
      -- a number duplicated in this file.
      OR u."name" % ${term}
    )

    UNION ALL

    -- Messages. A title is the whole body, which would make every result row the
    -- same width, so the body is truncated for display and the matching text is
    -- carried in the snippet instead. ts_headline does the highlighting
    -- server-side because only it knows which words the tsquery actually matched.
    --
    -- Gated on channel membership for the same reason GET /api/messages gates
    -- them: a search box that returns the contents of channels you are not in is
    -- a way to read them without opening them. The EXISTS is correlated against
    -- the caller's memberships, so the gate lives in the query rather than in a
    -- lookup a second statement could forget.
    SELECT
      'messages'::text,
      m."id",
      left(m."body", 80) AS title,
      coalesce(u."name", 'Unknown') AS detail,
      coalesce(c."name", 'Message') AS context,
      '/chat'::text,
      ts_headline('english', m."body", q.msg_query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=12') AS snippet,
      m."createdAt" AS stamp,
      (
        ts_rank_cd(m."searchVector", q.msg_query, 32) * 1.2
        + CASE WHEN m."userId" = ${userId} THEN 0.15 ELSE 0 END
      )::float8 AS rank
    FROM "Message" m
    LEFT JOIN "User" u ON u."id" = m."userId"
    LEFT JOIN "Channel" c ON c."id" = m."channelId"
    CROSS JOIN q
    WHERE (
      m."deletedAt" IS NULL
      AND m."searchVector" @@ q.msg_query
      AND (
        m."channelId" IS NULL
        OR EXISTS (
          SELECT 1
          FROM "Channel" ch
          JOIN "TeamMember" tm ON tm."teamId" = ch."teamId"
          WHERE ch."id" = m."channelId" AND tm."userId" = ${userId}
        )
      )
    )

    UNION ALL

    -- Files. Ranked on trigram similarity against the name as well as the
    -- tsvector, because a filename is the case substring matching was invented
    -- for. Folders are included: a folder is a file with no bytes, and "the Design
    -- folder" is exactly what someone means.
    SELECT
      'files'::text,
      f."id",
      f."name" AS title,
      CASE WHEN f."isFolder" THEN 'Folder' ELSE pg_size_pretty(f."sizeBytes") END AS detail,
      coalesce(t."name", 'Workspace') AS context,
      '/files'::text,
      NULL::text,
      f."createdAt",
      (
        similarity(f."name", ${term}) * 1.0
        + ts_rank_cd(f."searchVector", q.plain_query, 32) * 0.4
      )::float8 AS rank
    FROM "File" f
    LEFT JOIN "Team" t ON t."id" = f."teamId"
    CROSS JOIN q
    WHERE (
      f."deletedAt" IS NULL
      AND (
        f."searchVector" @@ q.plain_query
        -- The operator form, for the reason given in the people branch.
        OR f."name" % ${term}
      )
    )

    UNION ALL

    -- Events. Only upcoming ones: an event in the past is a search result nobody
    -- acts on, and the calendar behind the link shows today anyway.
    SELECT
      'events'::text,
      e."id",
      e."title" AS title,
      coalesce(e."location", 'No location') AS detail,
      to_char(e."startsAt" AT TIME ZONE 'Asia/Kolkata', 'Dy, DD Mon') AS context,
      '/calendar'::text,
      NULL::text,
      e."startsAt",
      ts_rank_cd(e."searchVector", q.plain_query, 32)::float8 AS rank
    FROM "CalendarEvent" e
    CROSS JOIN q
    WHERE e."startsAt" >= now() AND e."searchVector" @@ q.plain_query

    UNION ALL

    -- Teams. Weighted lowest, because a team is the least specific thing a search
    -- term can mean -- "engineering" is more likely to mean a person or a channel.
    SELECT
      'teams'::text,
      t2."id",
      coalesce(t2."name", '(unnamed team)') AS title,
      coalesce(t2."description", '') AS detail,
      (
        SELECT count(*)::int FROM "TeamMember" c WHERE c."teamId" = t2."id"
      )::text || ' members' AS context,
      '/teams'::text,
      NULL::text,
      t2."createdAt",
      (ts_rank_cd(t2."searchVector", q.plain_query, 32) * 0.6)::float8 AS rank
    FROM "Team" t2
    CROSS JOIN q
    WHERE t2."searchVector" @@ q.plain_query
  `;
}

/** The `q` CTE, shared so the tsquery is built once per statement. */
const queryCte = (term: string) => Prisma.sql`
  q AS (
    SELECT websearch_to_tsquery('english', ${term}) AS msg_query,
           websearch_to_tsquery('simple', ${term}) AS plain_query
  )
`;

export function searchRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const query = z
      .object({
        q: z.string().min(1).max(200),
        scope: z.enum(['all', ...ALL_SCOPES]).default('all'),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);

    const userId = req.user!.id;

    /**
     * An empty tsquery matches nothing, and it matches nothing *silently* -- so a
     * query of only stopwords ("the", "and") would return zero results with no
     * explanation, which reads as a broken search box.
     *
     * `length(to_tsvector('simple', ...))` of the raw text is the emptiness test
     * because it keeps stopwords: "the" gives a vector of length 1 under 'simple'
     * and length 0 under 'english', which would let the same word behave
     * differently from a real search.
     *
     * `length` and not `numnode`: numnode takes a tsquery, not a tsvector, and
     * fails to resolve rather than erroring usefully.
     */
    const hasContent = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT length(to_tsvector('simple', ${query.q})) > 0 AS ok
    `;

    if (!hasContent[0]?.ok) {
      sendJson(res, 200, {
        results: [],
        counts: Object.fromEntries(ALL_SCOPES.map((scope) => [scope, 0])),
        query: query.q,
        scope: query.scope,
      });
      return;
    }

    const union = rankedUnion(userId, query.q);

    /**
     * The results, and the per-scope counts, from one ranked set.
     *
     * Both statements run every branch regardless of the requested scope, and the
     * scope filter is applied to the results *after* ranking. Two reasons, and the
     * second is the important one:
     *
     * 1. Ranking is only comparable within one result set. Filtering inside each
     *    branch would rank each scope against itself, and the combined "All"
     *    ordering would be a comparison of incomparable numbers.
     * 2. The counts have to be exact and have to come from the same rows the
     *    results come from. A count next to a differently-filtered list is a small
     *    lie: "Files 4" above two files.
     *
     * The cost is that a files-only search also considers messages, which the
     * indexes make cheap.
     *
     * The counts are a second statement rather than a window function because the
     * first has a LIMIT, and `count(*) OVER (PARTITION BY scope)` applied there
     * would count the twenty rows that survived the limit -- exactly the number
     * that must not be shown.
     */
    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw<RawRow[]>`
        WITH ${queryCte(query.q)}, results AS (${union})
        SELECT scope, id, title, detail, context, href, snippet, stamp, rank
        FROM results
        WHERE ${query.scope} = 'all' OR scope = ${query.scope}
        -- rank DESC, then newest first. The tiebreak is on the timestamp so a
        -- page of equally-ranked results is ordered by something meaningful rather
        -- than by whatever order the index happened to return.
        ORDER BY rank DESC, stamp DESC NULLS LAST
        LIMIT ${query.limit}
      `,
      prisma.$queryRaw<Array<{ scope: SearchScope; count: number }>>`
        WITH ${queryCte(query.q)}, counted AS (${union})
        SELECT scope, count(*)::int AS count FROM counted GROUP BY scope
      `,
    ]);

    const results: SearchResultDto[] = rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      title: row.title,
      detail: row.detail ?? '',
      context: row.context ?? '',
      href: row.href,
      snippet: row.snippet,
      stamp: row.stamp ? new Date(row.stamp).toISOString() : null,
      rank: Number(row.rank),
    }));

    // Every scope is present, including the zeroes, so the client can render a
    // count without knowing which scopes exist.
    const counts = Object.fromEntries(ALL_SCOPES.map((scope) => [scope, 0])) as Record<
      SearchScope,
      number
    >;
    for (const row of countRows) counts[row.scope] = Number(row.count);

    sendJson(res, 200, { results, counts, query: query.q, scope: query.scope });
  });

  return router;
}
