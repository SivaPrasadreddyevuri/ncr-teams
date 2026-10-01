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

Bytes live in the `File.content` column (`bytea`). A row and its content are
written in one statement and cleared together on delete, so the two can never be
separated. Three properties are load-bearing:

- **The filename never becomes a path.** There are no paths. `File.storageKey` is
  a server-generated identity, not a location, and nothing turns it into one. The
  user-chosen name is stored as a label and sanitised before going into
  `Content-Disposition` — quotes, backslashes and newlines are replaced and the
  value is truncated, so a name cannot inject response headers.
- **The cap is enforced in flight.** The byte counter stops collecting the moment
  it passes `MAX_UPLOAD_BYTES` (5 MB by default) and destroys the part, rather
  than collecting the whole body and checking afterwards — that would let a caller
  send an unbounded body. This replaced a busboy-owned limit, which truncated the
  part silently and left a row holding half a file.
- **Uploads are a small buffer, not a stream.** The old rule was "never buffer,
  write to disk". That was about a 50 MB body on a small instance; at 5 MB the
  bytes cross a function call rather than a filesystem, so the streaming layer,
  the containment checks and the partial-file cleanup are all gone.

**Content-less rows are a 410, not a 404.** A seeded row whose content
`npm run demo:files` has not attached is known to exist and has nothing to serve,
which is a different situation from never having had an id. `FileDto.uploaded`
reports the same thing in a listing, so such a row does not render as a working
download button.

### Why the bytes moved into the database

They were on local disk, under `backend/var/uploads`. Render's free tier wipes
that filesystem on every deploy and instance restart while the rows survive, so
"metadata without content" was a routine state that needed the 410 branch above
to explain. Moving the bytes into the row removes the failure mode rather than
documenting it, and it removes the reason for the streaming and path-handling
machinery.

The cap is what makes this affordable: 5 MB per file keeps a demo's worth of
uploads far inside a hosted Postgres free tier, and `bytea` is only appropriate
while that stays true. The moment genuine multi-megabyte uploads matter, the
content belongs in object storage and `File` keeps a key again.

## Realtime

### The WebSocket (`/ws`)

Attached to the same HTTP server as the API. One process, one port, one origin
to allow — which matters because the free-tier instance sleeps when idle, and a
second long-polling service would keep it awake for no benefit.

Client to server: `subscribe`, `typing.start`, `typing.stop`, `ping`.
Server to client: the frames the event bus publishes, plus `ready`, `subscribed`,
`presence.changed`, `pong` and `error`. Every frame is `{ type, payload }`, so a
client switches on one field.

**Message delivery is not the socket's job.** A client POSTs to the REST API,
which validates, authorises, persists and publishes. The socket only relays the
event. A socket that could write would need the same validation, the same
authorisation and the same audit path as the HTTP route, and there is no version
of that worth maintaining twice.

**The publisher's own socket is skipped** for `message.created`, because that
client already has the message from the HTTP response it just received.

**Subscription is not a claim of membership.** The `subscribe` frame is checked
against team membership before a socket is granted a channel, so an authenticated
socket cannot name an arbitrary channel id and start receiving its traffic.

### Connection tokens

`GET /api/auth/ws-token` returns a token for 60 seconds.

It exists because the session cookie cannot do this job. The cookie is
`SameSite=Lax`, and a WebSocket to another origin is a cross-site request, so the
browser would not attach it. The alternative was `SameSite=None; Secure`, which
reopens CSRF on every REST route in exchange for solving a problem a token solves
better.

The token is an HMAC over `userId.expiry`, keyed by the same `SESSION_PEPPER`, so
it cannot be used against the REST API even if it leaks, and the user id cannot
be edited without invalidating the signature. The REST API is also not reachable
with it — the two use different message prefixes, so neither is replayable as
the other.

It travels in the query string, which means access logs. For a 60-second,
user-scoped HMAC that is an acceptable trade; `Sec-WebSocket-Protocol` is the
route to take if that ever changes.

### Presence

In-memory, derived from open connections, deliberately not persisted. A
`Person.online` column would be wrong the moment someone closed a tab and nothing
would ever write the `false`.

A user may hold several connections — two tabs, or a phone and a laptop — so
presence counts connections, not identities, and a user goes offline only when
their last one closes. A 45-second TTL, refreshed by the socket heartbeat, means
someone who force-quits their browser does not linger as online.

In-process, so it describes one instance. Two instances would report a user
connected to each as two people; the fix is the same Redis fan-out the event bus
documents.

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

### The WebSocket cannot be proxied, and must not be

The rewrite covers HTTP only. Next's rewrites cannot carry a WebSocket upgrade,
so the socket needs this service's public host directly, as
`NEXT_PUBLIC_WS_URL` on the frontend.

