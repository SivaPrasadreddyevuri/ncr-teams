/**
 * Messages.
 *
 * Cursor pagination rather than `OFFSET`. `OFFSET` re-counts from the start on
 * every page, so a message arriving mid-scroll shifts the window and the reader
 * sees a duplicate at one end and a gap at the other. The cursor here is the
 * `(createdAt, id)` pair that the last row of the previous page ended on, which
 * is stable no matter what is inserted.
 *
 * The cursor is opaque -- base64url of `createdAt|id` -- so a client cannot
 * construct an invalid one, and a future change to the sort key does not become
 * a breaking API change.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { sendJson } from '../serialise.js';
import { requireAuth } from '../middleware/session.js';
import { publish } from '../realtime/bus.js';
import { toMessageDto } from '../dto.js';

const listQuery = z.object({
  channelId: z.string().min(1).max(64),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The select that keeps every message response identical in shape. */
const messageSelect = {
  id: true,
  channelId: true,
  userId: true,
  body: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  reactions: { select: { emoji: true, userId: true } },
  attachments: { select: { id: true, name: true, sizeBytes: true, mimeType: true } },
} as const;

type Cursor = { createdAt: Date; id: string } | null;

/**
 * Decodes an opaque cursor.
 *
 * Returns a descriptive error rather than silently falling back to "from the
 * beginning": a client with a broken cursor would otherwise receive the whole
 * history and show it as though the scroll had worked.
 */
function decodeCursor(raw: string | undefined): Cursor {
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw badRequest('invalid_cursor', 'The pagination cursor is not valid.');
  }

  // Split on the last '|', so an id containing a pipe cannot break the parse.
  const separator = decoded.lastIndexOf('|');
  if (separator === -1) throw badRequest('invalid_cursor', 'The pagination cursor is not valid.');

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw badRequest('invalid_cursor', 'The pagination cursor is not valid.');
  }

  return { createdAt, id };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/** Whether the caller belongs to the team owning this channel. */
async function assertCanPostToChannel(userId: string, channelId: string): Promise<void> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, team: { select: { id: true } } },
  });
  if (!channel) throw notFound('No such channel.');

  // A private channel's real membership is not modelled yet, so team membership
  // is the only gate available. Widening this to a channel_members table is the
  // change that makes PRIVATE meaningful; see database/README.md.
  const member = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId: channel.team.id } },
    select: { id: true },
  });
  if (!member) throw forbidden('You are not a member of this team.');
}

