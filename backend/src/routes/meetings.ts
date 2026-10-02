/**
 * Meetings.
 *
 * Two listings and one detail, scoped to meetings the caller is in:
 *
 * - `GET /`              the caller's meetings, upcoming or past
 * - `GET /:id`           one meeting, with its participants and recent messages
 *
 * ## Scoping is a participant check, not a flag
 *
 * A meeting row is not public the way a channel is. The calendar endpoint treats a
 * MEETING event as private unless the caller is the organiser or an attendee, and
 * this router holds to the same line: every query is filtered to
 * `participants.some.userId = caller`. A meeting id is a `cuid()`, which is not
 * guessable, but "unguessable" is not authorisation, and a colleague's meeting read
 * over an id is the case this prevents.
 *
 * ## "Past" is derived from the clock, not stored
 *
 * There is no `status` column, and adding one would mean something has to keep it
 * current. Whether a meeting has ended is a fact about `endsAt` and now, so
 * `?scope=past` is that comparison. The consequence is stated plainly in the response:
 * a meeting that ends while the tab is open moves from upcoming to past on the next
 * read, with no write to make it true.
 *
 * ## Messages belong to the meeting, not to a channel
 *
 * `Message.channelId` and `Message.meetingId` are both nullable and mutually
 * exclusive in practice. Meeting chat is exposed here through the meeting detail
 * rather than through `/messages`, because that endpoint requires a `channelId` on
 * purpose -- widening it to accept a meeting id would make every channel-scoped
 * permission question ambiguous. In-call chat stays out of scope until LiveKit
 * supplies the token flow; this returns the stored transcript either way.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { toMeetingDto } from '../dto.js';

/** How far back `scope=past` looks before it is not worth listing. */
const MAX_PAST_DAYS = 120;

const listQuery = z
  .object({
    scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
    /**
     * Only meaningful for `past`, where there is no natural upper bound. Bounded so
     * "all past meetings" cannot become an unbounded scan.
     */
    days: z.coerce.number().int().min(1).max(MAX_PAST_DAYS).default(30),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/**
 * Participant columns.
 *
 * The list renders a face per attendee and the detail renders a row per attendee, so
 * the user is joined once rather than fetched per meeting.
 */
const participantInclude = {
  participants: {
    select: {
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  organizer: { select: { id: true, name: true, avatarUrl: true } },
} as const;

export function meetingsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const query = listQuery.parse(req.query);
    const userId = req.user!.id;
    const now = new Date();

    /**
     * The participant filter, applied to every scope.
     *
     * `some` rather than `every`: being in the room is what grants the read, and one
     * matching row is enough.
     */
    const membership = { participants: { some: { userId } } };

    const where = {
      ...membership,
      ...(query.scope === 'upcoming'
        ? // Only `endsAt`. A meeting that started an hour ago and runs for another
          // fifty is still one you can join, and filtering on `startsAt` as well
          // would drop it from the list while the join button is still the obvious
          // next click. Containment is the wrong test here; overlap is the right one,
          // and `endsAt > now` is what overlap reduces to for a meeting with a start.
          { endsAt: { gt: now } }
        : query.scope === 'past'
          ? {
              // Both ends in one filter: ended before now, and not so long ago that
              // it fell outside the window.
              endsAt: {
                lte: now,
                gte: new Date(now.getTime() - query.days * 86_400_000),
              },
            }
          : {}),
    };

    const rows = await prisma.meeting.findMany({
      where,
      include: participantInclude,
      // Upcoming reads forwards, past reads backwards -- both ending at the soonest
      // meeting, which is the one a person opening the screen wants first.
      orderBy: { startsAt: query.scope === 'past' ? 'desc' : 'asc' },
      take: query.limit,
    });

    sendJson(res, 200, {
      meetings: rows.map(toMeetingDto),
      scope: query.scope,
      // The instant the boundary was drawn against, so a caller can tell "no
      // meetings" from "no meetings before this".
      evaluatedAt: now.toISOString(),
    });
  });

  /**
   * One meeting, with its participants and recent transcript.
   *
   * The transcript is capped and reversed to the newest page. It is deliberately not
   * paginated here: meeting chat is a transcript you scroll back through, not a
   * thread you page through, and the in-call UI will fetch its own window.
   */
  router.get('/:id', requireAuth, async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const userId = req.user!.id;

    const row = await prisma.meeting.findFirst({
      // Scoped in the query rather than fetched-then-checked, so a meeting you are
      // not in is indistinguishable from one that does not exist.
      where: { id, participants: { some: { userId } } },
      include: {
        ...participantInclude,
        messages: {
          // A soft-deleted message keeps its row so thread position holds, so it is
          // excluded here rather than rendered as an empty bubble.
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            body: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!row) throw notFound('No such meeting.');

    const messages = row.messages
      .map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        author: message.user,
      }))
      // Newest-first from the database, oldest-first for the reader.
      .reverse();

    sendJson(res, 200, {
      meeting: toMeetingDto(row),
      messages,
      messagesTruncated: row.messages.length === 50,
    });
  });

  return router;
}
