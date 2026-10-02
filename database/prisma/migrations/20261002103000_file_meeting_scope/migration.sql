-- Files shared into a call.
--
-- A file shared in a meeting needs somewhere to live that is neither a channel nor a
-- message. `File` already carries a nullable scope per way of finding a file, so this
-- is a third one rather than a new table: the bytes, the download route, starring,
-- soft delete and search all keep working, and a file shared into a call is still one
-- row with one set of bytes rather than a copy per conversation.
--
-- Nullable and unindexed-then-indexed so this applies to the existing table without a
-- table rewrite. Every existing row gets NULL, which is correct: no file predates
-- calls.
--
-- `ON DELETE SET NULL` rather than CASCADE. A file in a meeting may also be attached
-- to a channel message, and ending a meeting should not destroy bytes somebody can
-- still reach by another route. The other scopes already behave this way; this keeps
-- the three consistent rather than introducing a fourth rule.

ALTER TABLE "File" ADD COLUMN "meetingId" TEXT;

-- The index is what makes "everything shared in this call" a lookup rather than a
-- scan. Prisma declares it in the schema, so unlike the generated tsvector columns
-- this one is drift-checked rather than allowlisted -- if the two ever disagree,
-- `npm run db:drift` fails instead of absorbing it.
CREATE INDEX "File_meetingId_idx" ON "File" ("meetingId");

-- Added late rather than inline: the column was nullable at the point every other
-- constraint was written, and Prisma emits a relation's foreign key with the column
-- it belongs to. Declaring it separately keeps that reversible -- dropping the column
-- drops the constraint with it.
ALTER TABLE "File"
  ADD CONSTRAINT "File_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;