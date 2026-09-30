-- Full-text and trigram search.
--
-- The search page ranked candidates in the browser with a substring heuristic:
-- exact match beat prefix, prefix beat word-boundary, substring came last. It
-- worked on a fixture array of a few hundred rows and cannot work against a real
-- table, because the ranking has to happen before the limit.
--
-- So ranking moves into the database, and the two shapes of query PostgreSQL does
-- well are used for two different jobs:
--
--   * tsvector + GIN for message bodies, where relevance ranking is the point.
--     to_tsvector('english', ...) stems, so "running" finds "run", which no
--     substring comparison does.
--   * pg_trgm for names, where the old scorer's substring tier was doing real
--     work: searching "design" has to find "redesign-notes.md", and a tsvector
--     would not, because "redesign" is a different lexeme.
--
-- Every column below is GENERATED ALWAYS ... STORED rather than maintained by a
-- trigger. A trigger is code that has to remember to run, and the failure mode
-- when it does not is a search index that silently returns nothing for rows
-- inserted after the last write it did see. A generated column cannot drift from
-- its source: there is no second copy to keep in step.

-- Trigram similarity. Available on Neon and on plain PostgreSQL as a contrib
-- module, so this needs no hosting decision.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Messages. 'english' rather than 'simple' because bodies are prose, and
-- stemming is the point -- "deployed" and "deploy" are the same word to a reader.
ALTER TABLE "Message"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "body")) STORED;

CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");

-- People. 'simple' because stemming actively hurts a name: 'english' reduces
-- "Chris" to "chri" and "Dana" to "dana" but "Racing" to "racing", so a search
-- for a name stops matching itself.
ALTER TABLE "User"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce("name", '') || ' ' || coalesce("jobTitle", '') || ' ' || coalesce("bio", '')
    )
  ) STORED;

CREATE INDEX "User_searchVector_idx" ON "User" USING GIN ("searchVector");

-- Trigram, because a name is the case the substring tier existed for.
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);

-- Files. Name only: indexing the bytes would mean indexing a 5 MB blob per row
-- to find a document by its filename, which is the wrong trade at this size.
ALTER TABLE "File"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "name")) STORED;

CREATE INDEX "File_searchVector_idx" ON "File" USING GIN ("searchVector");
CREATE INDEX "File_name_trgm_idx" ON "File" USING GIN ("name" gin_trgm_ops);

-- Events.
ALTER TABLE "CalendarEvent"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("location", ''))
  ) STORED;

CREATE INDEX "CalendarEvent_searchVector_idx" ON "CalendarEvent" USING GIN ("searchVector");

-- Teams. Both columns are nullable, hence the coalesce: a generated column's
-- expression has to be total, or inserting a team with no name fails.
ALTER TABLE "Team"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", ''))
  ) STORED;

CREATE INDEX "Team_searchVector_idx" ON "Team" USING GIN ("searchVector");
