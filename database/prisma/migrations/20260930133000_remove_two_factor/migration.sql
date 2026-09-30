-- Drop the two-factor columns.
--
-- Hand-written rather than generated. `prisma migrate dev` refuses to run
-- non-interactively when it detects data loss, and this is data loss by design:
-- the columns are removed on purpose, not by accident.
--
-- The TOTP implementation behind them was correct and tested. It is removed
-- because nothing in the application could ever turn the factor on -- the setup
-- screen was never wired to the API -- so once the setup UI is gone the login
-- challenge is unreachable and both columns are dead weight on every user row.
-- Both come back with the feature.
--
-- `twoFactorEnabled` is a NOT NULL boolean with a default, so the eight seeded
-- rows all carry a value that is now discarded. No other table references these
-- columns, so nothing else needs to change.

ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
ALTER TABLE "User" DROP COLUMN "twoFactorSecret";
