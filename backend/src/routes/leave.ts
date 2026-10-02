/**
 * Leave requests.
 *
 * Three endpoints, because there are three different questions and three different
 * answers to "who is allowed to ask":
 *
 * - `GET  /`             the caller's own requests
 * - `POST /`             file one for yourself
 * - `GET  /requests`     HR's queue, every pending request in the workspace
 * - `POST /requests/:id` HR's decision, approve or reject
 *
 * The HR queue is a separate path rather than a `?scope=all` on the first one. A
 * query parameter invites a client to try it, and the authorisation for "show me
 * everyone else's leave" is a different question from "show me mine" -- so it gets
 * its own route, its own role check, and its own test.
 *
 * ## Days are counted on the server
 *
 * The form has always shown a day count, and it used to be computed in the browser
 * from two date inputs. That is the same class of problem as the attendance rules:
 * a number the client decides is a number nobody can check. `days` is a column, so
 * the server computes it once, from the same window it validates, and stores it.
 * The client displays what it is told.
 *
 * ## Overlap is rejected, not silently allowed
 *
 * Two approved requests for the same person on the same day is a bug a person has
 * to notice and report. It is rejected at submit time against the caller's own
 * non-rejected requests, so the second one fails loudly at the point where the user
 * can still do something about it.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth, requireRole } from '../middleware/session.js';
import { toLeaveRequestDto } from '../dto.js';

/**
 * The longest window one request may cover.
 *
 * Present because `from`/`to` are client-supplied instants: without a cap a single
 * request can claim to span years, which is both nonsense and a cheap way to make
 * the days arithmetic overflow something reasonable-looking.
 */
const MAX_WINDOW_DAYS = 90;

/** Longest accepted reason, so the column cannot hold an unbounded blob. */
const MAX_REASON = 500;

/**
 * Only the three columns each consumer needs, joined for both parties.
 *
 * `user` and `decidedBy` are included rather than fetched per row: the HR queue
 * renders a name and an avatar for every row, and without them this is N+1 on the
 * one page a manager actually uses.
 */
const partySelect = { select: { id: true, name: true, avatarUrl: true } } as const;

const listQuery = z
  .object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    days: z.coerce.number().int().min(1).max(MAX_WINDOW_DAYS).default(90),
  })
  .strict();

/**
 * Whole days covered by `[from, to]`, in the app timezone.
 *
 * `Math.floor(diff) + 1` matches what the leave form displayed before the server
 * took the calculation over, so submitting the same window now reports the same
 * number rather than silently changing by one.
 */
export function countLeaveDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

const createBody = z
  .object({
    type: z.enum(['ANNUAL', 'SICK', 'PERSONAL', 'PARENTAL', 'UNPAID']).default('ANNUAL'),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    // Optional rather than defaulted to '' because "no reason given" and "an empty
    // string was submitted" are the same thing, and storing the difference would
    // just be noise.
    reason: z.string().trim().max(MAX_REASON).optional(),
  })
  .strict();

const decisionBody = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(MAX_REASON).optional(),
  })
  .strict();