It cannot be derived from `API_ORIGIN` in the browser either: that is a
server-side variable and is never sent to the client. So the frontend falls back
to the page's own origin, which in the split deployment is Vercel and will never
complete a handshake. That used to fail silently -- chat simply stopped receiving
-- and now logs a warning naming the variable. `resolveSocketUrl` in
`frontend/lib/realtime.ts` also accepts a pasted `https://` origin and derives the
`wss://` and the `/ws` path, since that is the easy mistake.

## Deploying

`render.yaml` builds and runs this service on Render's free plan against a Neon
Postgres. Three things about it are not obvious.

**The backend build is part of the build command.** `start` runs
`node dist/server.js`, and only `npm run build --workspace backend` writes
`dist/`. Without it the service starts and then fails its first health check,
which reads like an application crash rather than a missing compile.

**Migrations are manual.** Render's `preDeployCommand` is a paid-plan feature,
so with `plan: free` the schema has to be applied from a clone:

```bash
DATABASE_URL=<neon direct url> DIRECT_DATABASE_URL=<neon direct url> npm run db:deploy
```

It is deliberately not in `buildCommand` either -- builds run on every push,
including from pull requests, and a build should not mutate a database -- nor in
`startCommand`, because free-tier instances restart often and several would race
to migrate the same schema.

**Copy the pepper.** `SESSION_PEPPER` is generated by Render and not committed,
so whoever first deploys has to copy it from the dashboard into `backend/.env` or
a local session cookie will not verify against production.

## Stats

`GET /api/stats` — the dashboard's four numbers and the launcher's five, in one
statement.

Six tables, one round trip: on a free-tier instance with the database in another
region, six queries would spend the whole page-load budget on latency alone. Scalar
subqueries over two shared CTEs, which also means the six counts observe one
snapshot — six separate queries can see six different states, so a dashboard can
briefly show a pending request the leave list has already dropped.

**`dashboard.messages` is unread, not total**, computed against each channel's own
`ChannelReadState` marker — the same query as the sidebar badge, so the dashboard and
the channel list cannot disagree. A single global timestamp would be easier and
would mark every channel read the moment one is opened.

Files are workspace-wide (matching `GET /api/files`); messages, meetings, mentions
and attendance are the caller's.

## Attendance

`GET /api/attendance` and `POST /api/attendance/punch`.

**The thresholds are the server's.** `LATE_AFTER_MINUTES` (09:30) and
`OVERTIME_AFTER_MINUTES` (17:00) live here, the client sends only which button was
pressed, and `status` / `overtimeMinutes` are computed and stored server-side. The
browser is where attendance is most worth faking, and the rules used to be duplicated
in the client. They are still in `WorkspaceProvider.tsx` — but only as the
fallback applied when the API is unreachable, which sets `attendanceError` so the
board can say the time is only on this device.

**"Today" is the app zone's today.** `Attendance.date` is a `date` column, and
Render runs in UTC, so `toISOString().slice(0, 10)` would file an 02:00 IST punch
under the previous day for six and a half hours out of every twenty-four. Every
boundary goes through `appDayKey` in `src/app-time.ts`.

That module is the third copy of the zone logic, after `database/lib/app-time.ts`
and `frontend/lib/format.ts`. All three are separate workspaces with their own
`rootDir`, so a cross-workspace import would fail to typecheck or emit outside
`dist`. `appDayKey` has a test pinning the zone against known UTC instants.

**No `userId` parameter.** One person's records, always. An HR board wants a whole
team, and that needs a scope rule and a decision about who may use it — a separate
endpoint, not a flag here that would look already built.

**The day is derived, not accepted.** A punch that sends `date` or `status` has
both ignored; there is a test for exactly that.

## Events

`GET /api/events` — a windowed listing, scoped to what the caller may see.

**Visibility.** Events they organise, events they attend, and non-meeting events
regardless. The alternative — every event in the workspace — would put a
colleague's one-to-one on a screen it should not appear on. A non-meeting event is
not private merely because nobody sent an invitation, so the `type` check is a
deliberate exception rather than an oversight.

**Overlap, not containment.** `startsAt < to AND endsAt > from`, so an event that
began before the window and runs into it still appears on the day it continues.
Containment would make a long-running event vanish from the one day it matters.

**`days` is capped and `from`/`to` exist.** The calendar asks for the widest
window it can, other screens ask for what they need. A `days` parameter alone
would force every caller to know what the default means.

**`attendeeNames` as well as ids.** Every consumer renders a count or a face, and
sending names avoids a join per row on the client. `toEventDto` in `dto.ts` also
coerces `location` to `''`, because every rendering path interpolates it into a
sentence and `null` there produces "in null".

The tests are mostly about visibility and windows, since that is where a calendar
fails quietly — a listing one event too long is not an obvious bug on the screen
that renders it.

## Messages

`GET|POST /api/messages`, `PATCH|DELETE /api/messages/:id`,
`POST /api/messages/:id/reactions`.

Cursor pagination rather than `OFFSET`. `OFFSET` re-counts from the start on every
page, so a message arriving mid-scroll shifts the window and the reader sees a
duplicate at one end and a gap at the other. The cursor is the `(createdAt, id)`
pair the last row of the previous page ended on, base64url-encoded so a client
cannot construct an invalid one.

