# Database — schema plan

**Status: specified, not built.** No migrations have been written and no database
is running. This document is the design that the migrations will follow.

## Target

PostgreSQL 15 or newer. Chosen over SQLite or MongoDB because the domain is
heavily relational (teams contain channels contain messages, with membership as
a many-to-many everywhere) and because row-level security is worth having when
the real auth lands.

## Entities

The mock data in `frontend/lib/data.ts` already defines the shape of most of
these, so the fixtures and the schema can be checked against each other.

### Identity

| Table | Notes |
| --- | --- |
| `users` | `id`, `email` (unique), `name`, `job_title`, `employee_code`, `role`, `department_id`, `phone`, `avatar_url`, `password_hash`, `totp_secret`, `created_at` |
| `departments` | `id`, `name`, `description`, `head_user_id` |
| `sessions` | `id`, `user_id`, `expires_at`, `created_at`, `user_agent` |

`role` is an enum: `HR_ADMIN`, `MANAGER`, `EMPLOYEE` — matching the `Person`
type today. `password_hash` and `totp_secret` are nullable so an invited user
exists before they have set a credential.

### Teams and channels

| Table | Notes |
| --- | --- |
| `teams` | `id`, `name`, `description`, `created_by`, `created_at` |
| `team_members` | `team_id`, `user_id`, `role`, `joined_at`. PK `(team_id, user_id)` |
| `channels` | `id`, `team_id`, `name`, `topic`, `created_by`, `created_at`. Unique `(team_id, name)` |
| `channel_members` | `channel_id`, `user_id`, `joined_at`. PK `(channel_id, user_id)` |

`team_members.role` is `OWNER`, `ADMIN`, `MEMBER`.

### Messaging

| Table | Notes |
| --- | --- |
| `messages` | `id`, `channel_id`, `author_id`, `body`, `created_at`, `edited_at`, `deleted_at` |
| `reactions` | `message_id`, `user_id`, `emoji`. PK `(message_id, user_id, emoji)` |
| `attachments` | `id`, `message_id`, `file_id` |

Soft delete via `deleted_at` so history stays coherent; `body` is blanked on
read rather than removed.

### Files

| Table | Notes |
| --- | --- |
| `files` | `id`, `name`, `size_bytes`, `mime_type`, `storage_key`, `team_id`, `folder_id`, `uploaded_by`, `starred_by` (array), `created_at`, `deleted_at` |

`storage_key` points at object storage, not the database. Byte size lives here
so quota checks avoid a round trip. `starred_by` is the one deliberate
denormalisation: starring is per-user, high-churn and never queried across users.

### Meetings and calendar

| Table | Notes |
| --- | --- |
| `meetings` | `id`, `title`, `room_name`, `organizer_id`, `starts_at`, `ends_at`, `created_at` |
| `meeting_participants` | `meeting_id`, `user_id`, `joined_at`, `left_at`. PK `(meeting_id, user_id)` |
| `meeting_messages` | `id`, `meeting_id`, `author_id`, `body`, `created_at` |
| `calendar_events` | `id`, `title`, `organizer_id`, `starts_at`, `ends_at`, `type`, `location`, `meeting_id` (nullable), `created_at` |

A meeting and its calendar event are kept as separate rows joined by
`meeting_id`, because a meeting can be cancelled without losing the event.
`type` is `MEETING` or `EVENT`.

### Attendance and HR

| Table | Notes |
| --- | --- |
| `attendance_records` | `user_id`, `date`, `check_in`, `check_out`, `status`, `overtime_minutes`. PK `(user_id, date)` |
| `leave_requests` | `id`, `user_id`, `type`, `from`, `to`, `days`, `reason`, `status`, `decided_by`, `decided_at`, `created_at` |

`date` is a `date`, never a timestamp — an attendance day is calendar-local, and
storing a timestamp reintroduces the timezone bug the prototype had. `status` is
`PRESENT`, `LATE`, `REMOTE`, `HALF_DAY`, `ABSENT`. The composite primary key is
what makes check-in naturally idempotent.

### Activity

| Table | Notes |
| --- | --- |
| `notifications` | `id`, `user_id`, `kind`, `actor_id`, `target_type`, `target_id`, `read_at`, `created_at` |

`kind` is `message`, `file`, `meeting`, `leave`, `mention`. One table rather than
per-type tables, because the feed is always read the same way.

## Conventions

- Primary keys are `uuid` with `gen_random_uuid()`.
- Every table has `created_at timestamptz not null default now()`.
- Timestamps are `timestamptz` and stored in UTC; formatting is the frontend's
  job.
- Foreign keys are declared, with `on delete cascade` for owned rows (reactions,
  attachments) and `on delete set null` for referenced ones (organiser).
- Indexes on every foreign key, plus a composite `(channel_id, created_at desc)`
  on `messages` for the cursor-paginated feed.
- Migrations are plain numbered SQL applied in order, tracked in a
  `schema_migrations` table. No ORM.

## Seed plan

`seed.sql` reproduces exactly what `frontend/lib/data.ts` mocks today, so the
demo looks identical once it reads from Postgres: 8 users, 6 departments, 8
teams, 10 channels, 11 messages, 8 calendar events, 5 meetings, 9 files, 40
attendance records and 3 leave requests.
