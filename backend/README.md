# Backend

Express 5 + TypeScript API for NCR Teams. Deployed to Render; the database is
Neon Postgres.

**Status: foundation, auth, read paths, messages and files are built.** Meetings,
calendar, attendance, leave, search and the WebSocket are Phase 2c.

## What exists

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health`, `GET /api/health/ready` |
| Auth | `POST /login`, `/verify-2fa`, `/logout`, `GET /me`, `POST /2fa/setup`, `/2fa/enable`, `/2fa/disable` |
| People | `GET /api/users`, `GET /api/users/:id`, `PATCH /api/users/me` |
| Teams | `GET /api/teams`, `GET /api/teams/:id` |
| Channels | `GET /api/channels?teamId=`, `POST /api/channels/:id/read` |
| Departments | `GET /api/departments` |
| Activity | `GET /api/activity?limit=&before=` |
| Messages | `GET/POST /api/messages`, `POST /api/messages/:id/reactions`, `DELETE /api/messages/:id` |
| Files | `GET /api/files`, `POST /api/files`, `GET /api/files/:id/download`, `POST /api/files/:id/star`, `DELETE /api/files/:id` |

`GET /api/activity` resolves each notification's target, so the feed is built
from structured fields rather than the frozen prose the fixtures carried.

## Messages

**Cursor pagination, not `OFFSET`.** `OFFSET` re-counts from the start each page,
so a message arriving mid-scroll shifts the window: the reader sees a duplicate
at one end and a gap at the other. The cursor is the `(createdAt, id)` pair the
previous page ended on, base64url-encoded so a client cannot construct an invalid
one. The `id` tiebreak matters — two messages can share a `createdAt` millisecond,
and a timestamp-only comparison drops one.

**Soft delete.** `DELETE` empties the body and sets `deletedAt`; the row stays.
A hard delete would leave every reply pointing at nothing and renumber the
thread. Reactions on a tombstone are refused, so deleted content cannot be
surfaced again by an emoji.

**Reactions** are one row per `(user, message, emoji)` — the only shape that can
prevent a double-tap creating two identical rows — and are grouped into
`{ emoji, userIds }` on the way out, which is the read shape the fixture uses.

## Files

Bytes live on local disk under `backend/var/uploads`; `File.storageKey` is a
server-generated key. Three properties are load-bearing:

- **A key never becomes a path unchecked.** `resolveKey` resolves it and then
  confirms the result is still inside the root, so `../`, an absolute path, a
  null byte, and the sibling-directory case (`uploads-evil` beside `uploads`, which
  a plain `startsWith` would accept) are all rejected.
- **The filename never reaches the key.** Only the name is honoured, and only as
  a short alphanumeric extension. A double extension is truncated to the last
  one. The original name is stored as a label and sanitised before going into
  `Content-Disposition`.
- **Uploads stream, and the cap is busboy's.** A multipart body is piped straight
  to disk and counted in flight. busboy owns the limit because it truncates the
  part and keeps parsing, so the 413 is actually delivered — an earlier version
  let the byte counter destroy the stream first, which killed the parser, so
  `close` never fired and the request hung until the client gave up.

**Missing bytes are a 410, not a 404.** A row can outlive its content here (see
below), and "gone" is a different situation from "never existed"; the client can
say something useful about each. `FileDto.uploaded` reports the same thing in a
listing, so a row with no content does not render as a working download button.

### Ephemeral by design

Render's free tier wipes the filesystem on every deploy and instance restart.
Database rows survive, so a row whose bytes are gone is a normal state here, not
an edge case. Uploads therefore do not persist across a deploy.

That is a deliberate simplification for a showcase. Cloudflare R2 is the fix if
this ever needs to outlive a deploy, and the account is already needed for TURN;
it was skipped because it buys nothing a viewer of the demo would notice.

## Realtime bus

`src/realtime/bus.ts` is a typed in-process emitter. The message and file routes
publish to it; Phase 2c subscribes a WebSocket broadcaster to the same events.
That keeps `ws` out of the request path, so the broadcast contract is testable
without a listening server.

Events are in-process only: a `message.created` on one instance does not reach a
browser on another. Correct for a single instance, and a Redis pub/sub fan-out at
this exact seam is the change if it is ever more than one.

## Stack, and where it changed

| Concern | Choice | Note |
| --- | --- | --- |
| Runtime | Node 24 | Matches `.nvmrc` and the frontend build |
| Framework | Express 5 | Async handler rejections are forwarded to the error middleware natively |
| Database | **Prisma 6.19** | Was `pg` |
| Migrations | **Prisma** | Was "plain versioned SQL" |
| Validation | Zod | Unchanged |
| Auth | Session cookie, httpOnly | Unchanged |
| Passwords | Argon2id | 19 MiB, 2 iterations, parallelism 1 |
| 2FA | TOTP, in-house on `node:crypto` | |
| Realtime | `ws` | Phase 2b |

**Why Prisma instead of `pg`.** The original note asked for no ORM. Two things
changed the answer: Prisma's types catch a schema/API mismatch at compile time,
and `migrate deploy` in CI fails on drift. Running `pg` alongside it would have
meant two database layers and two sets of type definitions. `database/README.md`
lists the full set of divergences.

The Prisma **client** is the only database access path. `backend/src/db.ts` holds
one singleton — Prisma owns a connection pool, so a client per request would open
a pool per request.

## Two connection URLs

`DATABASE_URL` is pooled, for request handling. `DIRECT_DATABASE_URL` is not, for
migrations.

On Neon the pooled URL is the `-pooler` host and needs `?pgbouncer=true`, which
tells Prisma the pooler is in transaction mode so it does not use prepared
statements. Migrations must **not** use it: DDL and session state do not survive
a transaction pooler, which is why the Prisma datasource declares `directUrl`
separately. Locally both point at the same cluster, since there is no pooler.

## Sessions

A 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie. The database
stores an HMAC of it keyed by `SESSION_PEPPER`, never the token, so a database
leak does not yield usable cookies.

Rows, not stateless JWTs — a JWT cannot be revoked before it expires, so sign-out
and "this account is compromised" would both be unimplementable. Signing in ends
any previous session for that user; a single-session policy is the simplest thing
that cannot leak, and the table is ready for the multi-session variant.

`SESSION_PEPPER` has no default. A service that boots with a shared fallback is a
service whose sessions are forgeable by anyone who has read the source, so a
missing value is a boot failure. `render.yaml` has Render generate one and keep
it stable — **copy it from the Render dashboard into `backend/.env`** for local
work to produce cookies that verify in production.

### CSRF

The session cookie is sent automatically on a cross-site request, so cookie auth
alone is not enough. The `ncr_csrf` cookie is deliberately readable by JS; the
frontend echoes it in an `x-csrf-token` header, and a cross-site attacker cannot
read a cookie to set a matching header. Checked on every unsafe method, globally,
so a new route is protected by default rather than by remembering.

`GET`/`HEAD`/`OPTIONS` are exempt — requiring a token on them would break the
browser's preflight.

## 2FA

Two-step login. With 2FA enabled, `POST /login` does **not** create a session: it
returns a short-lived challenge token, and only `POST /verify-2fa` with a valid
code issues the session. Logging in first and attaching 2FA afterwards would mean
a stolen password alone gets a real session.

Challenges are rows in `Session`, marked by `PENDING_CHALLENGE_MARKER`, because
they have the same lifecycle. `resolveSession` returns null for that marker, which
is what stops a challenge token being usable as a session cookie. A challenge is
deleted before its code is checked, so a code observed inside its 30-second
window cannot be replayed.

Enrolment is two steps (`/2fa/setup` returns the secret, `/2fa/enable` proves a
code). `twoFactorEnabled` is only set on the second, so a user who abandons
enrolment is not locked out.

## Responses

Only `src/serialise.ts` writes JSON, and it converts `BigInt` to a string.

`File.sizeBytes` is `BigInt` and `JSON.stringify` throws on it. That failure is
late and route-specific — the handler that built the response is correct and the
object is inspectable — so it is caught centrally instead. A test asserts both
that the raw serialisation throws and that the helper does not.

Errors are always `{ error: { code, message } }`, plus `details` on a validation
failure. Never a stack trace, a Prisma message or a SQL fragment.

## Configuration

`src/config.ts` validates at import and throws with every missing variable
listed. Development-only CORS is configured but unset in production, and
`TRUST_PROXY_HOPS` must be at least 1 when `NODE_ENV=production`, because the
session cookie is only `Secure` over HTTPS.

See `.env.example`.

## Same-origin by proxying

`frontend/next.config.ts` rewrites `/api/*` to this service, so from the browser
both are the same origin: no cross-site cookie, no `SameSite=None` relaxation,
and CORS is not involved in production at all. It stays configured for local
development, where the two run on different ports.

The rewrite is inert until `API_ORIGIN` is set, so a build without it still
succeeds.

## Demo sign-in

```bash
npm run demo:signin --workspace backend   # one shared password for all 8 users
npm run demo:files  --workspace backend   # real bytes behind the 9 seeded files
```

The seed deliberately leaves `passwordHash` null, so nobody can sign in until one
is set. `demo:signin` is the bulk form of `user:password`; it defaults to
`showcase-2026`, which is committed in `package.json` and shown on the login
page. **That is deliberate and it is a public credential** — anyone who can load
the page can sign in either way, so hiding it buys nothing. Do not reuse the
value for anything real; `user:password --random` prints a fresh one for a
genuine account.

Set `NEXT_PUBLIC_DEMO_EMAIL` / `NEXT_PUBLIC_DEMO_PASSWORD` in the frontend so the
login page shows the credentials.

`demo:files` exists because the seed creates file *rows* with no content, which
leaves every download in the demo returning 410. It writes a genuinely valid
minimal PDF, a real PNG and JPEG, and real Markdown, keyed to the seeded
`storageKey`s. `.fig` and `.pptx` get a short text stub instead: a valid download
that opens in a text editor, which is honest and still not a broken button. The
PDF is assembled with real cross-reference byte offsets, so it is a valid PDF and
not merely a plausible one.

Both are idempotent and safe to re-run — which matters, because on the free tier
they need re-running after every deploy.

## Tests

```bash
npm test --workspace backend
```

112 tests: auth and session behaviour, the read endpoints, messages, files,
storage containment, and an encoding guard.

`node:test`, no framework — the repo has none, and the earlier frontend ad-hoc
scripts were removed for exactly that reason.

`pretest` creates `ncr_teams_test`, applies the real migrations and runs the real
seed, so the suite exercises the shipped artefacts rather than a fixture built to
match it. The test database is separate because tests truncate.

The app is mounted on an ephemeral port and driven over HTTP, not called
directly, because the things most likely to break — cookie flags, CSRF, status
codes, BigInt serialisation — all live in the middleware and the response path.

Tests set up their own preconditions rather than assuming a pristine database, so
the suite is safe to run repeatedly without a re-seed in between. Three separate
bugs here were tests that passed once and failed on the second run.

### The encoding guard

`test/encoding.test.ts` fails on any double-encoded UTF-8 in the source tree.
Windows PowerShell's `Get-Content -Raw` reads with the ANSI codepage, so
reading a UTF-8 file and writing it back silently re-encodes every non-ASCII
character. That corrupted a reaction emoji in the seed and an em dash in a CSS
comment, and nothing noticed: the seed ran, the tests passed, and the database
held the wrong bytes. There is no linter here to catch it, so a test does.

## Not yet built

Meetings, calendar, attendance, leave, HR actions, search, and the `/ws`
endpoint with presence. Those pages still render from the frontend fixtures, which
already look correct, so they are deliberately not wired yet.