**Edit is author-only and has no history.** `editedAt` and the `message.updated`
broadcast existed with nothing writing to them; the endpoint is the missing half.
The body is overwritten and a timestamp is all that survives — an edit history needs
its own table and a view, and a half-built one is worse than an honest "edited".

**Replies render inline, not in a panel.** `parentId` is accepted and validated to
be in the same channel, and the DTO carries `parentId` plus `parentAuthor` so
"Replying to Sarah" needs no per-reply lookup. A soft-deleted parent keeps its
attribution: the reply genuinely was in reply to something that person wrote, which
is what Discord and Slack do too.

**A tombstone is not a removal.** Delete blanks the body and keeps the row, so
thread position, timestamps and replies stay coherent. `GET /api/channels` excludes
deleted messages from both `lastMessage` and `unread` — a tombstone is not something
anyone unread, and counting it left a badge that reading could never clear.

## Search

One endpoint, five entity types, ranked in the database. `src/routes/search.ts`.

Raw SQL because the page it replaced scored a fixture array in the browser — it
read every row, scored each in JavaScript, and then discarded most of them. That
cannot work against a real table, because ranking has to happen *before* the
limit.

Four things in it are load-bearing.

**The union is a reusable `Prisma.sql` fragment.** The results and the per-scope
counts come from the same ranked rows, so the union is written once. A second copy
would be a hundred lines edited in two places, and a page whose chips disagree
with its results is worse than no chips.

**Every branch runs regardless of the requested scope; the filter is applied
after ranking.** Ranking is only comparable within one set — filtering inside each
branch would rank each scope against itself. And the counts have to come from the
same set the results do, or a chip reads "Files 4" above two files.

**The counts are a second statement, not a window function.** The first has a
`LIMIT`, so `count(*) OVER (PARTITION BY scope)` there would count the twenty rows
that survived it — exactly the number that must not be shown.

**Messages are gated on channel membership in the query.** A search box that
returns the contents of channels you are not in is a way to read them without
opening them. The `EXISTS` is correlated against the caller's memberships, so the
gate lives in the statement rather than in a lookup a second query could forget.

Ranking itself is `ts_rank_cd` over the stored `tsvector`, plus trigram similarity
on names. Snippets come from `ts_headline`, because only the database knows which
words the `tsquery` matched.

See `database/README.md` for why the vector is a generated column, and
`npm run db:verify:plans` for how the indexes are asserted.

## Demo sign-in

```bash
npm run db:demo          # reset + seed + passwords + file bytes, in one command
```

which is `db:reset`, then `demo:signin`, then `demo:files`. The three have to run
in that order: the seed truncates the database, so it wipes any password and
leaves the seeded file rows with no content. Running only `db:seed` produces a
database nobody can sign in to, which is a confusing thing to discover.

`demo:signin` sets one shared password for all eight users; `demo:files` attaches
real content to the nine seeded files. Both are idempotent and safe to re-run,
which matters because on the free tier they need re-running after every deploy.

The seed deliberately leaves `passwordHash` null, so the database has to be
bootstrapped before anyone can authenticate. `demo:signin` is the bulk form of
`user:password`; it defaults to `showcase-2026`, which is committed in
`package.json` and shown on the login page. **That is deliberate and it is a
public credential** — anyone who can load the page can sign in either way, so
hiding it buys nothing. Do not reuse the value for anything real;
`user:password --random` prints a fresh one for a genuine account.

Set `NEXT_PUBLIC_DEMO_EMAIL` / `NEXT_PUBLIC_DEMO_PASSWORD` in the frontend so the
login page shows the credentials.

`demo:files` attaches a genuinely valid minimal PDF, a real PNG and JPEG, and real
Markdown to the seeded rows, writing the content and correcting `sizeBytes` to
match. `.fig` and `.pptx` get a short text stub instead: a valid download that
opens in a text editor, which is honest and still not a broken button. The PDF is
assembled with real cross-reference byte offsets, so it is a valid PDF and not
merely a plausible one.

## Smoke test

```bash
npm run dev:api     # in one terminal
npm run smoke       # in another
```

Drives the whole browser-facing flow over real HTTP against a running instance:
sign in, the CSRF requirement, the message thread, posting a message, the
WebSocket handshake, a file upload and download round trip, and logout. The
integration suite proves the same behaviours against a harness it starts itself;
this one proves them against the process you would actually deploy.

## Tests

```bash
npm test --workspace backend
```

112 tests: auth and session behaviour, the read endpoints, messages, files,
storage containment, the WebSocket, and an encoding guard.

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

Meetings, calendar, attendance, leave, HR actions and search. Those pages still
render from the frontend fixtures, which already look correct, so they are
deliberately not wired yet. WebRTC — peer connections, mute, screen share — is
front-end work and is not in this folder.
