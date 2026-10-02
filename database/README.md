# Database

Prisma 6.19 schema, migrations and demo seed for NCR Teams.

**Status: built.** Seven migrations, 18 models (19 tables — `File.starredBy` gets
an implicit join table), 9 enums. The migrations apply cleanly to an empty
database and CI replays them, seeds and verifies on every push.

This workspace is **not deployed**. It is the schema of record; the application
never serves it.

## The shape follows the fixtures

`frontend/lib/data.ts` defines what the UI renders today, so it — not this
README — is the contract the seed reproduces. Where the original design note and
the fixtures disagreed, the fixtures won and the difference is recorded inline in
`prisma/schema.prisma`. The ones worth knowing before you query this:

| Field | Why it is not what you might expect |
| --- | --- |
| `Message.userId` | The fixture calls this `authorId`. The API maps it, so the column is named for what it is. |
| `File.sizeBytes` | `BigInt`, because a file can exceed 2^31. **It throws on `JSON.stringify`** — see below. |
| `File.content` | Nullable `Bytes` (`bytea`), not a path to somewhere else. The bytes live in the row. Null means "no content" — a folder, or a seeded row `demo:files` has not filled. |
| `Attendance.date` | A `date` column, not a timestamp. An attendance day is calendar-local. |
| `LeaveRequest.fromDate` | A timestamp, not a `date`. The leave form captures a window *inside* a day ("09:00 to 17:00"), so truncating to a date would discard what the user typed. |
| `Channel` | No `lastMessage`, `lastAt` or `unread` column. All three are derived — see below. |
| `Team` | No `memberCount` or `channelCount` column. Both are counts of real rows. |

### `BigInt` will bite you

`File.sizeBytes` is `BigInt`. `JSON.stringify` on a raw Prisma `File` throws a
`TypeError`, and only when a response is actually serialised, so it escapes
typecheck. Every API response that includes a file must convert it. The seed
asserts this deliberately: `db:verify` checks that serialising a raw row throws,
so the trap stays visible.

### `bytea`, and why the cap is 5 MB

`File.content` is the file's bytes. The obvious alternative — metadata here, a
`storageKey` pointing at a file on disk — was the previous arrangement, and on
Render's free tier the filesystem is wiped on every deploy while the rows
survive. That produced a routine "row exists, content does not" state which
needed a 410 branch to explain. Storing the bytes in the row removes the state
instead of documenting it.

`bytea` is only the right choice while files are small, which the 5 MB upload cap
enforces. `db:verify` checks that `sizeBytes` equals the real length of any
attached content, because that value is set into `Content-Length` and a
disagreement would make a download hang or truncate. If genuine multi-megabyte
uploads ever matter, the content belongs in object storage and `File` keeps a key
again.

## Search: what PostgreSQL is doing that a string comparison could not

Five tables carry a `searchVector` column, added by
`20260930090000_search_indexes` as `GENERATED ALWAYS AS ... STORED` with a GIN
index. Generated rather than trigger-maintained, because a trigger is code that
has to remember to run and its failure mode is an index that silently returns
nothing for rows written after the last time it did.

Two kinds of match, because they answer different questions:

| Where | How | Why not the other one |
| --- | --- | --- |
| `Message.body` | `to_tsvector('english', ...)` | Stemming. "deploy" finds "Deploy", "deployed", "deployment". A substring comparison finds none of them. |
| `User`, `File`, `Team`, `CalendarEvent` | `to_tsvector('simple', ...)` | **No** stemming. `english` reduces "Chris" to "chri", so a search for someone's own name stops matching them. |
| `User.name`, `File.name` | `pg_trgm` similarity | A tsvector only matches whole lexemes, so it cannot find `dashboard-design.fig` from "design". Trigrams can. |

`pg_trgm` is the reason substring search survived the move to the database, and
it is also the reason the query is written with the `%` operator rather than
`similarity(name, q) > 0.3`. Both mean the same thing, but only the operator form
reaches the index — see the negative control in `npm run db:verify:plans`.

### `migrate dev` is not used, and cannot be

This is the one part of the schema Prisma cannot represent. `prisma migrate diff`
reports all five generated columns as drifted and all five GIN indexes as
removable:

```
[*] Altered column `searchVector` (default changed from Some(DbGenerated(...)) to None)
[-] Removed index on columns (searchVector)
```

So `migrate dev` would helpfully write a migration that drops the generation
expressions and the indexes. It applies cleanly, the app keeps working, and search
returns nothing forever after — the only symptom is an empty search box.

Therefore:

- Migrations are hand-written and applied with `npm run db:deploy`.
- `npm run db:drift` asserts the diff still contains *only* the known entries. A
  genuinely unintended change fails the check instead of hiding among the five
  expected ones.
- `npm run db:verify:plans` asserts the indexes are actually usable, which is the
  failure a missing index would produce.

