/**
 * The activity feed.
 *
 * `Notification` is a single table with a polymorphic `(targetType, targetId)`
 * pair, so the target is resolved by type. That is a deliberate trade: the feed
 * is always read the same way, and per-type tables would need a UNION at read
 * time to produce one list.
 *
 * The fixture stored a prose `title` and `subtitle`. Those are not returned,
 * because they are presentation: a feed row whose text was frozen at seed time
 * goes stale the moment anything is renamed. The UI composes them from the
 * structured fields below.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().datetime().optional(),
});

/** Minimal shape of whatever a notification points at. */
type Target =
  | { kind: 'message'; id: string; body: string; channelName: string | null }
  | { kind: 'file'; id: string; name: string; sizeBytes: string }
  | { kind: 'meeting'; id: string; title: string; startsAt: string }
  | { kind: 'leave'; id: string; status: string; days: number; from: string; to: string }
  | null;

export function activityRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const { limit, before } = listQuery.parse(req.query);

    const rows = await prisma.notification.findMany({
      where: {
        userId: req.user!.id,
        // Keyset pagination on the cursor rather than OFFSET, which degrades as
        // the table grows and skips rows when new ones arrive mid-scroll.
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: {
        actor: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Resolved in a batch per type rather than one lookup per row, so a page of
    // 20 notifications is 5 queries rather than 20.
    const [messages, files, meetings, leaves] = await Promise.all([
      prisma.message.findMany({
        where: { id: { in: idsOfType(rows, 'message') } },
        select: { id: true, body: true, channel: { select: { name: true } } },
      }),
      prisma.file.findMany({
        where: { id: { in: idsOfType(rows, 'file') } },
        select: { id: true, name: true, sizeBytes: true },
      }),
      prisma.meeting.findMany({
        where: { id: { in: idsOfType(rows, 'meeting') } },
        select: { id: true, title: true, startsAt: true },
      }),
      prisma.leaveRequest.findMany({
        where: { id: { in: idsOfType(rows, 'leave') } },
        select: { id: true, status: true, days: true, fromDate: true, toDate: true },
      }),
    ]);

    const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
    const messageById = byId(messages);
    const fileById = byId(files);
    const meetingById = byId(meetings);
    const leaveById = byId(leaves);

    function resolveTarget(targetType: string, targetId: string): Target {
      const message = messageById.get(targetId);
      if (targetType === 'message' && message) {
        return {
          kind: 'message',
          id: message.id,
          body: message.body,
          channelName: message.channel?.name ?? null,
        };
      }
      const file = fileById.get(targetId);
      if (targetType === 'file' && file) {
        return {
          kind: 'file',
          id: file.id,
          name: file.name,
          // String, not number: `sizeBytes` is BigInt in the database and this is
          // the exact place a naive Number() would silently lose precision on a
          // file over 2^53 bytes.
          sizeBytes: file.sizeBytes.toString(),
        };
      }
      const meeting = meetingById.get(targetId);
      if (targetType === 'meeting' && meeting) {
        return { kind: 'meeting', id: meeting.id, title: meeting.title, startsAt: meeting.startsAt.toISOString() };
      }
      const leave = leaveById.get(targetId);
      if (targetType === 'leave' && leave) {
        return {
          kind: 'leave',
          id: leave.id,
          status: leave.status,
          days: leave.days,
          from: leave.fromDate.toISOString(),
          to: leave.toDate.toISOString(),
        };
      }
      // A deleted target, or a type added after this was written. Null is
      // honest; a placeholder title would be a lie.
      return null;
    }

    sendJson(res, 200, {
      activity: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
        actor: row.actor
          ? { id: row.actor.id, name: row.actor.name, avatarUrl: row.actor.avatarUrl }
          : null,
        target: resolveTarget(row.targetType, row.targetId),
      })),
      nextCursor: rows.length === limit ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    });
  });

  return router;
}

function idsOfType(rows: Array<{ targetType: string; targetId: string }>, type: string): string[] {
  return rows.filter((row) => row.targetType === type).map((row) => row.targetId);
}
