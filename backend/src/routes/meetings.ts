/**
 * Meetings.
 *
 * Two listings, one detail, and the write that creates a call:
 *
 * - `GET  /`             the caller's meetings, upcoming or past
 * - `POST /`             open or rejoin a channel's standing call room
 * - `GET  /:id`          one meeting, with its participants and recent messages
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
 * permission question ambiguous. In-call chat uses the stored transcript rather than
 * LiveKit data channels, so it survives a room with no media connected.
 *
 * ## Join tokens
 *
 * `POST /:id/token` mints a LiveKit join token, scoped to the caller's own
 * participation. It is a POST rather than a GET -- unlike `/auth/ws-token` -- because
 * this token can join a room, and a credential that belongs in a request body should
 * not also belong in an access log.
 *
 * The endpoint answers 503 when LiveKit is not configured, rather than pretending to
 * work. The frontend turns that into a labelled simulated room instead of a silent
 * failure at the point of joining.
 *
 * ## A channel has one standing call room
 *
 * `POST /` takes a `channelId` rather than a time, because the call button in a
 * channel header has no start time to send. The `roomName` is therefore derived, not
 * chosen: `channel-<channelId>`. That is stable per channel, which is what makes the
 * button idempotent -- clicking it twice rejoins one room rather than creating two
 * rooms nobody can find, and a colleague who clicks it an hour later lands in the
 * same place.
 *
 * It also means there is exactly one `Meeting` row per channel, reused rather than
 * appended, because `Meeting.roomName` is unique and a second row could not be
 * inserted anyway. Reopening refreshes the window and promotes the starter to
 * organiser. The transcript stays attached across reopens, which is the intended
 * behaviour: it is the channel's call history, not a per-call scratchpad.
 *
 * The window is what makes the room expire. `endsAt` drives both `?scope=upcoming` and
 * the derived `ended` flag, so without it a standing room would be "upcoming"
 * forever and the meetings list would be permanently one row longer.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound, HttpError } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { livekitConfigured } from '../config.js';
import { issueMeetingToken } from '../livekit/token.js';
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
 * `POST /` takes a channel, not a time.
 *
 * `title` is optional because the button that calls this sends only a `channelId`;
 * it exists for a caller that wants to name the call it is opening.
 */
const createBody = z
  .object({
    channelId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * How long a standing call room stays joinable after it is opened.
 *
 * Long, because nobody closes an ad-hoc call and an abandoned row would otherwise
 * keep the channel's call alive forever. Short enough that the meetings list does not
 * accumulate a permanent row per channel.
 */
const ADHOC_WINDOW_MS = 4 * 60 * 60 * 1000;

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
   * Open, or rejoin, a channel's call.
   *
   * Idempotent on `channelId`. Two people clicking the call button at the same moment
   * converge on one room and one participant list rather than racing to insert two.
   */
  router.post('/', requireAuth, async (req, res) => {
    const body = createBody.parse(req.body ?? {});
    const userId = req.user!.id;
    const now = new Date();

    // Channel membership is team membership -- `Channel` stores no member column, so
    // the team roster is the authority. Scoped in the query so a channel you are not
    // on is a 404 rather than a call you could open into.
    const channel = await prisma.channel.findFirst({
      where: { id: body.channelId, team: { members: { some: { userId } } } },
      select: { id: true, name: true, team: { select: { name: true } } },
    });

    if (!channel) throw notFound('No such channel.');

    const roomName = `channel-${channel.id}`;

    const existing = await prisma.meeting.findUnique({
      where: { roomName },
      include: participantInclude,
    });

    if (existing) {
      const alreadyIn = existing.participants.some((p) => p.user.id === userId);
      const ended = existing.endsAt.getTime() <= now.getTime();

      /**
       * Reopened rather than created. A second row is impossible anyway -- `roomName`
       * is unique -- so this is the only way to bring the room back after its window
       * closes, and doing it as an update is what keeps the transcript.
       */
      const refreshed = await prisma.meeting.update({
        where: { id: existing.id },
        data: {
          // Only rewrite the window when it actually closed. Otherwise the join would
          // push the expiry out on every call-button click, and a room people keep
          // re-entering would stay listed as upcoming indefinitely.
          ...(ended
            ? {
                startsAt: now,
                endsAt: new Date(now.getTime() + ADHOC_WINDOW_MS),
                // The person who reopened it is now running the call. Leaving the
                // previous organiser in place would leave `isOrganizer` pointing at
                // someone who is not here.
                organizerId: userId,
              }
            : {}),
          ...(body.title ? { title: body.title } : {}),
          participants: alreadyIn ? undefined : { create: { userId } },
        },
        include: participantInclude,
      });

      sendJson(res, 200, { meeting: toMeetingDto(refreshed), created: false });
      return;
    }

    const created = await prisma.meeting.create({
      data: {
        title: body.title ?? `${channel.team.name} / #${channel.name}`,
        roomName,
        organizerId: userId,
        startsAt: now,
        endsAt: new Date(now.getTime() + ADHOC_WINDOW_MS),
        // The starter is a participant, not merely the organiser: the participant row
        // is what every scoped read in this router filters on, so omitting it would
        // make the room they just opened unreadable to them.
        participants: { create: { userId } },
      },
      include: participantInclude,
    });

    sendJson(res, 201, { meeting: toMeetingDto(created), created: true });
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

  /**
   * Mint a LiveKit join token for one meeting.
   *
   * The same participant-scoped lookup as the detail route, so a meeting you are not
   * in is a 404 rather than a token for someone else's room. A 404 rather than a 403
   * because confirming the room exists is itself information.
   */
  router.post('/:id/token', requireAuth, async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.meeting.findFirst({
      where: { id, participants: { some: { userId: req.user!.id } } },
      select: { roomName: true },
    });

    if (!row) throw notFound('No such meeting.');

    // Checked after the lookup, deliberately. "You are not in this meeting" is true
    // whether or not LiveKit is configured, so it should not depend on it -- and
    // answering 503 first would mean an unconfigured deployment returned the same
    // refusal for a meeting you were in and one you were not.
    if (!livekitConfigured) {
      throw new HttpError(
        503,
        'livekit_not_configured',
        'Video is not configured on this deployment. The room works, without media.',
      );
    }

    // Identity and name both from the session, never from the frontend's persona
    // picker. Two browsers claiming one identity would have LiveKit evict the first
    // connection when the second joins.
    const minted = await issueMeetingToken({
      roomName: row.roomName,
      userId: req.user!.id,
      displayName: req.user!.name,
    });

    sendJson(res, 200, {
      ...minted,
      roomName: row.roomName,
      // Deliberately no project URL. This service signs tokens and never contacts
      // LiveKit, so it has no URL to give; the browser already has one baked in via
      // NEXT_PUBLIC_LIVEKIT_URL at build time. Returning it from here would mean a
      // server-side variable leaking into the client contract for no benefit.
    });
  });

  return router;
}