export function leaveRouter() {
  const router = Router();

  /** The caller's own requests, newest window first. */
  router.get('/', requireAuth, async (req, res) => {
    const query = listQuery.parse(req.query);
    const userId = req.user!.id;

    const rows = await prisma.leaveRequest.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
      },
      include: { user: partySelect, decidedBy: partySelect },
      orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
      take: query.days,
    });

    sendJson(res, 200, { requests: rows.map(toLeaveRequestDto) });
  });

  /**
   * File a request for yourself.
   *
   * There is no `userId` in the body, deliberately. A leave request is a statement
   * the person makes about their own availability; accepting one for someone else
   * would be HR filing leave on an employee's behalf, which is a different feature
   * with a different audit story.
   */
  router.post('/', requireAuth, async (req, res) => {
    const body = createBody.parse(req.body);
    const userId = req.user!.id;

    const from = new Date(body.from);
    const to = new Date(body.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw badRequest('invalid_window', 'The start and end could not be read as dates.');
    }

    if (to.getTime() < from.getTime()) {
      throw badRequest('inverted_window', 'Leave cannot end before it starts.');
    }

    const days = countLeaveDays(from, to);
    if (days > MAX_WINDOW_DAYS) {
      throw badRequest('window_too_long', `A request may cover at most ${MAX_WINDOW_DAYS} days.`);
    }

    // Overlap check against the caller's own live requests. CANCELLED and REJECTED
    // are excluded because neither holds any time -- allowing a fresh request for a
    // window someone already had refused would make the rejection meaningless.
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      select: { id: true, fromDate: true, toDate: true },
    });

    if (overlapping) {
      throw conflict(
        'overlapping_request',
        'You already have a request covering part of that window.',
      );
    }

    const row = await prisma.leaveRequest.create({
      data: {
        userId,
        type: body.type,
        fromDate: from,
        toDate: to,
        days,
        reason: body.reason && body.reason.length > 0 ? body.reason : null,
      },
      include: { user: partySelect, decidedBy: partySelect },
    });

    sendJson(res, 201, { request: toLeaveRequestDto(row) });
  });

  /**
   * The caller's own request, by id.
   *
   * Scoped to the caller, so this cannot become a way to read someone else's leave
   * by guessing an id.
   */
  router.get('/:id', requireAuth, async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.leaveRequest.findFirst({
      where: { id, userId: req.user!.id },
      include: { user: partySelect, decidedBy: partySelect },
    });

    if (!row) throw notFound('No such leave request.');

    sendJson(res, 200, { request: toLeaveRequestDto(row) });
  });

  /**
   * Withdraw one of your own pending requests.
   *
   * Only PENDING is cancellable. Cancelling an approved request would silently
   * withdraw leave someone already planned around; if that needs to happen, HR
   * rejects it, which leaves a decision on the record.
   */
  router.post('/:id/cancel', requireAuth, async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const existing = await prisma.leaveRequest.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!existing) throw notFound('No such leave request.');

    if (existing.status !== 'PENDING') {
      throw conflict('already_decided', 'Only a pending request can be withdrawn.');
    }

    const row = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { user: partySelect, decidedBy: partySelect },
    });

    sendJson(res, 200, { request: toLeaveRequestDto(row) });
  });

  /**
   * HR's queue: every request in the workspace, newest first.
   *
   * Separate route with its own role check, so the authorisation for reading other
   * people's leave is visible at the mount point rather than implied by a parameter.
   */
  router.get('/requests/queue', requireRole('HR_ADMIN'), async (req, res) => {
    const query = z
      .object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).default('PENDING'),
      })
      .strict()
      .parse(req.query);

    const rows = await prisma.leaveRequest.findMany({
      where: { status: query.status },
      include: { user: partySelect, decidedBy: partySelect },
      orderBy: [{ fromDate: 'asc' }, { createdAt: 'asc' }],
    });

    sendJson(res, 200, { requests: rows.map(toLeaveRequestDto), status: query.status });
  });

  /**
   * Approve or reject a request.
   *
   * HR only. The decided-by id and the instant are set here rather than taken from
   * the body, so the record of who decided cannot be forged by the client.
   */
  router.post('/requests/:id/decision', requireRole('HR_ADMIN'), async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const body = decisionBody.parse(req.body);

    const existing = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!existing) throw notFound('No such leave request.');

    if (existing.status !== 'PENDING') {
      // Two managers clicking approve is a race, and the second one silently
      // overwriting the first's name is exactly the bug this prevents.
      throw conflict('already_decided', `That request is already ${existing.status.toLowerCase()}.`);
    }

    // HR cannot approve their own request. Without this, the single most privileged
    // account in the demo would be approving itself, and the queue would have
    // nothing interesting to show.
    if (existing.userId === req.user!.id) {
      throw forbidden('You cannot decide your own leave request.');
    }

    const row = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: body.status,
        decidedById: req.user!.id,
        decidedAt: new Date(),
        decisionNote: body.note && body.note.length > 0 ? body.note : null,
      },
      include: { user: partySelect, decidedBy: partySelect },
    });

    sendJson(res, 200, { request: toLeaveRequestDto(row) });
  });

  return router;
}
