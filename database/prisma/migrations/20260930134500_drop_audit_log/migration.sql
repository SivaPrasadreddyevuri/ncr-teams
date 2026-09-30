-- Drop the audit log.
--
-- Hand-written for the same reason as the two-factor migration: `prisma
-- migrate dev` refuses to run non-interactively when it detects data loss, and
-- this is deliberate.
--
-- `AuditLog` was never written to. There was no code path that inserted a row,
-- no endpoint that read one, and the seed left it empty -- so the table and its
-- three indexes were pure storage cost implying a feature that did not exist.
-- An empty audit table is worse than no audit table, because a reader of the
-- schema reasonably assumes something records events into it.
--
-- `AuditAction` goes with it: an enum no code can insert into only exists to
-- populate that table.
--
-- The table comes back with the feature, when there is code that writes to it.

DROP TABLE "AuditLog";

DROP TYPE "AuditAction";
