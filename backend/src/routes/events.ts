/**
 * Calendar events.
 *
 * One listing, scoped to what the caller can actually see: events they organise,
 * events they are an attendee of, and workspace-wide non-meeting events. The
 * alternative -- every event in the workspace -- would put a colleague's
 * one-to-one on a screen it should not appear on.
 *
 * ## Why the window is a parameter
 *
 * The calendar screen wants a week, the activity screen wants the next few
 * events, and the home screen wants whatever is today. `from`/`to` are therefore
 * the query, not `?days=N`, because a window with explicit ends is the one a
 * caller can reason about -- and a `days` parameter would force every caller to
 * know what the default means.
 *
 * ## Timezone
 *
 * `startsAt` is a timestamp in UTC and is returned as such. Which day an event
 * *appears* on is a presentation decision made in the browser, in the workspace
 * timezone, because the server does not know which timezone the viewer is in and
 * guessing is how a 09:00 standup ends up on the previous day.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { toEventDto } from '../dto.js';

const listQuery = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    /**
     * How far ahead to look when neither bound is given. Bounded because an
     * unbounded "upcoming events" query is a table scan with no useful answer.
     */
    days: z.coerce.number().int().min(1).max(120).default(30),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((q) => !q.from || !q.to || new Date(q.from) < new Date(q.to), {
    message: 'from must be before to',
    path: ['from'],
  });

export function eventsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const query = listQuery.parse(req.query);
    const userId = req.user!.id;

    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to
      ? new Date(query.to)
      : new Date(from.getTime() + query.days * 24 * 60 * 60 * 1000);

    const rows = await prisma.calendarEvent.findMany({
      where: {
        // Overlap, not containment: an event that starts before the window and
        // runs into it is still showing on the calendar during the window.
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [
          { organizerId: userId },
          { attendees: { some: { userId } } },
          // A company-wide event is not private just because nobody invited you.
          { type: { not: 'MEETING' } },
        ],
      },
      include: {
        // The attendee *names*, not ids: every consumer of this list renders a
        // count and, in the calendar, faces -- and "3 people" is a join away
        // where an avatar per attendee would be an N+1.
        attendees: { select: { user: { select: { id: true, name: true } } } },
        organizer: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: query.limit,
    });

    sendJson(res, 200, {
      events: rows.map(toEventDto),
      // The window actually searched, so a caller can tell "no events" from "no
      // events that far ahead" without recomputing the default.
      from: from.toISOString(),
      to: to.toISOString(),
    });
  });

  return router;
}
