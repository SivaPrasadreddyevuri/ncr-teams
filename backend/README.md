# Backend — scaffold only

**Status: specified, not built.** This folder contains no implementation. It
exists so the contract the frontend will call is written down and reviewable
rather than invented later.

## Planned stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node 20+ | Same runtime as the frontend build |
| Framework | Express 5 + TypeScript | Small, boring, easy to read in a review |
| Validation | Zod | One schema shared with the frontend types |
| Auth | Session cookie, httpOnly | Avoids storing a token in JS |
| Database | Postgres via `pg` | See `../database` |
| Realtime | `ws` WebSocket server | Needed for message delivery and presence |
| Migrations | Plain versioned SQL | No ORM to learn or fight |

## API contract

Every row maps to a value that `frontend/lib/data.ts` currently mocks, so the
frontend can switch from fixtures to live data one screen at a time.

Base path: `/api`. All responses are JSON. Authenticated routes expect the
session cookie.

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Email + password. Sets the session cookie. |
| `POST` | `/api/auth/logout` | Clears the session. |
| `POST` | `/api/auth/activate` | Completes an invited account. |
| `POST` | `/api/auth/forgot-password` | Always returns 204, never leaks whether the account exists. |
| `POST` | `/api/auth/verify-2fa` | TOTP check. Returns a challenge token. |
| `GET` | `/api/auth/me` | Current user, or 401. |

### People

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/users` | Directory. Supports `?q=` and `?department=`. |
| `GET` | `/api/users/:id` | Single person. |
| `PATCH` | `/api/users/me` | Update own profile. |

### Teams and channels

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/teams` | Teams the caller belongs to. |
| `POST` | `/api/teams` | Create. Caller becomes `OWNER`. |
| `GET` | `/api/teams/:id` | Detail with members. |
| `POST` | `/api/teams/:id/join` | Idempotent. |
| `POST` | `/api/teams/:id/leave` | Idempotent. |
| `GET` | `/api/channels?teamId=` | Channels in a team. |
| `POST` | `/api/channels` | Create. |
| `POST` | `/api/channels/:id/join` | Idempotent. |

### Messages

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/messages?channelId=&before=&limit=` | Cursor pagination, newest first. |
| `POST` | `/api/messages` | Send. Broadcasts over the WebSocket. |
| `POST` | `/api/messages/:id/reactions` | Toggle a reaction. |
| `DELETE` | `/api/messages/:id` | Author only. |

### Files

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/files?folderId=&team=` | Listing. |
| `POST` | `/api/files` | Multipart upload. Streams to object storage. |
| `DELETE` | `/api/files/:id` | Soft delete. |
| `POST` | `/api/files/:id/star` | Toggle star. |

### Meetings, calls and calendar

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/meetings` | Upcoming and recent for the caller. |
| `GET` | `/api/meetings/:id` | Detail plus participants. |
| `POST` | `/api/meetings` | Schedule. Optionally creates a calendar event. |
| `GET` | `/api/meetings/:id/messages` | In-meeting chat. |
| `POST` | `/api/meetings/:id/messages` | In-meeting chat. |
| `GET` | `/api/events?from=&to=` | Calendar events in a date range. |
| `POST` | `/api/events` | Create. |
| `PATCH` | `/api/events/:id/rsvp` | Accept / decline. |

### Attendance, HR and activity

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/attendance?date=` | Board for a date. |
| `GET` | `/api/attendance/me` | Caller history. |
| `POST` | `/api/attendance/check-in` | Idempotent per day. |
| `POST` | `/api/attendance/check-out` | Idempotent. |
| `GET` | `/api/leave` | Leave requests. |
| `POST` | `/api/leave` | Request. |
| `PATCH` | `/api/leave/:id` | Approve or reject. |
| `GET` | `/api/departments` | Department list. |
| `GET` | `/api/activity` | Feed for the caller. |

### Search

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/search?q=&scope=` | `scope` is one of `people`, `messages`, `files`, `events`, `teams`. Mirrors the ranking the frontend already implements client-side. |

## Realtime

One WebSocket endpoint at `/ws`, authenticated with the session cookie during
the upgrade. Frames are `{ type, payload }`:

| `type` | Direction | Payload |
| --- | --- | --- |
| `message.created` | server → client | The stored message |
| `message.updated` | server → client | Reactions, edits |
| `message.deleted` | server → client | Message id |
| `typing.start` / `typing.stop` | both | Channel id, user id |
| `presence.changed` | server → client | User id, new status |

Presence is tracked in memory with a TTL, and is deliberately not persisted.

## Conventions

- Zod parses every request body and query string at the edge of the handler.
- Handlers are thin: validate, call a query function, shape the response.
- Database access lives in `src/queries/*`, mirroring the routes above.
- No business logic in route files.
- Errors return `{ error: { code, message } }`; never a stack trace.
