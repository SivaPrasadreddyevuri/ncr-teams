/**
 * Departments.
 *
 * `head` and `members` mirror the fixture: a *name* and a *count*. The UI
 * renders both directly, so the relation is resolved here rather than handing an
 * id to a component expecting a label.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

export function departmentsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (_req, res) => {
    const departments = await prisma.department.findMany({
      include: {
        head: { select: { name: true } },
        // Only people who are here now. A departed employee still has their
        // records, but should not inflate a headcount that drives a dropdown.
        _count: {
          select: {
            members: {
              where: { employmentStatus: { in: ['ACTIVE', 'ON_NOTICE', 'NOTICE_PERIOD'] } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    sendJson(res, 200, {
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        description: department.description ?? '',
        head: department.head?.name ?? '',
        members: department._count.members,
      })),
    });
  });

  return router;
}