export function messagesRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { channelId, before, limit } = listQuery.parse(req.query);
    const cursor = decodeCursor(before);

    const rows = await prisma.message.findMany({
      where: {
        channelId,
        // Strictly older than the cursor, with the id breaking ties. Two
        // messages can share a createdAt millisecond, and an `lt` on the
        // timestamp alone would drop one of them.
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: messageSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    // Fetched newest-first for the cursor, returned oldest-first because that is
    // the order a chat thread reads in, and it lets the client append a page
    // without reversing.
    const ordered = [...rows].reverse();

    sendJson(res, 200, {
      messages: ordered.map(toMessageDto),
      // Present only when a full page came back, so the client does not ask for
      // a further page that would be empty.
      //
      // The cursor is the *oldest* row of this page, which is the last element
      // of the descending result -- not the newest. Anchoring on the newest
      // would put the next page's boundary above the row that was just returned,
      // and that row would come back a second time.
      nextCursor:
        rows.length === limit
          ? encodeCursor(rows[rows.length - 1]!.createdAt, rows[rows.length - 1]!.id)
          : null,
    });
  });

  router.post('/', async (req, res) => {
    const body = z
      .object({
        channelId: z.string().min(1).max(64),
        // Empty is allowed so a message can be nothing but an attachment.
        body: z.string().max(4000).default(''),
        attachmentIds: z.array(z.string().min(1).max(64)).max(10).default([]),
        parentId: z.string().min(1).max(64).optional(),
      })
      .strict()
      .parse(req.body);

    if (!body.body.trim() && body.attachmentIds.length === 0) {
      throw badRequest('empty_message', 'A message needs text or an attachment.');
    }

    await assertCanPostToChannel(req.user!.id, body.channelId);

    // Validate the parent before writing: a reply to a message in another
    // channel would otherwise create a thread that belongs to two conversations.
    if (body.parentId) {
      const parent = await prisma.message.findUnique({
        where: { id: body.parentId },
        select: { channelId: true },
      });
      if (!parent) throw notFound('No such message to reply to.');
      if (parent.channelId !== body.channelId) {
        throw badRequest('parent_in_other_channel', 'A reply must be in the same channel as its parent.');
      }
    }

    const attachmentIds = [...new Set(body.attachmentIds)];
    if (attachmentIds.length > 0) {
      // Counted rather than trusted: connecting an id the caller did not upload
      // would attach someone else's file to their message.
      const owned = await prisma.file.count({
        where: { id: { in: attachmentIds }, uploadedById: req.user!.id, deletedAt: null },
      });
      if (owned !== attachmentIds.length) {
        throw badRequest('unknown_attachment', 'One of the attachments could not be used.');
      }
    }

    const row = await prisma.message.create({
      data: {
        channelId: body.channelId,
        userId: req.user!.id,
        body: body.body.trim(),
        parentId: body.parentId,
        attachments: { connect: attachmentIds.map((id) => ({ id })) },
      },
      select: messageSelect,
    });

    const dto = toMessageDto(row);
    publish({ type: 'message.created', channelId: body.channelId, message: dto });

    sendJson(res, 201, { message: dto });
  });

  /** Adds a reaction, or removes it if the caller already gave that one. */
  router.post('/:id/reactions', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { emoji } = z
      .object({ emoji: z.string().min(1).max(16) })
      .parse(req.body);

    const message = await prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true, userId: true, deletedAt: true },
    });
    if (!message) throw notFound('No such message.');

    // A deleted message is a tombstone; reacting to it would resurrect content
    // in the feed without anyone being able to read what was said.
    if (message.deletedAt) throw badRequest('message_deleted', 'This message was deleted.');

    const existing = await prisma.reaction.findUnique({
      where: { userId_messageId_emoji: { userId: req.user!.id, messageId: id, emoji } },
      select: { id: true },
    });

    if (existing) {
      await prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      // A distinct id per reaction, so the (user, message, emoji) unique index
      // is what prevents a double-tap from creating two identical rows.
      await prisma.reaction.create({
        data: { id: `${id}-${emoji}-${req.user!.id}`, messageId: id, userId: req.user!.id, emoji },
      });
    }

    const row = await prisma.message.findUniqueOrThrow({ where: { id }, select: messageSelect });
    const dto = toMessageDto(row);
    if (message.channelId) {
      publish({ type: 'message.updated', channelId: message.channelId, message: dto });
    }

    sendJson(res, 200, { message: dto });
  });

  /**
   * Soft delete, author only.
   *
   * The row stays and the body is emptied, so thread position, timestamps and
   * reactions stay coherent -- removing the row would leave replies pointing at
   * nothing and silently renumber the conversation. `deletedAt` is what makes it
   * a tombstone rather than an edit.
   */
  router.delete('/:id', async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const message = await prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true, userId: true },
    });
    if (!message) throw notFound('No such message.');

    if (message.userId !== req.user!.id) {
      // Author-only, checked here rather than by role: a moderator deleting
      // someone's message is a different feature with an audit trail, and is not
      // this endpoint.
      throw forbidden('You can only delete your own messages.');
    }

    const row = await prisma.message.update({
      where: { id },
      data: { deletedAt: new Date(), body: '' },
      select: messageSelect,
    });

    if (message.channelId) {
      publish({ type: 'message.deleted', channelId: message.channelId, messageId: id });
    }

    sendJson(res, 200, { message: toMessageDto(row) });
  });

  return router;
}
