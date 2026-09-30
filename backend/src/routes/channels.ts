/**
 * Channels.
 *
 * This route is where the schema's decision to derive rather than denormalise
 * pays off: `lastMessage`, `lastAt` and `unread` are all computed here from
 * `Message` and `ChannelReadState`, with no stored column to fall out of date.
 *
 * There is no `channel_members` table (see database/README.md), so a channel's
 * members are its team's members. That is correct for a `STANDARD` channel and
 * wrong for a `PRIVATE` one, which is called out where it matters below.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

export function channelsRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { teamId } = z.object({ teamId: z.string().min(1).max(64) }).parse(req.query);

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    if (!team) throw notFound('No such team.');

    const channels = await prisma.channel.findMany({
      where: { teamId },
      // The newest message per channel, in one round trip. `take: 1` with an
      // order is the standard way to express "latest of"; a per-channel query
      // would be N+1.
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true },
        },
        states: { where: { userId: req.user!.id }, select: { lastReadAt: true } },
        team: { select: { members: { select: { userId: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    const unreadByChannel = await unreadCounts(req.user!.id, channels.map((c) => c.id));

    sendJson(res, 200, {
      channels: channels.map((channel) => {
        const latest = channel.messages[0];
        return {
          id: channel.id,
          name: channel.name,
          teamName: team.name ?? '',
          teamId: channel.teamId,
          lastMessage: latest?.body ?? '',
          lastAt: latest?.createdAt.toISOString() ?? null,
          // The badge cannot live on the channel, because unread is a property
          // of a reader rather than of the channel.
          unread: unreadByChannel.get(channel.id) ?? 0,
          // A PRIVATE channel's real membership is not modelled yet, so its
          // members are currently reported as the whole team. A caller relying
          // on this to decide visibility would be misled, which is why
          // `POST /:id/read` refuses a private channel instead of guessing.
          memberIds: channel.team.members.map((m) => m.userId),
        };
      }),
    });
  });

  /**
   * Marks a channel as read up to now.
   *
   * `lastReadAt` is set to the instant of the request rather than to the newest
   * message actually seen. A client that was catching up would otherwise be told
   * it had already read messages that arrived in between, so advancing the
   * marker to now can swallow a message nobody saw. Advancing to "now" is the
   * honest record of "I have seen everything that existed when I looked".
   */
  router.post('/:id/read', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true, type: true },
    });
    if (!channel) throw notFound('No such channel.');
    if (channel.type === 'PRIVATE') {
      throw badRequest(
        'private_channel_unsupported',
        'Private channel membership is not modelled yet, so read state cannot be scoped to a member list.',
      );
    }

    const now = new Date();
    await prisma.channelReadState.upsert({
      where: { userId_channelId: { userId: req.user!.id, channelId: id } },
      create: { userId: req.user!.id, channelId: id, lastReadAt: now },
      update: { lastReadAt: now },
    });

    sendJson(res, 200, { lastReadAt: now.toISOString() });
  });

  return router;
}

/**
 * Unread counts for one reader across several channels, in a single query.
 *
 * Raw SQL for a specific reason: the threshold differs per channel, because each
 * has its own `lastReadAt`. `groupBy` filters the whole query, not each group,
 * so it cannot express "newer than each channel's own marker" -- and a per
 * channel count would be one query per channel.
 *
 * The LEFT JOIN is what makes a channel with no read state count every message
 * as unread, which is the correct reading of someone who has never opened it.
 *
 * Channels with nothing unread simply do not appear, hence the `?? 0` at the
 * call site.
 */
async function unreadCounts(userId: string, channelIds: string[]): Promise<Map<string, number>> {
  if (channelIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ channelId: string; count: number }>>`
    SELECT m."channelId" AS "channelId", COUNT(*)::int AS count
    FROM "Message" m
    LEFT JOIN "ChannelReadState" s
      ON s."channelId" = m."channelId" AND s."userId" = ${userId}
    WHERE m."channelId" = ANY(${channelIds}::text[])
      AND (s."lastReadAt" IS NULL OR m."createdAt" > s."lastReadAt")
    GROUP BY m."channelId"
  `;

  return new Map(rows.map((row) => [row.channelId, row.count]));
}
