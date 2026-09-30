/**
 * Teams.
 *
 * `memberCount` and `channelCount` are computed from real rows, not stored. The
 * fixtures carried org-wide numbers (`memberCount: 12` for a team the directory
 * lists three people in), so the seeded values are smaller and are the true
 * counts. See database/README.md.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';

/**
 * `Team` as the frontend expects it.
 *
 * `mine` and `myRole` are properties of the *viewing* user, so they come from
 * the caller's membership row. A caller who is not a member gets
 * `mine: false, myRole: null` rather than being refused: the directory is
 * browsable, and a team that has not been joined is still worth seeing.
 */
function toTeam(
  team: {
    id: string;
    name: string | null;
    description: string | null;
    members: Array<{ userId: string }>;
    _count: { channels: number };
  },
  membership: { role: 'OWNER' | 'ADMIN' | 'MEMBER' } | null,
) {
  return {
    id: team.id,
    name: team.name ?? '',
    description: team.description ?? '',
    memberIds: team.members.map((m) => m.userId),
    memberCount: team.members.length,
    channelCount: team._count.channels,
    mine: membership !== null,
    myRole: membership?.role ?? null,
  };
}

const teamSelect = {
  id: true,
  name: true,
  description: true,
  members: { select: { userId: true }, orderBy: { userId: 'asc' } },
  _count: { select: { channels: true } },
} as const;

export function teamsRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const rows = await prisma.team.findMany({
      select: teamSelect,
      orderBy: { name: 'asc' },
    });

    // One query for all of the caller's memberships rather than a lookup per
    // team; with N teams the per-team version is N+1.
    const memberships = await prisma.teamMember.findMany({
      where: { userId: req.user!.id },
      select: { teamId: true, role: true },
    });
    const byTeam = new Map(memberships.map((m) => [m.teamId, m]));

    sendJson(res, 200, {
      teams: rows.map((team) => toTeam(team, byTeam.get(team.id) ?? null)),
    });
  });

  router.get('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const team = await prisma.team.findUnique({ where: { id }, select: teamSelect });
    if (!team) throw notFound('No such team.');

    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: req.user!.id, teamId: id } },
      select: { role: true },
    });

    const members = await prisma.teamMember.findMany({
      where: { teamId: id },
      select: {
        role: true,
        joinedAt: true,
        user: {
          select: { id: true, name: true, avatarUrl: true, jobTitle: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    });

    sendJson(res, 200, {
      team: toTeam(team, membership ?? null),
      members: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        avatarUrl: m.user.avatarUrl,
        jobTitle: m.user.jobTitle,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
    });
  });

  return router;
}
