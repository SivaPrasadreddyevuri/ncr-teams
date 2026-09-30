/**
 * People.
 *
 * Responses mirror the `Person` type in `frontend/lib/data.ts` exactly --
 * including the field names and the nullable ones. That is deliberate: it means
 * the frontend can switch from fixtures to this API by changing where a value
 * comes from, not by rewriting every component's expectations.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
});

/**
 * `Person` as the frontend expects it.
 *
 * `department` is a *name*, not an id: the fixture stores a string and the UI
 * renders it directly. Resolving the relation here keeps that shape without
 * leaking the id into a field the component treats as a label.
 *
 * `online` is always false. Presence is live WebSocket state with a TTL, not a
 * persisted flag, and it arrives with the realtime phase. Returning a hard false
 * rather than omitting the field means the component needs no change, and the
 * value cannot go stale in the database.
 */
type PersonRow = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  employeeCode: string | null;
  role: 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  department: { name: string } | null;
};

function toPerson(row: PersonRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    jobTitle: row.jobTitle,
    employeeCode: row.employeeCode,
    role: row.role,
    department: row.department?.name ?? null,
    phone: row.phone ?? '',
    online: false,
    bio: row.bio ?? '',
    avatarUrl: row.avatarUrl ?? undefined,
  };
}

const personSelect = {
  id: true,
  name: true,
  email: true,
  jobTitle: true,
  employeeCode: true,
  role: true,
  phone: true,
  bio: true,
  avatarUrl: true,
  department: { select: { name: true } },
} as const;

export function usersRouter() {
  const router = Router();

  router.use(requireAuth);

  /**
   * The directory.
   *
   * Excludes people who have left: an employment status is a real record, and
   * someone marked EXITED should not appear in a people picker while their
   * history stays intact.
   */
  router.get('/', async (req, res) => {
    const { q, department } = listQuery.parse(req.query);

    const rows = await prisma.user.findMany({
      where: {
        employmentStatus: { in: ['ACTIVE', 'ON_NOTICE', 'NOTICE_PERIOD'] },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { jobTitle: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(department ? { department: { name: department } } : {}),
      },
      select: personSelect,
      orderBy: { name: 'asc' },
    });

    sendJson(res, 200, { users: rows.map(toPerson) });
  });

  router.get('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const row = await prisma.user.findUnique({ where: { id }, select: personSelect });
    if (!row) throw notFound('No such person.');

    sendJson(res, 200, { user: toPerson(row) });
  });

  /**
   * Updates the caller's own profile.
   *
   * A fixed set of fields rather than a pass-through, because an update endpoint
   * that accepts arbitrary keys is an elevation primitive -- `role` and
   * `twoFactorEnabled` are columns on the same row.
   *
   * `strict()` so an unknown key is a 400 rather than being silently dropped.
   * Zod's default is to strip what it does not recognise, which would mean a
   * client sending `{ role: 'HR_ADMIN' }` gets a cheerful 200 and no error: the
   * request looks like it worked. Rejecting it makes the mistake visible at the
   * call site instead.
   */
  router.patch('/me', async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        jobTitle: z.string().trim().max(120).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        bio: z.string().trim().max(2000).nullable().optional(),
        avatarUrl: z.string().trim().url().max(1000).nullable().optional(),
      })
      .strict()
      .parse(req.body);

    if (Object.keys(body).length === 0) {
      sendJson(res, 200, { user: req.user });
      return;
    }

    const row = await prisma.user.update({
      where: { id: req.user!.id },
      data: body,
      select: personSelect,
    });

    sendJson(res, 200, { user: toPerson(row) });
  });

  return router;
}
