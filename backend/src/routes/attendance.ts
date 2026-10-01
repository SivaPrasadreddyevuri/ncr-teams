/**
 * Attendance.
 *
 * Two things live here, and the split is deliberate.
 *
 * ## The rules live on the server
 *
 * "Late" and "overtime" are defined in minutes past midnight, and the client had
 * them as constants it applied to its own state. A rule the client computes is a
 * rule anyone can ignore -- the browser is where attendance is most worth faking --
 * and it is also duplicated, so the two copies drift.
 *
 * So `LATE_AFTER_MINUTES` and `OVERTIME_AFTER_MINUTES` are defined once, here, and
 * the client sends only *which button was pressed*. `status` and `overtimeMinutes`
 * are computed and stored by the server. The frontend keeps its own constants only
 * as a fallback for the down-API path, which is fixture data anyway.
 *
 * ## "Today" is the app zone's today
 *
 * `Attendance.date` is a `date` column: an attendance day is calendar-local. Render
 * runs in UTC, so `toISOString().slice(0, 10)` would file a 02:00 IST punch-in
 * under the previous day for six and a half hours out of every twenty-four. Every
 * day boundary here goes through `appDayKey`.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { appDayKey, appMinutesOfDay } from '../app-time.js';
import { toAttendanceDto } from '../dto.js';

/**
 * Minutes past midnight after which an arrival counts as late: 09:30.
 *
 * Exported so the tests can assert the boundary rather than a copied number.
 */
export const LATE_AFTER_MINUTES = 9 * 60 + 30;

/** Minutes past midnight after which time counts as overtime: 17:00. */
export const OVERTIME_AFTER_MINUTES = 17 * 60;

/** The most days one request may span, so `from`/`to` cannot ask for all time. */
const MAX_RANGE_DAYS = 120;

const listQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
    /**
     * A wider window than one user needs, allowed because an HR board will want it
     * later. Still capped, because an unbounded date range is a table scan.
     */
    days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).default(30),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export function attendanceRouter() {
  const router = Router();

  /**
   * The caller's own attendance.
   *
   * Scoped to the caller with no override, deliberately. An HR board wants to see a
   * whole team, and that needs a `scope` parameter plus the rule about who may use
   * it -- it is a different endpoint and a different decision, and shipping a
   * `userId` parameter now would make it look done.
   */
  router.get('/', requireAuth, async (req, res) => {
    const query = listQuery.parse(req.query);
    const userId = req.user!.id;

    const to = query.to ?? appDayKey(new Date());
    // `from` defaults to `to` minus the window, in app-zone days. Building it as a
    // `Date` at UTC midnight is what a `@db.Date` column stores, so the bounds
    // compare correctly against the column.
    const from =
      query.from ??
      appDayKey(new Date(new Date(`${to}T00:00:00Z`).getTime() - (query.days - 1) * 86_400_000));

    const rows = await prisma.attendance.findMany({
      where: {
        userId,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      orderBy: { date: 'desc' },
    });

    sendJson(res, 200, {
      records: rows.map(toAttendanceDto),
      from,
      to,
      rules: {
        lateAfterMinutes: LATE_AFTER_MINUTES,
        overtimeAfterMinutes: OVERTIME_AFTER_MINUTES,
      },
    });
  });

  /**
   * Check in or out for today.
   *
   * One endpoint rather than two, because both are "record that this happened, and
   * work out what it means" -- and the meaning depends on today's existing row.
   */
  router.post('/punch', requireAuth, async (req, res) => {
    const { action } = z.object({ action: z.enum(['in', 'out']) }).parse(req.body);
    const userId = req.user!.id;

    const today = appDayKey(new Date());
    const now = new Date();
    const dateColumn = new Date(`${today}T00:00:00Z`);

    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: dateColumn } },
    });

    if (action === 'in') {
      // Re-punching in is allowed and overwrites, rather than being rejected. The
      // client's own punchIn did the same, so refusing here would change behaviour
      // rather than fix it -- and a person who punched in by mistake needs to be able
      // to correct it.
      const minutes = appMinutesOfDay(now);
      const status = minutes > LATE_AFTER_MINUTES ? 'LATE' : 'PRESENT';

      const row = await prisma.attendance.upsert({
        where: { userId_date: { userId, date: dateColumn } },
        // A fresh check-in clears the checkout: the previous punch-out belongs to
        // the shift that has now been superseded.
        create: {
          userId,
          date: dateColumn,
          checkIn: now,
          checkOut: null,
          status,
          overtimeMinutes: 0,
        },
        update: {
          checkIn: now,
          checkOut: null,
          status,
          overtimeMinutes: 0,
        },
      });

      sendJson(res, 200, { record: toAttendanceDto(row) });
      return;
    }

    // Checking out of nothing. A clear 400 rather than a silent success, because a
    // silent no-op looks like the punch worked and the record simply has no time
    // on it later.
    if (!existing?.checkIn) {
      throw badRequest('not_checked_in', 'You have not checked in today.');
    }

    const overtimeMinutes = Math.max(0, appMinutesOfDay(now) - OVERTIME_AFTER_MINUTES);

    const row = await prisma.attendance.update({
      where: { userId_date: { userId, date: dateColumn } },
      data: { checkOut: now, overtimeMinutes },
    });

    sendJson(res, 200, { record: toAttendanceDto(row) });
  });

  return router;
}
