# Backend

Express 5 + TypeScript API for NCR Teams. Deployed to Render; the database is
Neon Postgres.

**Status: foundation, auth and read paths built.** Messages, files, meetings,
attendance, leave, search and the WebSocket are Phase 2b — the contract below is
written down and unchanged, but those routes do not exist yet.

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

`GET /api/activity` resolves each notification's target, so the feed is built
from structured fields rather than the frozen prose the fixtures carried.

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

## Tests

```bash
npm test --workspace backend
```

`node:test`, no framework — the repo has none, and the earlier frontend ad-hoc
scripts were removed for exactly that reason.

`pretest` creates `ncr_teams_test`, applies the real migrations and runs the real
seed, so the suite exercises the shipped artefacts rather than a fixture built to
match it. The test database is separate because tests truncate.

The app is mounted on an ephemeral port and driven over HTTP, not called
directly, because the things most likely to break — cookie flags, CSRF, status
codes, BigInt serialisation — all live in the middleware and the response path.

Signed-in users come from `test/fixtures.ts`, which sets a password the seed
deliberately leaves null. Argon2 at 19 MiB is slow enough that the suite shares
one hash across fixtures; salting means each stored value is still distinct.

## Not yet built

Everything else in the contract: messages, reactions, file upload, meetings,
calendar, attendance, leave, search, and the `/ws` endpoint with presence.

File storage is the open design question. The plan is server disk, but **Render's
free tier filesystem is ephemeral** — uploads are lost on every deploy and on
instance restart. Cloudflare R2 is the natural fit and the account is already
needed for TURN. This is a 2b decision, not a 2a one.
