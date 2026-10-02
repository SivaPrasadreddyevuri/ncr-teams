/**
 * Dashboard and launcher counts.
 *
 * One endpoint for both, because they are the same query.
 *
 * ## Why one raw statement
 *
 * `HomeStats` shows four numbers and the apps launcher shows five, spanning six
 * tables. Six queries would be six round trips to render one row of cards, and on
 * a free-tier instance with a database in another region that latency is the
 * whole page-load budget.
 *
 * Scalar subqueries over shared CTEs do it in one round trip. They read the
 * snapshot at one instant, too, which is a second reason: six separate queries can
 * observe six different states, so a dashboard can briefly show a pending request
 * that the leave list has already stopped showing.
 *
 * ## `messages` means unread, not total
 *
 * The card says "New messages", and the fixture put a hardcoded 8 there. It is
 * computed the same way the sidebar badge is -- against each channel's own
 * `ChannelReadState` marker -- so the dashboard and the channel list cannot
 * disagree. A user who has never opened a channel has everything in it unread,
 * which is the same reading the sidebar takes.
 *
 * ## What is scoped and what is not
 *
 * Messages, meetings and mentions are the caller's. Files are workspace-wide,
 * matching `GET /api/files`, which returns everything. Attendance is the caller's
 * own records, because a headcount of days clocked in is not something everyone
 * sees about everyone.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

type StatsRow = {
  messages: number;
  meetings: number;
  mentions: number;
  channels: number;
  events: number;
  files: number;
  totalMeetings: number;
  attendance: number;
};

export function statsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const userId = req.user!.id;

    const [stats] = await prisma.$queryRaw<StatsRow[]>`
      -- The channels the caller is in. Channel has no membership table of its
      -- own, so team membership is the gate -- the same one GET /api/messages
      -- and GET /api/channels use. Widening that to a channel_members table is
      -- the change that makes ChannelType.PRIVATE mean something.
      WITH my_channels AS (
        SELECT ch."id"
        FROM "Channel" ch
        JOIN "TeamMember" tm ON tm."teamId" = ch."teamId"
        WHERE tm."userId" = ${userId}
      ),

      -- The same visibility rule as GET /api/events, so the launcher count and
      -- the calendar can never disagree about how many events there are.
      my_events AS (
        SELECT e."id", e."type"
        FROM "CalendarEvent" e
        -- AT TIME ZONE 'UTC', not a bare now() and not a bound parameter.
        --
        -- startsAt is timestamp-without-time-zone holding UTC. A bare now() is a
        -- timestamptz, which Postgres casts into the session's TimeZone before the
        -- comparison -- so on a host set to Asia/Calcutta the query compares against
        -- IST wall-clock and reads as 5h30m ahead of the truth. A bound Date does not
        -- help either: the raw-query path encodes that as local too.
        --
        -- Prisma's generated queries, however, bind their parameters as UTC-naive.
        -- So the raw SQL and Prisma disagreed by exactly the host's offset, which is
        -- why this route reported 2 upcoming meetings where the same predicate
        -- through Prisma found 4.
        --
        -- Converting now() to UTC makes the raw SQL agree with the column and with
        -- Prisma's encoding, and makes it independent of how the server is configured.
        WHERE e."startsAt" >= (now() AT TIME ZONE 'UTC')
          AND (
            e."organizerId" = ${userId}
            OR EXISTS (
              SELECT 1 FROM "CalendarAttendee" a
              WHERE a."eventId" = e."id" AND a."userId" = ${userId}
            )
            -- A company-wide event is not private merely because nobody invited you.
            OR e."type" <> 'MEETING'
          )
      )

      SELECT
        -- Unread, per channel's own marker rather than a single global timestamp:
        -- one lastReadAt for the whole workspace would make opening one channel
        -- mark every other channel read.
        (
          SELECT count(*)::int
          FROM "Message" m
          LEFT JOIN "ChannelReadState" s
            ON s."channelId" = m."channelId" AND s."userId" = ${userId}
          WHERE m."deletedAt" IS NULL
            AND m."channelId" IN (SELECT "id" FROM my_channels)
            AND (s."lastReadAt" IS NULL OR m."createdAt" > s."lastReadAt")
        ) AS messages,

        (
          SELECT count(*)::int FROM my_events WHERE "type" = 'MEETING'
        ) AS meetings,

        (
          SELECT count(*)::int
          FROM "Notification" n
          WHERE n."userId" = ${userId} AND n."kind" = 'MENTION'
        ) AS mentions,

        (SELECT count(*)::int FROM my_channels) AS channels,
        (SELECT count(*)::int FROM my_events) AS events,

        -- Workspace-wide, matching GET /api/files. A soft-deleted row is
        -- excluded because the file list excludes it too.
        (
          SELECT count(*)::int FROM "File" f WHERE f."deletedAt" IS NULL
        ) AS files,

        -- Meetings the caller is in, for the launcher's count. Distinct on the
        -- meeting rather than the participant row, so a caller who is both
        -- organiser and an attendee is counted once.
        --
        -- The alias is quoted, and that is not cosmetic. Postgres folds an
        -- unquoted identifier to lower case, so an unquoted camelCase alias comes
        -- back as totalmeetings and row.totalMeetings is undefined -- which
        -- Number() turns into NaN, and JSON.stringify renders as null. A count
        -- silently becoming null is exactly the kind of thing that ships.
        (
          SELECT count(DISTINCT m."id")::int
          FROM "Meeting" m
          LEFT JOIN "MeetingParticipant" p ON p."meetingId" = m."id"
          WHERE m."organizerId" = ${userId} OR p."userId" = ${userId}
        ) AS "totalMeetings",

        -- The caller's own attendance days. Nobody sees anyone else's.
        (
          SELECT count(*)::int FROM "Attendance" a WHERE a."userId" = ${userId}
        ) AS attendance
    `;

    const row = stats;

    // Not `?? 0`: a query that returned no row is a bug worth seeing, and silently
    // rendering four zeroed cards is the opposite of seeing it.
    if (!row) {
      throw new Error('stats query returned no row');
    }

    sendJson(res, 200, {
      dashboard: {
        messages: Number(row.messages),
        meetings: Number(row.meetings),
        mentions: Number(row.mentions),
      },
      apps: {
        channels: Number(row.channels),
        events: Number(row.events),
        files: Number(row.files),
        meetings: Number(row.totalMeetings),
        attendance: Number(row.attendance),
      },
    });
  });

  return router;
}