Declaring the columns as `Unsupported("tsvector")?` stops Prisma reporting them
as *missing*, which shortens the allowlist. It does not protect them, and the
schema comment says so rather than implying a safety that does not exist.

## Deliberately derived, not denormalised

- **Channel `lastMessage` / `lastAt`** — a join against the newest `Message`.
  Persisting them would mean two more columns to keep consistent with the rows
  they summarise, for data one query away.
- **Channel `unread`** — a count of `Message` rows newer than the viewer's
  `ChannelReadState.lastReadAt`. This is *why* that table exists: unread is a
  property of a reader, so it cannot live on `Channel`.
- **Team `memberCount` / `channelCount`** — `COUNT` over `TeamMember` and
  `Channel`.

The consequence is worth stating: the fixture numbers are org-wide
(`memberCount: 12` for a team the directory lists three people in), so the seeded
counts are the real, smaller ones. The Teams page will show different numbers
than the mock did. That is the fixtures being decorative, not a data problem.

## How this differs from the original design note

Substantial enough to list, since the note is otherwise still accurate:

- **Prisma, not raw SQL.** The note specified plain numbered SQL with no ORM. Two
  reasons to reconsider: Prisma's types catch a schema/API mismatch at compile
  time, and `migrate deploy` in CI fails on drift. Hand-rolled migration tracking
  was the larger risk.
- **`cuid()` ids, not `uuid`.** Shorter, sortable, and URL-safe without encoding.
- **`meeting_messages` folded into `Message`** with a nullable `meetingId`, and
  `attachments` as an implicit many-to-many to `File`. Chat in a meeting and chat
  in a channel are the same shape; separate tables would duplicate reactions,
  threading and attachments.
- **`channel_members` was not built.** Every fixture channel's membership is
  exactly its team's membership, so a second table would be redundant today. It
  is needed before `ChannelType.PRIVATE` can mean anything — until then the API
  derives channel members from the team.
- **`leave_requests.from` / `to` are named `fromDate` / `toDate`** because `from`
  is a reserved SQL word and would need quoting everywhere.
- **`twoFactorEnabled` gained its `twoFactorSecret`.** The note had the boolean
  without the secret, which makes `/verify-2fa` impossible to implement.
- **`Session.tokenHash` stores a hash, not the token**, and gained `csrfSecret`
  and `revokedAt`. Without revocation a signed-out session stays valid until it
  expires.
- **Added `ChannelReadState`, `Notification` and `AuditLog`** — the activity feed
  and the unread badge had no table in the note.
- **`Attendance` uses a surrogate key plus `@@unique([userId, date])`** rather
  than a composite primary key, because Prisma requires a single-field `@id`.
  The uniqueness that makes check-in idempotent is unchanged.

## Local cluster

The repository carries a PostgreSQL 17.10 cluster under `pgsql/`, on **port
5433** — deliberately not 5432, so it never collides with another PostgreSQL on
the same machine. The whole directory is gitignored: the binaries are vendor
files, and `pgsql/data` is machine-local state.

The bundled build contains only `initdb`, `pg_ctl` and `postgres`. There is no
`psql` or `createdb`, which is why `db:bootstrap` issues the administrative SQL
through the `pg` driver instead.

```powershell
.\scripts\db-init.ps1     # initdb, start, create the role and database
.\scripts\db-start.ps1    # start (no-op if already up)
.\scripts\db-stop.ps1     # stop, matched on this project's binary path
.\scripts\db-reset.ps1    # drop, replay migrations, seed, verify
```

## Commands

```bash
npm run db:bootstrap   # create the application role and database
npm run db:validate    # parse the schema
npm run db:generate    # regenerate the client
npm run db:migrate -- --name <name>
npm run db:deploy      # apply migrations, no prompts — use in CI
npm run db:reset       # drop, replay, seed
npm run db:seed        # load the demo fixtures
npm run db:verify      # assert the seeded values, not just the row counts
npm run db:studio      # browse the data
```

`db:seed` **truncates**. It refuses to run against a populated database unless
`SEED_ALLOW_WIPE=true` is set, so it cannot quietly discard real data.

`db:verify` is the one that matters. It checks *values* — that a 10:00 standup is
still 10:00 in `Asia/Kolkata`, that leave kept its time of day, that no person
has two attendance rows on one day, that `c1` reports two unread. A row count
cannot catch a timestamp stored in the right column but resolved against the
wrong timezone, which is the failure mode this schema is most exposed to.

## Timezones

`Asia/Kolkata` is pinned in `frontend/lib/format.ts` and mirrored in
`lib/app-time.ts`. Authored wall-clock times are resolved against that zone, never
the host's, so the demo reads the same on a UTC CI runner as on a machine set to
the office's timezone.

The two are copies rather than a shared package: `format.ts` is bundled for the
browser and this workspace must not depend on the frontend's build output. If the
zone ever changes, change it in both.
